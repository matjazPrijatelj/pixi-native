export interface NativePlatformModules {
  readonly target: "win32-x64";
  readonly gpuModule: string;
  readonly windowModule: string;
  readonly videoModule: string;
  readonly audioBinding: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
}
declare const modules: NativePlatformModules;
export = modules;
