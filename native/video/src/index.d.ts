export interface DecoderOptions {
    width: number;
    height: number;
    fps?: number;
    ffmpegPath?: string;
    vaapiDevice?: string;
}

export interface VideoFrame {
    width: number;
    height: number;
    timestampUs: number;
    data: Uint8Array;
}

export class NativeVideoDecoder {
    public constructor(options: DecoderOptions);
    public open(source: string): void;
    public pollLatest(): VideoFrame | null;
    public pollError(): string | null;
    public backend(): string;
    public close(): void;
}
