# Skupni launcher runtime za več displayev

## Povzetek

Distribucija bo imela en skupni Node runtime in en skupni `node_modules`. Displayi ostanejo ločene aplikacije, vendar uporabljajo isto namestitev `pixi-native`, Pixija, native addonov in FFmpeg.

## Struktura in dependencyji

- Root release projekt deklarira `pixi-native` in `pixi.js` kot production dependencyja.
- Posamezni display projekti ju deklarirajo kot peer dependencyja in ju imajo v devDependencies samo za razvoj.
- Display build vsebuje samo `dist`, konfiguracijo in njegove assets.
- Display entrypointi so pod release rootom, zato standardno Node ESM iskanje najde skupni nadrejeni `node_modules`; launcherjev `cwd` ni del dependency resolutiona.
- Ne nastavljamo `NODE_PATH`; uporabimo standardno Node iskanje nadrejenega `node_modules`.

## Dostop do datotek

- Display ustvari helper z `createModuleFileAccess(import.meta.url)` iz `pixi-native/files`.
- Relativne poti do konfiguracije in assetov se razrešijo glede na display modul, ne glede na launcherjev `cwd`.
- `resolvePath`, `exists`, `readBytes`, `readText` in `readJson` pokrijejo bralni dostop.
- Absolutne poti, UNC poti in `file:` URL-ji niso omejeni na release mapo ter lahko kažejo tudi na drug disk.
- HTTP(S) ostane v `fetch`, zapisovanje pa neposredno v `node:fs`.

## Pakiranje

- `pixi-native-0.1.0.tgz` se hrani v root `vendor/`.
- Release staging dobi root `package.json`, lockfile, launcher in vse display builde.
- Production dependencyji se enkrat namestijo v `release/node_modules` z `node-linker=hoisted` in `package-import-method=copy`.
- Po želji se v `release/runtime` doda Node 24, ki ga uporablja launcher za vse child procese.

## Preverjanje

- Iz vsakega display entrypointa preveriti, da `import.meta.resolve("pixi-native")` kaže v isti root `node_modules`.
- Zaporedno in vzporedno zagnati več displayev.
- Preveriti WebGPU/WebGL, audio, video, FFmpeg resolution in čist shutdown.
- Premakniti celotno release mapo ter ponovno preveriti, da ni povezav na razvojni pnpm store.
- Iz display entrypointa ob `cwd` v release rootu prebrati lasten asset prek `pixi-native/files`.

## Predpostavke

- Vsi displayi v enem release-u uporabljajo isto različico `pixi-native` in PixiJS.
- Vsak display teče v svojem Node procesu, zato si deli datoteke na disku, ne pa JavaScript/GPU stanja v pomnilniku.
- Launcher in displayi so del ene release enote.
