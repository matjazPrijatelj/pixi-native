kaj pa če bi združili dawn in video v en napi-rs modul bi bilo kaj lažje?

Ja — lahko bi bilo precej lažje, predvsem za tvoj konkretni cilj: FFmpeg decode → GPU texture → Pixi/WebGPU v SDL2 oknu. Ampak samo, če greš dovolj daleč in Dawn ne uporabljaš več kot ločenega dawn.node bindinga.

Trenutno imaš približno:

JS / PixiJS
│
├── dawn.node
│ └── Dawn / WebGPU
│
└── video.node (napi-rs)
└── FFmpeg

in zato moraš Dawnov Node binding popravljati, da iz JS GPUDevice prideš do native WGPUDevice, SDL HWND, surface-a itd. Ravno zaradi tega trenutno spreminjaš GPUDevice.h, Module.cpp, event loop in druge interne dele Dawn-a.

Če bi naredil en lasten modul:

spintec-native.node
│
├── napi-rs
│
├── Dawn
│ ├── Instance
│ ├── Adapter
│ ├── Device
│ ├── Queue
│ └── Surface
│
├── SDL2
│ └── Window / HWND
│
└── FFmpeg
├── decoder
└── D3D11/D3D12 GPU frames

bi imel C++/Rust native nivo, kjer so vsi native handle-i pod tvojim nadzorom.

To bi ti odstranilo enega največjih problemov sedanjega patcha: zdaj moraš iz Dawnovega JS wrapperja na silo priti do:

GPUDevice::device_

zato si ga moral iz private prestaviti v public.

Če ti sam ustvariš Dawn WGPUDevice, tega sploh ni:

Rust
owns WGPUInstance
owns WGPUAdapter
owns WGPUDevice
owns WGPUSurface

in JS dobi samo wrapper.

Še večja prednost: video

Tu bi se po mojem kombinacija res izplačala.

Sedaj imaš potencialno:

FFmpeg
↓
Rust video addon
↓
JS
↓
Dawn addon
↓
GPU

Če sta FFmpeg in Dawn v istem modulu:

FFmpeg HW decoder
│
▼
D3D texture
│
▼
Dawn import / shared texture
│
▼
GPUTexture
│
▼
Pixi

JS ni več transportna plast za native GPU resource.

To je zelo pomembno za tvoj načrt GPU-resident video.

Lahko imaš npr. JS API:

const native = createNativeRuntime({
window,
});

const device = native.gpu.device;

const video = native.createVideoDecoder({
source,
});

const frame = video.acquireFrame();

// dejansko native Dawn texture,
// brez CPU readback/copy
const texture = frame.texture;

In lifetime:

FFmpeg AVFrame
│
├─ D3D resource
│
├─ Dawn imported texture
│
└─ JS GPUTexture wrapper
│
▼
frame.release()

To bi se zelo lepo ujemalo z RAII pristopom, o katerem sva govorila pri opaque GPU frame-ih.

Ampak tu je ena pomembna meja.

Ne bi poskušal ponovno implementirati celotnega WebGPU JS API-ja v napi-rs.

Pixi pričakuje normalne objekte:

GPU
GPUAdapter
GPUDevice
GPUQueue
GPUTexture
GPUCommandEncoder
...

Dawnov obstoječi Node binding ti že implementira ogromno WebIDL/WebGPU mappinga.

Če bi rekel:

odstranimo dawn.node in napi-rs naj izpostavi cel WebGPU

bi si ustvaril ogromen projekt.

Boljša arhitektura

Jaz bi naredil en native modul, ampak bi v njem še vedno uporabil Dawnovo obstoječo Node/WebGPU binding implementacijo.

Približno:

spintec-native.node
│
├── Dawn WebGPU Node binding
│ └── standard navigator.gpu API
│
├── Spintec extensions
│ ├── createSDLRenderer()
│ ├── getAdapterLuid()
│ ├── waitForPresent()
│ └── createVideoDecoder()
│
├── SDL2
│
└── FFmpeg

