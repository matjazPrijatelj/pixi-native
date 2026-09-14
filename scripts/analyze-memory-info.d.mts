export interface MemoryAnalysis {
    readonly count: number;
    readonly lines: readonly string[];
}

export function resolveMemoryInfoInput(
    requestedPath?: string,
    logsDirectory?: string,
): Promise<string>;

export function analyzeRows(rows: readonly unknown[]): MemoryAnalysis;
