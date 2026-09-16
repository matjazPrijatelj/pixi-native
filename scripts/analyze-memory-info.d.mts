export interface MemoryAnalysis {
    readonly count: number;
    readonly lines: readonly string[];
    readonly trend: RssTrendAnalysis;
}

export type RssTrendStatus =
    | "PLATEAU"
    | "SLOW GROWTH"
    | "GROWING"
    | "DECLINING"
    | "UNSTABLE"
    | "INSUFFICIENT DATA";

export interface RssTrendAnalysis {
    readonly status: RssTrendStatus;
    readonly sampleCount: number;
    readonly durationMs: number;
    readonly analysisStartMs?: number;
    readonly settledAtMs?: number;
    readonly centerMiB?: number;
    readonly p10MiB?: number;
    readonly p90MiB?: number;
    readonly slopeMiBPerHour?: number;
    readonly reason?: string;
    readonly buckets: readonly unknown[];
    readonly samples: readonly unknown[];
}

export function resolveMemoryInfoInput(
    requestedPath?: string,
    logsDirectory?: string,
): Promise<string>;

export function analyzeRssTrend(rows: readonly unknown[]): RssTrendAnalysis;

export function analyzeRows(
    rows: readonly unknown[],
    options?: { readonly color?: boolean },
): MemoryAnalysis;

export function createHtmlReport(
    rows: readonly unknown[],
    inputPath: string,
): string;
