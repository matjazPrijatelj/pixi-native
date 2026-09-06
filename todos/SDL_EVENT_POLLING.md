# Ciljani popravek SDL event pollinga

## Ugotovitve

- Windows WebGL CPU profil je bil posnet 15,05 sekunde pri 1280 x 720 in 4x MSAA.
- `@kmamal/sdl` event `poll` je porabil 3445 ms oziroma 22,89 % profila.
- MSAA `webglMultisampleScreen.resolve()` je porabil približno 10 ms, native
  `blitFramebuffer` pa približno 14 ms skupaj. Ta pot ni CPU ozko grlo.
- Image upload je porabil približno 3,5 ms ob nalaganju; RGBA/image adapterji v
  testirani Graphics sceni niso bili ponavljajoča se render-loop obremenitev.
- `webglBufferUpload.ts` se na Windows ANGLE poti ne uporablja.
- Nameščeni `@kmamal/sdl@0.11.13` ob prvem aktivnem event listenerju preklopi na
  `setInterval(poll, 0)`. Enako vedenje je še vedno prisotno v upstream `master`:
  <https://github.com/kmamal/node-sdl/blob/master/src/javascript/events/index.js>.
- Paket ne izvaža javnega API-ja za ročni event polling.

## Preverjena smer popravka

Runtime simulacija je ustavila interni hitri timer in klicala SDL `poll` pri
60 Hz. V primerjalnem 15,06-sekundnem profilu se je čas pollinga zmanjšal na
približno 295 ms oziroma 1,96 %, idle čas pa se je povečal z 20,38 % na 56,82 %.

## Predlagana implementacija

1. Dodaj trajen pnpm patch za `@kmamal/sdl@0.11.13`, ki izpostavi
   `events.poll()` in enosmerni `events.useManualPolling()`.
2. V manual načinu odstrani obstoječi polling timer in prepreči ponovni
   `setInterval(poll, 0)` ob dodajanju listenerjev.
3. Dodaj skupni SDL adapter, ki manual način vključi pred registracijo window
   listenerjev in SDL oknu izpostavi `pollEvents`.
4. Adapter uporabi v Windows WebGPU in skupni Windows ANGLE WebGL poti;
   `ManagedNativeApplication` že kliče `pollEvents` enkrat na ticker frame pred
   renderjem in presentom. WebGL7 sledi isti ANGLE poti.
5. Posodobi TypeScript deklaracije patchanega SDL API-ja, pnpm lockfile in
   `HISTORY.md`.

## Sprejemni pogoji

- Dodatni SDL listener v manual načinu ne zažene hitrega polling timerja.
- Vsak runtime frame izvede največ en projektno lastniški SDL `poll`.
- Ponovljeni CPU profil ne vsebuje `setInterval(poll, 0)` in polling ostane
  približno na hitrosti tickerja.
- WebGPU, WebGL8 in WebGL7 ohranijo tipkovnico, miško, resize, close ter modalni
  drag/resize.
- Uspejo `pnpm typecheck`, `pnpm test` in `pnpm build`.
- `native:build` ni potreben in se brez Matjaževe potrditve ne zažene.

## Izven obsega

- Ne spreminjaj MSAA resolve, image/RGBA upload ali buffer upload poti brez nove
  meritve, ki pokaže ozko grlo na konkretni sceni.
- Ne uporabljaj zasebnega `node_modules` path importa kot trajnega popravka.
