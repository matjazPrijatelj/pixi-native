export interface NativeVoiceOptions {
  ownerId: number;
  id: number;
  source: string;
  ffmpegPath: string;
  offsetSeconds: number;
  durationSeconds?: number;
  volume: number;
  muted: boolean;
  loop: boolean;
  streaming: boolean;
  playbackRate: number;
  inputArgs: string[];
  outputArgs: string[];
}

export interface NativeCommandOptions {
  ownerId: number;
  command: string;
  id?: number;
  value?: number;
  boolValue?: boolean;
  from?: number;
  to?: number;
  durationMs?: number;
  fadeVersion?: number;
}

export interface NativeAudioEvent {
  ownerId: number;
  event: string;
  id?: number;
  message?: string;
}

export interface NativeAudioDiagnostics {
  activeVoices: number;
  queuedMs: number;
  underruns: number;
}

export class NativeAudioEngine {
  public constructor(eventNotifier: () => void);
  public createVoice(options: NativeVoiceOptions): void;
  public preload(
    ownerId: number,
    requestId: number,
    source: string,
    ffmpegPath: string,
    offsetSeconds: number,
    durationSeconds?: number,
  ): void;
  public command(options: NativeCommandOptions): void;
  public unloadOwner(ownerId: number): void;
  public currentTime(id: number): number | null;
  public currentVolume(id: number): number | null;
  public setGlobalVolume(value: number): void;
  public setGlobalMuted(value: boolean): void;
  public drainEvents(): NativeAudioEvent[];
  public diagnostics(): NativeAudioDiagnostics;
  public stopAll(): void;
  public shutdown(): void;
}
