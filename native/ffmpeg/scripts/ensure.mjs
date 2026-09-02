import { ensureFfmpegDependency } from "./dependency.mjs";

const dependency = await ensureFfmpegDependency();
if (dependency) {
    console.log(`FFmpeg ${dependency.version} ready at ${dependency.root}`);
} else {
    console.log(`No project FFmpeg dependency is defined for ${process.platform}-${process.arch}`);
}
