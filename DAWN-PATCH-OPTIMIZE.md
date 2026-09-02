ta patch je že kar velik. Ni več samo “dodaj SDL2 surface support”, ampak dejansko vsebuje več ločenih posegov v Dawn/Node binding. Celoten diff ima 1274 vrstic, vendar precejšen del predstavljajo novi helperji, build datoteke, licence in zakomentiran DEPS config, ne pa 1274 vrstic kompleksne logike.

Jaz bi ga razdelil približno tako:

Del Velikost / invazivnost Zakaj ga imaš
webgpu_sdl.h + src/dawn/sdl/* 🟢 majhno SDL/native window → WGPUSurface
CMake/GN spremembe 🟢 majhno build dawn_sdl in link v dawn_node
Module.cpp Renderer 🔴 veliko dejanska integracija Pixi/WebGPU → SDL window
D3D swapchain spremembe 🟠 srednje frame-latency wait / pacing
Win32 modal resize hook 🟠 srednje renderiranje med resize/move Windows okna
AsyncRunner.cpp 🟠 precej občutljivo sprememba Dawn event loop obnašanja
GPUDevice.h / GPU.h 🟡 majhno, ampak invazivno dostop do Dawn internals
DEPS 🟡 build workaround izklop reclient/RBE
Jedro, ki ga dejansko potrebuješ za Pixi → SDL

Najbolj bistven del je tvoj novi SDL bridge. Dodaš:

CreateSurfaceForWindow(...)
GetNativeWindowHandle(...)

in na Windows iz SDL native podatkov vzameš HWND, iz katerega narediš WGPUSurfaceSourceWindowsHWND.

To je konceptualno zelo majhna sprememba in je po mojem smiselno vzdrževati kot patch.

Potem imaš Node binding Renderer, ki naredi:

PixiJS
│
▼
GPUDevice
│
▼
renderGPUDeviceToWindow()
│
▼
Renderer
│
├── SDL native window
│ ↓
│ HWND
│
▼
WGPUSurface
│
▼
D3D12 swapchain

Renderer potem Pixiju oziroma JS strani zagotavlja ravno tiste manjkajoče operacije:

getPreferredFormat()
getCurrentTexture()
getCurrentTextureView()
swap()
resize()
destroy()

To predstavlja glavnino custom integracije.

Kje patch postane precej bolj zahteven

Največji problem za dolgoročno vzdrževanje po mojem ni SDL support, ampak to, da si začel posegati v Dawn interne strukture.

Na primer:

wgpu::binding::GPUDevice::device_

si iz private prestavil v public:

- wgpu::Device device_;

private:
Napi::Env env_;

-      wgpu::Device device_;

To pomeni, da je Module.cpp vezan na interno implementacijo Dawn Node bindinga. Ob Dawn upgrade-u je to precej bolj verjeten vir konflikta kot sam SDL bridge.

Podobno velja za D3D swapchain.

Dodal si DXGI_SWAP_CHAIN_FLAG_FRAME_LATENCY_WAITABLE_OBJECT za D3D12/FIFO:

mConfig.swapChainFlags |=
DXGI_SWAP_CHAIN_FLAG_FRAME_LATENCY_WAITABLE_OBJECT;

in nato registry:

std::map<void*, HANDLE> gFrameLatencyHandles;

ter:

WaitForWindowFrame(...)

To je že modifikacija Dawnovega D3D presentation layerja, ne samo integracijski adapter.

Še en precej poseben del

Imaš tudi Windows modal resize/move workaround.

Hookaš WNDPROC in poslušaš:

WM_ENTERSIZEMOVE
WM_ENTERMENULOOP
WM_TIMER
WM_EXITSIZEMOVE
WM_EXITMENULOOP

ter med modalnim Windows message loopom na 16 ms kličeš render callback.

To je precej specifična funkcionalnost za tvojo aplikacijo in bi jo jaz dolgoročno poskusil spraviti iz Dawn source treeja.

Najbolj sumljiva sprememba za vzdrževanje

Ta:

- .Get("setImmediate")

* .Get("setTimeout")

in nato:

if (self->tasks_waiting_ == 0) {
return;
}

...
Napi::Number::New(env, 100)

To dejansko spreminja scheduling Dawn Node bindinga. To ni več SDL integracija in je potencialno precej občutljivo ob nadgradnji Dawn.

Torej: je patch prevelik?

Za uporabo .patch datoteke: ne še, ampak je na meji, kjer bi ga jaz začel organizirati drugače.

Problem ni toliko število vrstic. Problem je, da imaš trenutno v enem patchu vsaj 5 konceptualno različnih sprememb:

01-build-no-rbe.patch
02-sdl-surface.patch
03-node-sdl-renderer.patch
04-win32-frame-pacing.patch
05-node-event-loop.patch

To bi ti zelo priporočal.

Potem bo pri upgrade-u Dawn takoj jasno:

Dawn X → Dawn Y

✓ 01-build-no-rbe.patch
✓ 02-sdl-surface.patch
✓ 03-node-sdl-renderer.patch
✗ 04-win32-frame-pacing.patch
✓ 05-node-event-loop.patch

namesto da ti pade en ogromen dawn.patch in moraš ugotavljati, kateri del je problem.

Še boljša dolgoročna smer pa bi bila, da dawn_sdl in večino Renderer implementacije prestaviš iz Dawn repozitorija v svoj native addon/library, v Dawn patchu pa pustiš samo stvari, ki jih zaradi privatnih API-jev ali swapchain implementacije res ne moreš narediti zunaj.

Po moji oceni bi lahko tako tvoj pravi Dawn patch zmanjšal za precejšen del, hkrati pa bi bile nadgradnje Dawn bistveno manj boleče. Največja kandidata za odstranitev iz upstream source patcha sta src/dawn/sdl/* in Win32 modal-window logika; največja ovira pa je trenutna odvisnost od GPUDevice::device_ in D3D swapchain internals.

bi lahko kako drugače rešil freeze ob premikanju okna na win11?

Ja. Tvoj trenutni WNDPROC + WM_TIMER workaround deluje, ampak ni nujno, da je v Dawn patchu.

Freeze se zgodi zato, ker Windows med premikanjem/resizanjem okna vstopi v svoj modal move/size loop (WM_ENTERSIZEMOVE → WM_EXITSIZEMOVE). Tvoj običajni JS/SDL render loop se takrat ne izvaja normalno, če je vezan na isti thread/message pump. Microsoft to vedenje eksplicitno opisuje kot modal loop.

Najboljše alternative bi bile:

Prestavi Win32 hook v svoj SDL/native addon, ne v Dawn. Torej ohrani isto idejo, ki jo imaš zdaj:

WM_ENTERSIZEMOVE
↓
SetTimer(16 ms)
↓
render callback
↓
WM_EXITSIZEMOVE
↓
KillTimer()

To je po mojem zate najboljša rešitev. Dawn ostane skoraj nedotaknjen, SDL/native bridge pa skrbi za Windows windowing posebnosti.

Renderiraj na ločenem render threadu. To je arhitekturno najčistejše:

UI / SDL thread
│
├── Windows message loop
│
└── move/resize

Render thread
│
└── Pixi/WebGPU frames 60 Hz

Takrat modalni Windows loop ne zamrzne renderiranja. Ampak pri tebi je to precej težje, ker PixiJS in Node/Dawn objekti trenutno živijo na JS threadu; prehod na pravi render thread bi bil precej večji refactor kot sedanji patch.

Render iz SDL window event callbacka/event watcha. SDL skupnost uporablja tudi pristop, kjer se med resize eventom naredi redraw/present. Obstajajo aktualne diskusije prav o Windows live-resize problemu in renderiranju znotraj modal loopa. Vendar to pomaga predvsem pri resize, ne nujno pri navadnem premikanju okna, ker ko miš obstane med dragom, ni nujno novih resize/paint eventov. Zato SDL sam uporablja timer-like pristop za kontinuiran redraw.

Zato bi jaz pri tvojem projektu naredil:

Dawn
├── WGPUSurface
├── getCurrentTexture
└── present

tvoj sdl/native addon
├── SDL_Window → HWND
├── WM_ENTERSIZEMOVE
├── WM_EXITSIZEMOVE
├── 16 ms modal-frame timer
└── callback v JS

JS / Pixi
└── renderer.render()

Torej ne bi odstranjeval timer rešitve, ker je sama ideja dobra. Samo prestavil bi jo iz src/dawn/node/Module.cpp v tvoj SDL/native layer.

Še pomembneje: tvoj trenutni patch ima globalno:

ModalFrameState gModalFrameState;

kar pomeni praktično eno HWND/render instanco. Če boš to prestavil v svoj SDL addon, bi naredil stanje per-window, npr.:

std::unordered_map<HWND, WindowRenderState>

in s tem dobiš precej bolj robustno rešitev.

SDL_HINT_WINDOWS_ENABLE_MESSAGELOOP ti tega sam po sebi ne bo rešil. Ta hint samo določa, ali SDL ob SDL_PumpEvents() poganja Windows message loop; problem je, da tvoja zunanja render zanka med sistemskim modal loopom nima običajnega execution flowa.

Moje priporočilo za tvoj primer: obdrži WM_ENTERSIZEMOVE/WM_TIMER pristop, ampak ga izloči iz Dawn patcha v SDL2/native addon. To je najmanjši refactor in ti lahko iz Dawn patcha odstrani celoten modal-window del okoli ModalFrameState, ModalWindowProc, setModalFrameCallback in setModalStateCallback. Tvoj patch bi bil s tem že precej manj invaziven.
