# Next development targets

## CPU Zero-copy video on Windows

### Goal

Remove decoded video frames from the CPU data path. The first production target is zero CPU-copy playback; strict zero-copy from the decoder surface to the sampling shader remains conditional on supported D3D11, DXGI, Dawn, and driver behavior.

The current Windows path is:

```text
FFmpeg subprocess with D3D11VA decode
-> hwdownload to CPU NV12
-> stdout pipe
-> Rust frame buffer
-> N-API Uint8Array
-> WebGPU writeTexture for Y and UV
```

The target path is:

```text
H.264/H.265 input
-> in-process FFmpeg/libavcodec
-> D3D11VA NV12 surface
-> DXGI shared texture
-> Dawn SharedTextureMemory
-> NativeVideoSprite NV12 shader
-> swapchain
```

### CONVERSATIONS

Moje priporočilo je zato dvostopenjsko:

1. Kratkoročno obdrži native/gpu in native/video ločena. To je trenutno stabilna meja, video queue, WASAPI
   in Pixi WebGPU pa so že ločeno preverjeni.

2. Za zero-copy video kasneje uvedi skupen native runtime, kjer Dawnov Node/WebGPU binding ostane Pixijev
   javni API, dodatni native video sloj pa dobi dostop do istega Dawn device-a in importira DXGI shared
   texture.

Torej cilj naj bo:

    Pixi WebGPU JS objekti
    ↓
    Dawn Node binding
    ↓
    skupen native GPU/video runtime
    ├── SDL/window
    ├── Dawn device/surface
    └── FFmpeg → D3D11VA → shared texture

Ne bi pa ciljal na “vse Rust”. Najbolj praktična oblika je verjetno:

- Dawn/WebGPU Node binding: obstoječi C++;
- video in lifecycle sloj: Rust/napi-rs;
- majhen C/C++ bridge za Dawn texture import;
- en .node šele takrat, ko skupni GPU resource lifecycle dejansko potrebuje isti modul.

Glavni zaključek: združitev je dobra končna arhitektura zaradi skupnega lastništva GPU resource-ov, ne
zaradi manjšega števila .node datotek. Če bi jo izvedli zdaj brez najprej definiranega GPUVideoFrame/DXGI
import kontrakta, bi predvsem povečali build in vzdrževalno kompleksnost.
