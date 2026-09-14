# Osnutek PixiJS issue-a: neomejena rast WebGPU bind-group predpomnilnika

## Povzetek

Pripravimo angleški osnutek novega, ozko usmerjenega issue-a za PixiJS 8.20.1. Prijava bo ločena od splošnega WebGPU memory-leak issue-a #10877
(https://github.com/pixijs/pixijs/issues/10877) in sorodnega, že popravljenega problema z neveljavnimi bind groups #12080
(https://github.com/pixijs/pixijs/issues/12080). Trenutna uradna izdaja je PixiJS 8.20.1 (https://github.com/pixijs/pixijs/releases).

## Priprava reprodukcije

- Ustvariti samostojen index.html v logs/pixi-bind-group-issue/, ki uporablja PixiJS 8.20.1 in običajen brskalniški WebGPU.
- Ohraniti en Application, eno MeshGeometry in en GpuProgram; v zanki ustvariti Mesh, Shader in UniformGroup, objekt izrisati, odstraniti ter pravilno uničiti.
- Na zaslonu in v konzoli prikazovati število iteracij, trenutno število živih objektov in diagnostično velikost zasebnega renderer.bindGroup.\_hash.
- Reprodukcija mora pokazati približno en nov cache entry na iteracijo, čeprav je na odru največ en testni objekt.
- Zasebni \_hash bo uporabljen samo kot diagnostični dokaz; ne bo predstavljen kot javni API ali predlagani workaround.

## Vsebina issue-a

- Predlagani naslov: WebGPU BindGroupSystem cache grows indefinitely when transient shader resources are destroyed.
- Vključiti trenutni rezultat, pričakovano stabilizacijo cache-a, kratke korake, celoten reproducibilni HTML in okolje: PixiJS 8.20.1, Edge 153, Windows
  10.0.26200.

- Dodati izmerjeni dolgoročni dokaz: v 2,5-urnem testu je gpuBindGroups zrasel z 2 na 430, medtem ko so Pixi teksture in bufferji ostali omejeni.
- Jasno zapisati, da rast RSS korelira s težavo, vendar sama meritev še ne dokazuje, da vsa rast RSS izvira iz bind groups.
- Navesti verjeten vzrok: BindGroupSystem.\_hash hrani GPUBindGroup po ID-jih virov in nima odstranjevanja vnosov ob uničenju kratkoživih shader virov.
- Povezati #10877 kot širši simptom in #12080/#12147 kot soroden lifecycle problem, ne kot isti že odpravljeni bug.
- Osnutka ne objaviti in ne ustvariti zunanjega GitHub zapisa.

## Preverjanje

- Repro servirati prek localhosta in ga zagnati v vidnem Edge WebGPU oknu.
- Preveriti najmanj 500 ciklov: en živ Mesh, monotona rast \_hash in nadaljnje pravilno izrisovanje.
- Nato uničiti celoten Application in potrditi, da se cache sprosti šele z rendererjem.
- Shraniti rezultate ob osnutku ter napredek zabeležiti v HISTORY.md.
- Javnih API-jev ali runtime kode projekta ne spreminjati.
