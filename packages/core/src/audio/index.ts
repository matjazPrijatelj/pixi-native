export * from "./HowlerNative.ts";
import { nativeAudioEngine as internalNativeAudioEngine } from "./NativeAudioEngine.ts";

/** Runtime mixer health information intended for monitoring and diagnostics. */
export interface NativeAudioDiagnostics {
  /** Number of voices currently tracked by the native mixer. */
  readonly activeVoices: number;
  /** Audio already queued to the output device, measured in milliseconds. */
  readonly queuedMs: number;
  /** Number of output underruns reported by the active backend. */
  readonly underruns: number;
}

/** Read-only public view of the process-wide native audio engine. */
export interface NativeAudioDiagnosticsSource {
  readonly diagnostics: NativeAudioDiagnostics;
}

/**
 * Process-wide native audio diagnostics.
 *
 * Playback ownership is intentionally provided through {@link Howl} and
 * {@link Howler}; low-level voice and worker commands are not public API.
 */
export const nativeAudioEngine: NativeAudioDiagnosticsSource =
  internalNativeAudioEngine;
