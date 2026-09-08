const Fs = require("fs");
const { getBindingPath } = require("./binding-path.js");

const bindingPath = getBindingPath();
if (!Fs.existsSync(bindingPath)) {
  throw new Error(
    `Native WebGPU is not supported by this pixi-native distribution for ${process.platform}-${process.arch}: ` +
      "pixi_native_gpu.node is not included.",
  );
}
const binding = require(bindingPath);

const contexts = new Set();

// Pixi probes navigator.gpu by requesting a device before it initializes with
// the explicitly supplied adapter/device pair. Return the context-owned device
// so capability detection cannot create an unrelated second Dawn device.
const createNavigatorAdapter = (context) =>
  new Proxy(context.adapter, {
    get: (target, property) => {
      if (property === "requestDevice") return async () => context.device;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

const createWindowContext = (options) => {
  const context = binding.createWindowContext(options);
  const navigatorAdapter = createNavigatorAdapter(context);
  const gpu = {
    requestAdapter: async () => navigatorAdapter,
    getPreferredCanvasFormat: () => context.renderer.getPreferredFormat(),
    wgslLanguageFeatures: new Set(),
  };
  const result = { ...context, gpu };
  contexts.add(result);
  return result;
};

const destroy = (context) => {
  contexts.delete(context);
};

module.exports = {
  createWindowContext,
  destroy,
  ...binding.globals,
};
