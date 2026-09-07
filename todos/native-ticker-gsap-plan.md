# Native ticker, GSAP integracija in ureditev knjižnice

## Povzetek

- Zagotoviti, da Pixi in GSAP ticker tečeta s polno nastavljeno hitrostjo tudi pri skritem/
  minimiziranem oknu ali manjkajočem compositor signalu. Samodejnega throttlinga ne bo; aplikacija
  lahko varčuje z stage.visible = false ali app.ticker.stop().

- V createApp() privzeto vključiti GSAP, registrirati ustrezni PixiJS 7/8 namespace v PixiPlugin in
  oba tickerja priklopiti na isti native RAF tok.

- Ohraniti trenutni Howler-združljivi audio sistem. Ta že vključuje lasten mixer, Windows WASAPI,
  Linux SDL, FFmpeg decode/streaming in neodvisno predvajanje ob blokirani JS niti; Web Audio ostane
  dokumentiran prihodnji korak.

- Preurediti interne datoteke src/pixi-native, ne da bi spremenili obstoječe package importe.

## Ključne spremembe

- Skrajšati Windows compositor wait na en resolved frame interval in ob timeoutu počakati samo še
  preostanek trenutnega frame intervala. Tako timeout ne doda dodatne zamude, takojšnja napaka ne
  povzroči busy-loopa, ves čas pa ostane največ en native wait aktiven.

- Ohraniti enoten tok native scheduler → requestAnimationFrame → Pixi/GSAP → render → present;
  modalni callback naj sproži isti RAF batch, zato se noben ticker v istem frame-u ne izvede
  dvakrat.

- Dodati AppOptions.gsap?: boolean, privzeto true. createApp({ gsap: false }) preskoči
  GSAP/PixiPlugin registracijo; nizkonivojski createRenderer() ostane popolnoma brez GSAP
  življenjskega cikla.

- Premakniti gsap med runtime dependencies. Po namestitvi native okolja createApp() registrira
  PixiPlugin.registerPIXI() z namespaceom iz izbranega /v7 ali /v8 entrypointa, registrira plugin
  pri GSAP ter s sleep()/wake() ponovno veže GSAP na native RAF tudi, če je bil GSAP importan
  prezgodaj.

- Odstraniti demo-specifični gsapModalBridge in addModalFrameListener; demo aplikacije ne bodo več
  ročno povezovale tickerjev.

- Preurediti internals v jasne skupine: public facades ostanejo v korenu, application lifecycle in
  GSAP integracija gresta v application/, RAF/DOM/window okolje v runtime/, canvas/upload adapterji
  v canvas/, rendererji pa pod renderers/webgpu, renderers/webgl in renderers/webgl7. audio/ in
  video/ ostaneta ločena.

- Ohraniti javne package poti pixi-native/v7, /v8, /audio, /video in /files; popraviti samo interne,
  demo in testne importe.

- Posodobiti README z background-ticker invariantom, gsap:false, avtomatskim PixiPlugin setupom in
  pravilnim trenutnim audio/modalnim obnašanjem. V HISTORY.md zapisati napredek.

## Audio prihodnji načrt

- Prepisati zastareli todos/howler.md v stanje “implementirano” in ločen Web Audio roadmap.
- Prihodnji Web Audio subset naj nadgradi isti mixer z registriranimi PCM bufferji ter podpre
  AudioContext, AudioBuffer, AudioBufferSourceNode, GainNode, osnovni AudioParam, dejanski connect/
  disconnect, asinhroni decodeAudioData, currentTime, resume/suspend/close, start/stop in loop.

- Web Audio naj bo ločen opt-in export oziroma installWebAudioGlobals(), ne zamenjava za sedanji
  Howler API. Howler.ctx/masterGain se oceni šele po delujočem graph modelu; spatial audio ostane
  izven obsega.

- Ne posnemati Mystralovih trenutnih omejitev, kjer so povezave deloma no-op, decode ni pravi
  Promise in je cleanup ponekod namenoma izpuščen. Mystral bindings
  (https://github.com/mystralengine/mystralnative/blob/main/src/audio/audio_bindings.cpp), Mystral
  SDL engine (https://github.com/mystralengine/mystralnative/blob/main/src/audio/audio_context.cpp).

## Preverjanje

- Dodati scheduler regresije za dolg/neobstoječ compositor signal, pravilno polno fallback
  frekvenco, takojšnjo napako, odpoved callbacka, modalni frame in pozen signal brez dvojnega ticka.

- Dodati GSAP integracijske teste za privzeti vklop, gsap:false, ponovno vezavo na native RAF,
  cleanup ter dejansko PixiPlugin animacijo na PixiJS 7 in 8 objektu.

- Posodobiti package API/packaging teste in preveriti, da notranja reorganizacija ne spremeni javnih
  exportov.

- Zagnati pnpm typecheck, fokusirane scheduler/managed-app/GSAP teste, celoten pnpm test, pnpm build
  in distribucijski pack test.

- Ročno zagnati WebGPU, WebGL8 in WebGL7: preveriti PixiPlugin animacijo, drag/resize ter
  minimiziranje in obnovitev brez ustavitve ali catch-up bursta. native:build ni potreben; če bi
  postal potreben, je pred njim obvezna izrecna Matjaževa potrditev.

## Predpostavke

- En proces uporablja en Pixi major; GSAP-ov globalni PixiPlugin namespace zato ni hkrati deljen med
  aktivnima PixiJS 7 in 8 aplikacijama.

- Nevidnost okna sama ne ustavi render/present poti. Varčevanje je izrecna odločitev aplikacije.
- Audio implementacije v tem koraku ne spreminjamo, razen dokumentacije prihodnje Web Audio plasti.
