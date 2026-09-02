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

### Delivery stages

1. Prove one local H.264 video can remain GPU-resident from D3D11VA decode to Dawn presentation.
2. Add local-video lifecycle behavior: bounded surface pool, playback clock, loop, seek, teardown, and device-loss recovery.
3. Extend the same surface path to RTP/live streams, keeping latest-frame presentation and bounded backpressure.
4. Validate audio/video playback and eight simultaneous streams on the production Ryzen and RTX 3050 hardware.

Prefer direct NV12 surface import with Y and UV plane sampling. If decoder surfaces cannot be imported reliably, use a D3D11 VideoProcessor to convert into a shared BGRA texture. That fallback performs one GPU conversion/copy but still removes the expensive CPU round trip and is expected to be comparable to Electron's practical video path.

### Required native changes

- Replace the per-video `ffmpeg.exe` raw-frame subprocess with in-process FFmpeg demux and decode while retaining D3D11VA.
- Allocate a bounded pool of shareable D3D11 textures and retain each surface until Dawn has finished reading it.
- Expose a narrow Windows binding for DXGI shared-texture import and fence synchronization through Dawn `SharedTextureMemory`.
- Pass native GPU-frame references through the video queue instead of pixel `Uint8Array` objects.
- Update `NativeVideoSprite` to sample imported NV12 planes, or the shared BGRA fallback, without per-frame `writeTexture` calls.
- Preserve current frame scheduling, A/V clock behavior, reconnect handling, and resource cleanup.

### Acceptance criteria

- The video path contains no `hwdownload`, raw-video stdout pipe, per-frame pixel `Uint8Array`, or video `queue.writeTexture` call.
- D3D11VA hardware decoding remains active and decoded pixels do not enter CPU memory.
- Surface ownership and fences prevent reuse while a frame is still referenced by Dawn.
- Loop, seek, teardown, device loss, live reconnect, and latest-frame dropping do not leak or deadlock surfaces.
- Four FHD and four 720p H.264 streams at 25/30 fps play smoothly on the target Ryzen and RTX 3050 system without unbounded latency, queue growth, or A/V drift.
- PIX or GPUView establishes whether the final path is strict zero-copy or zero CPU-copy with one GPU conversion.

### Estimate

- Local H.264 proof of concept without audio: **4-8 weeks**.
- Stable local-video lifecycle: **8-12 weeks**.
- Production RTP, A/V, recovery, and eight-stream implementation: **12-20 person-weeks**, approximately **3-5 months** for one experienced engineer.

These estimates include native integration and focused validation, but not unrelated media API redesign. The Electron implementation should remain the production fallback until the native runtime passes the same eight-stream workload with comparable or lower CPU usage and stable frame pacing.

### Non-goals

- Do not replace the public Pixi video API solely for this optimization.
- Do not introduce a generic media-backend abstraction before a second real backend exists.
- Do not claim strict zero-copy based only on enabled hardware decoding or shared-texture support; confirm it with GPU tracing.
