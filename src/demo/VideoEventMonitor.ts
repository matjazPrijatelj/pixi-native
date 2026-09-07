import type { NativeVideoEventType } from "@pixi-native/core";

const VIDEO_EVENT_TYPES: readonly NativeVideoEventType[] = [
  "emptied",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "canplaythrough",
  "play",
  "playing",
  "pause",
  "timeupdate",
  "seeked",
  "ended",
  "error",
];

const ORDERED_READINESS_EVENTS: readonly NativeVideoEventType[] = [
  "loadeddata",
  "canplay",
  "canplaythrough",
  "playing",
  "timeupdate",
];

const MAX_VISIBLE_ENTRIES = 7;

export type VideoEventTestResult = "IDLE" | "WAITING" | "PASS" | "FAIL";

export interface VideoEventSource {
  readonly file: string;
  readonly source: string;
}

export interface VideoEventTargetLike extends EventTarget {
  readonly currentTime: number;
  readonly readyState: number;
  readonly paused: boolean;
  readonly error: Error | null;
}

export interface VideoEventMonitorSnapshot {
  readonly source: string;
  readonly result: VideoEventTestResult;
  readonly detail: string;
  readonly entries: readonly string[];
}

type VideoEventLogger = (message: string) => void;

/** Tracks the source-replacement media event contract used by both demos. */
export class VideoEventMonitor {
  private readonly video: VideoEventTargetLike;
  private readonly onChange: (snapshot: VideoEventMonitorSnapshot) => void;
  private readonly log: VideoEventLogger;
  private readonly listeners = new Map<NativeVideoEventType, EventListener>();
  private readonly entries: string[] = [];
  private source = "";
  private resultValue: VideoEventTestResult = "IDLE";
  private detailValue = "Press E to start";
  private requiresEmptied = false;
  private sawEmptied = false;
  private sawMetadata = false;
  private sawPlay = false;
  private readinessIndex = 0;

  public constructor(
    video: VideoEventTargetLike,
    onChange: (snapshot: VideoEventMonitorSnapshot) => void,
    log: VideoEventLogger = console.log,
  ) {
    this.video = video;
    this.onChange = onChange;
    this.log = log;
    for (const type of VIDEO_EVENT_TYPES) {
      const listener = (): void => this.handleEvent(type);
      this.listeners.set(type, listener);
      video.addEventListener(type, listener);
    }
  }

  public get result(): VideoEventTestResult {
    return this.resultValue;
  }

  public get snapshot(): VideoEventMonitorSnapshot {
    return {
      source: this.source,
      result: this.resultValue,
      detail: this.detailValue,
      entries: [...this.entries],
    };
  }

  public beginSource(source: string, replacement: boolean): void {
    if (this.resultValue === "WAITING") {
      this.addEntry(`INTERRUPTED ${this.source}`);
    }
    this.source = source;
    this.resultValue = "WAITING";
    this.detailValue = replacement
      ? "waiting for emptied"
      : "waiting for metadata/play";
    this.requiresEmptied = replacement;
    this.sawEmptied = false;
    this.sawMetadata = false;
    this.sawPlay = false;
    this.readinessIndex = 0;
    this.addEntry(`SOURCE ${source}`);
    this.notify();
  }

  public dispose(): void {
    for (const [type, listener] of this.listeners) {
      this.video.removeEventListener(type, listener);
    }
    this.listeners.clear();
  }

  private handleEvent(type: NativeVideoEventType): void {
    const message =
      `[VideoSrcEventTest] ${this.source} ${type}` +
      ` t=${this.video.currentTime.toFixed(2)}` +
      ` readyState=${this.video.readyState}` +
      ` paused=${this.video.paused}`;
    this.log(message);
    this.addEntry(`${type}  ${this.video.currentTime.toFixed(2)} s`);

    if (this.resultValue !== "WAITING") {
      this.notify();
      return;
    }
    if (type === "error") {
      this.fail(this.video.error?.message ?? "video error");
      return;
    }
    if (type === "pause" || type === "ended") {
      this.fail(`${type} before playback became ready`);
      return;
    }
    if (type === "emptied") {
      if (
        !this.requiresEmptied ||
        this.sawEmptied ||
        this.sawMetadata ||
        this.sawPlay
      ) {
        this.fail("unexpected emptied event");
        return;
      }
      this.sawEmptied = true;
      this.detailValue = "waiting for metadata/play";
      this.notify();
      return;
    }
    if (this.requiresEmptied && !this.sawEmptied) {
      this.fail(`${type} arrived before emptied`);
      return;
    }
    if (type === "loadedmetadata" || type === "play") {
      const duplicate =
        type === "loadedmetadata" ? this.sawMetadata : this.sawPlay;
      if (duplicate || this.readinessIndex > 0) {
        this.fail(`unexpected ${type} event`);
        return;
      }
      if (type === "loadedmetadata") this.sawMetadata = true;
      else this.sawPlay = true;
      this.detailValue =
        this.sawMetadata && this.sawPlay
          ? `waiting for ${ORDERED_READINESS_EVENTS[0]}`
          : "waiting for metadata/play";
      this.notify();
      return;
    }

    const expected = ORDERED_READINESS_EVENTS[this.readinessIndex];
    if (type === expected) {
      if (!this.sawMetadata || !this.sawPlay) {
        this.fail(`${type} arrived before metadata/play`);
        return;
      }
      this.readinessIndex++;
      if (this.readinessIndex === ORDERED_READINESS_EVENTS.length) {
        this.resultValue = "PASS";
        this.detailValue = "source playback events complete";
      } else {
        this.detailValue = `waiting for ${ORDERED_READINESS_EVENTS[this.readinessIndex]}`;
      }
    } else if (ORDERED_READINESS_EVENTS.includes(type)) {
      this.fail(`expected ${expected}, received ${type}`);
      return;
    }
    this.notify();
  }

  private fail(detail: string): void {
    this.resultValue = "FAIL";
    this.detailValue = detail;
    this.log(`[VideoSrcEventTest] ${this.source} FAIL: ${detail}`);
    this.notify();
  }

  private addEntry(entry: string): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_VISIBLE_ENTRIES) this.entries.shift();
  }

  private notify(): void {
    this.onChange(this.snapshot);
  }
}
