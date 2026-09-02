export interface DecoderOptions {
    width: number;
    height: number;
    fps?: number;
    startTime?: number;
    ffmpegPath?: string;
    vaapiDevice?: string;
    playbackRate?: number;
    endTime?: number;
    sourcePaced?: boolean;
    inputArgs?: string[];
    outputArgs?: string[];
}

export interface VideoFrame {
    width: number;
    height: number;
    timestampUs: number;
    data: Uint8Array;
}

export function linkedFfmpegVersion(): string;

export class NativeVideoDecoder {
    public constructor(options: DecoderOptions);
    public open(source: string): void;
    public pollLatest(): VideoFrame | null;
    public pollNext(): VideoFrame | null;
    public queuedFrames(): number;
    public catchUpTo(timestampUs: number): void;
    public pollError(): string | null;
    public backend(): string;
    public decodedFrames(): number;
    public droppedFrames(): number;
    public skippedFrames(): number;
    public isFinished(): boolean;
    public close(): void;
}
