## Načrt

### 1. Določi novo window mejo

Uvedi skupni NodeGlfwWindow, ki ga uporabljajo:

- Pixi 8 WebGPU,
- Pixi 8 WebGL,
- Pixi 7 WebGL.

Obstoječi NodeGLWindow ohrani kot združljiv alias ali tanek WebGL adapter, ker je zaradi package exports lahko javno dostopen.

Skupni window objekt naj zagotavlja:

- velikost okna in framebufferja,
- položaj,
- monitor in refresh rate,
- input dogodke,
- resize in close dogodke,
- minimize/maximize/restore,
- native platformne handle,
- idempotenten destroy().

### 2. Dodaj GLFW okno brez OpenGL konteksta

WebGPU potrebuje GLFW okno z GLFW_CLIENT_API = GLFW_NO_API.

Trenutni low-level @node-3d/glfw binding podpira isNoApi, javni GlfwWindow pa te možnosti še ne izpostavlja. Pravilna rešitev je:

- v @node-3d/glfw dodati dokumentirano možnost, npr. clientApi: "none" | "opengl";
- izdati novo različico @node-3d/glfw;
- nato posodobiti različico v pixi-native.

Ne spreminjaj node_modules lokalno.

### 3. Uvedi ekspliciten native surface descriptor

Dawn addon trenutno prejme cel SDL window objekt in bere window.\_native.gpu. To odstrani.

Namesto tega naj NodeGPUApi.createWindowContext() prejme nekaj podobnega:

interface NativeSurfaceDescriptor {
platform: "win32" | "x11" | "wayland";
window: Uint8Array;
display?: Uint8Array;
}

Uporabi Uint8Array ali BigInt, ne navadnega number, ker 64-bitni pointer ni vedno varen kot JavaScript number.

V native/gpu/addon/Module.cpp:267:

- odstrani branje SDL \_native.gpu;
- validiraj platformo in velikost handle podatkov;
- Win32: izdelaj WGPUSurfaceSourceWindowsHWND;
- X11: izdelaj WGPUSurfaceSourceXlibWindow;
- Wayland: izdelaj WGPUSurfaceSourceWaylandSurface;
- odstrani shranjevanje persistent reference na SDL window, če ni več potrebna.

Dawnovega GLFW helperja ne bi vključil. To bi lahko v addon pripeljalo drugo kopijo GLFW poleg @node-3d/glfw. Čisteje je Dawnu neposredno
posredovati platformne handle.

### 4. Migriraj Pixi 8 WebGPU na GLFW

V packages/pixi8/src/renderers/webgpu/createWebGpuRenderer.ts:37:

- odstrani @kmamal/sdl import;
- ustvari GLFW NO_API okno;
- native surface descriptor posreduj GPU addonu;
- obstoječi NodeGPUCanvas, NodeDOMAdapter in Pixi renderer pusti;
- input dogodke priklopi na GLFW adapter;
- za transparency in modalni Win32 loop uporabi window.nativeWindowData;
- ohrani eksplicitni WebGPU renderer.swap();
- zagotovi pravilen vrstni red uničenja: Pixi → surface → GPU context → GLFW window.

### 5. Združi dogodke, ne renderer lifecyclea

Iz packages/core/src/renderers/webgl/NodeGLWindow.ts:46 izvleci ponovno uporabne dele:

- mouse in keyboard normalizacijo,
- wheel dogodke,
- close-once zaščito,
- resize,
- native handle,
- window management.

WebGL naj še vedno uporablja svoj OpenGL context in swapBuffers(). WebGPU naj še vedno uporablja Dawn surface in surfacePresent(). Skupen naj bo
window/input layer, ne presentation lifecycle.

### 6. Odstrani SDL samo iz grafične poti

Po uspešni migraciji odstrani SDL iz:

- packages/pixi8/package.json;
- WebGPU rendererja;
- SDL-specifičnih komentarjev v canvas/DOM adapterju;
- WebGPU in window testov;
- third-party notices, kjer SDL ni več window/input komponenta.

Za zdaj ga obdrži v:

- packages/core/package.json;
- packages/pixi-native/package.json;
- NativeAudioEngine.ts;

ker ne-Windows audio še vedno uporablja SDL.

Rezultat prve faze bo:

Window/input: GLFW
WebGPU: Dawn
WebGL: OpenGL + GLFW
Win32 audio: CPAL → WASAPI
Linux audio: SDL začasno

### 7. Kritični testi

Dodaj samo teste pomembnega vedenja:

- pravilna izdelava Win32/X11/Wayland surface descriptorja;
- zavrnitev napačnega ali prekratkega native handle podatka;
- GLFW NO_API okno za WebGPU;
- resize uporablja framebuffer velikost;
- close se sproži samo enkrat;
- keyboard, mouse in wheel dogodki pridejo do Pixija;
- destroy je idempotenten;
- WebGPU addon ne bere več \_native.gpu ali SDL objekta;
- WebGL 7/8 ostane nespremenjen.

### 8. Native build kontrolna točka

Sprememba Module.cpp zahteva nov native:build.

Pred tem se ustavimo. Opozorim te in počakam na tvojo izrecno potrditev oziroma na konec tvojega ročnega builda. Ne bom zagnal konkurenčnega
builda.

### 9. Runtime preverjanje

Po novem native buildu preveri:

- Pixi 8 WebGPU: Sprite, Graphics, Text in ticker;
- Pixi 8 WebGL;
- Pixi 7 WebGL;
- resize, premikanje, minimize/maximize in close;
- mouse in keyboard input;
- transparentno Win32 okno;
- modalno premikanje/resizing;
- 25-minutni memory soak s 500 sprite-i;
- Win32 audio playback, overlap, fade, loop in audio sprites.

Za Linux ločeno preveri X11. Wayland naj ne bo deklariran kot podprt, dokler GLFW paket ne izpostavi obeh potrebnih Wayland handlov in ne uspe
dejanski compositor test.

### 10. Druga, poznejša faza: popolna odstranitev SDL

Če želiš SDL odstraniti tudi iz odvisnosti:

- razširi obstoječi native CPAL audio addon na Linux;
- javnega HowlerNative/NativeAudioEngine API-ja ne spreminjaj;
- odstrani SDL audio fallback;
- odstrani @kmamal/sdl iz root/core/facade manifestov in lockfila;
- ponovno preveri audio na pravem Linux hostu.

Priporočam, da zdaj izvedemo samo prvo fazo. Tako dobiš enoten GLFW window layer, ne da bi hkrati tvegal regresijo v že delujočem audiju.
