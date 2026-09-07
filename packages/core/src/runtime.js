export { FrameScheduler, VSyncFrameScheduler, } from "./runtime/FrameScheduler.js";
export { createCompositorFrameWaiter, createModalFrameController, setNativeWindowTransparent, } from "./runtime/ModalFrameController.js";
export { createNativeKeyboardEvent, createNativeMouseEvent, NodeDOMAdapter, normalizeRefreshRate, } from "./runtime/NodeDOMAdapter.js";
export { DEFAULT_ANTIALIAS_SAMPLES, } from "./runtime/nativeTypes.js";
export { getDefaultGpuBackend, resolveGpuBackend, supportsNativeVideo, } from "./runtime/platform.js";
export { getWindowOptionsDiagnostics, NATIVE_BACKGROUND_COLOR, premultiplyBackgroundColor, resolveAnimationFrameRate, resolveNodeRendererOptions, resolveWebGpuAntialiasSamples, warnAntialiasSampleFallback, } from "./runtime/windowOptions.js";
