v electron verziji uporabljam howler.js bi ga bilo težko predstaviti kot natice mogoče s preimenovanjem import "howlers" a bi deloval enako?

Samo s preimenovanjem importa ne. howler.js je narejen nad Web Audio API in kot fallback nad HTML5 Audio, zato v čistem Node/native runtimeu nima podlage, na katero bi se priklopil.

Lahko pa narediš skoraj isto stvar na bolj praktičen način: napišeš svoj paket z enakim API-jem, recimo howler-native, in potem v bundlerju narediš alias:

resolve: {
alias: {
howler: "howler-native"
}
}

Tvoja obstoječa koda:

import { Howl, Howler } from "howler";

const sound = new Howl({
src: ["click.mp3"],
volume: 0.8,
loop: false,
});

sound.play();

bi ostala nespremenjena.

Pod pokrovom pa bi howler-native uporabljal nekaj takega:

Howl JS API
↓
N-API
↓
FFmpeg decode
↓
PCM
↓
PipeWire / PulseAudio / ALSA

Ali še bolje: za kratke sound effecte bi jih ob load() dekodiral v PCM in jih držal v RAM-u. Potem je play() praktično takojšen:

MP3/WAV/OGG
↓ load()
FFmpeg decode
↓
PCM cache
↓ play()
native audio mixer

To se zelo dobro ujema s Howler modelom. Howler že ponuja play, pause, stop, seek, volume, mute, loop, rate, fade, audio sprites in več istočasnih instanc istega zvoka.

Jaz bi kompatibilnost naredil nekako:

export class Howl {
constructor(options: HowlOptions);

play(spriteOrId?: string | number): number;
pause(id?: number): this;
stop(id?: number): this;

volume(volume?: number, id?: number): this | number;
mute(muted?: boolean, id?: number): this | boolean;

loop(loop?: boolean, id?: number): this | boolean;

seek(position?: number, id?: number): this | number;

rate(rate?: number, id?: number): this | number;

fade(from: number, to: number, duration: number, id?: number): this;

playing(id?: number): boolean;

unload(): null;
}

In globalno:

export const Howler = {
volume(value?: number),
mute(value: boolean),
stop(),
};

Tako bi verjetno lahko 90+ % obstoječe Howler kode prenesel brez sprememb.

Edino stvari kot:

Howler.ctx
Howler.masterGain

ali direktno delo z AudioContext seveda ne bi bile kompatibilne, ker WebAudio ne obstaja.

Za spatial audio:

sound.stereo(-1);
sound.pos(x, y, z);

bi lahko to kasneje implementiral v native mixerju. Howler ima tudi te API-je.

Še bolj pomembno: ne bi uporabljal FFmpeg procesa za vsak Howl. Imel bi en native audio engine:

                AudioEngine
                    │
       ┌────────────┼────────────┐
       ↓            ↓            ↓
     Howl A       Howl B       Howl C
       ↓            ↓            ↓
     PCM          PCM          PCM
       └────────────┼────────────┘
                    ↓
                  mixer
                    ↓
             master volume
                    ↓
                PipeWire

Tako dobiš zelo nizko latenco in ogromno istočasnih sound effectov.

Za tvoj projekt bi šel celo korak dlje in ohranil ime howler v source kodi. V development/runtime configu samo zamenjaš implementation:

Electron build
import "howler"
↓
original howler.js

Native Node build
import "howler"
↓ alias
@your/howler-native

Tako ti gameplay/Pixi koda sploh ne ve, ali teče v Electronu ali v native runtimeu.

To je po mojem precej lažji del migracije kot video. Native Howler clone z play/pause/stop/volume/loop/fade/sprite je povsem izvedljiv in relativno majhen kos kode.

! Spatial audia ne uporabljam
