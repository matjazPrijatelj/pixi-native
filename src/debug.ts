function enabled(value: string | undefined): boolean { return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase()); }
export const PIXI_NODE_DEBUG = enabled(process.env.PIXI_NODE_DEBUG);
export function debugLog(...args: unknown[]): void { if (PIXI_NODE_DEBUG) console.log(...args); }
