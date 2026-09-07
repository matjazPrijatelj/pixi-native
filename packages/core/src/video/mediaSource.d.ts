export interface ParsedMediaSource {
    readonly source: string;
    readonly startTime: number;
    readonly endTime?: number;
}
export declare function parseMediaSource(value: string): ParsedMediaSource;
export declare function redactMediaSource(value: string): string;