Torej JS API bi izgledal nekaj takega:

import native from "@spintec/native";

const gpu = native.createGPU();

const adapter = await gpu.requestAdapter();
const device = await adapter.requestDevice();

const renderer = native.createRenderer({
device,
window,
});

const video = native.createVideoDecoder({
device,
});

Pomembna razlika od danes:

DANES

dawn.node
video.node

- patch Dawn

POTEM

spintec-native.node
├── upstream Dawn sources
├── majhen Spintec binding layer
└── video Rust code
Ali mora biti vse Rust?

Ne.

To je pomembno.

Lahko je končni .node napi-rs modul, znotraj njega pa linkaš:

Rust
│
├── FFmpeg / rsmpeg
│
└── C++ bridge
│
└── Dawn

Torej:

N-API
↑
napi-rs
↑
Rust application/native layer
├── FFmpeg
└── Dawn C/C++ API

Dawn ima C API, zato za večino stvari niti ne rabiš veliko C++.

Na primer Rust lahko drži:

struct GpuRuntime {
instance: WGPUInstance,
adapter: WGPUAdapter,
device: WGPUDevice,
queue: WGPUQueue,
}

SDL HWND:

struct WindowSurface {
hwnd: HWND,
surface: WGPUSurface,
}

In FFmpeg:

struct VideoFrame {
av_frame: AVFrame,
texture: WGPUTexture,
}

To bi bilo arhitekturno precej bolj čisto.

Ampak tvoj Pixi problem spremeni odločitev

Največje vprašanje je:

Kako Pixiju dati GPUDevice objekt, ki ga razume?

Če Pixi uporablja browser-like WebGPU API, potrebuje Dawnov JS binding.

Zato bi jaz zaenkrat ohranil Dawn Node WebGPU bindings, vendar jih buildal kot del svojega native projekta.

Tvoj repo bi lahko izgledal:

native/
├── Cargo.toml
├── src/
│ ├── lib.rs
│ ├── video/
│ ├── gpu/
│ └── window/
│
├── native/
│ └── dawn_bridge.cpp
│
└── vendor/
└── dawn/

Dawn pa bi imel pinned commit:

vendor/dawn @ 3ab742...

in tvoje spremembe bi bile večinoma zunaj Dawn source-a.

Idealni cilj:

Dawn upstream modifications
↓
~0

namesto sedanjih ~1200 vrstic patcha.

Tudi freeze pri premikanju okna bi postal lažji

Ker bi SDL2/Win32/Dawn runtime živel v istem native modulu, bi lahko imel:

SDL window
↓
HWND
↓
native window state
├── Dawn surface
├── DXGI wait handle
└── resize/move handling

in ne bi več tlačil:

ModalWindowProc
ModalFrameState
SetTimer

v src/dawn/node/Module.cpp.

To bi bila tvoja windowing infrastruktura, kar je pravo mesto zanjo.

Slabost združitve

Build bo težji:

Rust

- napi-rs
- Dawn C++
- SDL2
- FFmpeg
- D3D11/D3D12

in .node bo precej velik.

Ampak pri tvojem projektu to po mojem ni tako velik minus, ker že zdaj upravljaš native dependencyje in razmišljaš o pinned FFmpeg SDK/runtime paketu.

Največji benefit je drugje:

namesto dveh native svetov, ki ju povezuje JS, dobiš en GPU/native runtime.

Za tvojo aplikacijo bi šel proti:

@spintec/native
│
├── WebGPU (Dawn)
├── Windowing (SDL2)
├── Video (FFmpeg)
└── GPU interop

in Pixi bi bil čisti consumer:

PixiJS
↓
WebGPU API
↓
@spintec/native
↓
Dawn / D3D12

Torej: ja, jaz bi resno razmislil o združitvi. Ne predvsem zaradi enega .node fajla, ampak zato, ker bi ti omogočila odstraniti večino neprijetnih Dawn patchov in bi bila prihodnja FFmpeg → D3D → Dawn zero-copy pot bistveno bolj naravna.
