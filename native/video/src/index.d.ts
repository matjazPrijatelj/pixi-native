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
  loop?: boolean;
  backend?: "cli" | "native" | "auto";
  deliveryPath?: "cpu-nv12" | "gpu-nv12";
}

export interface VideoFrame {
  width: number;
  height: number;
  timestampUs: number;
  data: Uint8Array;
}

export interface VideoFrameInfo {
  width: number;
  height: number;
  timestampUs: number;
}

export interface SharedVideoFrame {
  width: number;
  height: number;
  timestampUs: number;
  sessionId: number;
  surfaceId: number;
  sharedHandle: Uint8Array;
}

export interface VideoShutdownDiagnostics {
  activeDecoderWorkers: number;
  pendingDecoderShutdowns: number;
  completedDecoderShutdowns: number;
  maxDecoderShutdownMs: number;
}

export class NativeVideoDecoder {
  public constructor(options: DecoderOptions);
  public open(source: string): void;
  public pollLatest(): VideoFrame | null;
  public pollNext(): VideoFrame | null;
  public pollLatestShared(): SharedVideoFrame | null;
  public pollNextShared(): SharedVideoFrame | null;
  public releaseSharedFrame(sessionId: number, surfaceId: number): boolean;
  public supportsFrameBufferReuse(): boolean;
  public pollLatestInto(target: Buffer): VideoFrameInfo | null;
  public pollNextInto(target: Buffer): VideoFrameInfo | null;
  public queuedFrames(): number;
  public catchUpTo(timestampUs: number): void;
  public pollError(): string | null;
  public backend(): string;
  public decodedFrames(): number;
  public droppedFrames(): number;
  public skippedFrames(): number;
  public frameBufferAllocations(): number;
  public frameBufferReuses(): number;
  public recycledFrameBuffers(): number;
  public implementationBackend(): "cli" | "native";
  public deliveryPath(): "cpu-nv12" | "gpu-nv12" | "d3d11-shared-nv12";
  public gpuFrameCopies(): number;
  public cpuFrameBytes(): number;
  public presentationSurfaceDrops(): number;
  public isFinished(): boolean;
  public close(): void;
}

export function videoShutdownDiagnostics(): VideoShutdownDiagnostics;
