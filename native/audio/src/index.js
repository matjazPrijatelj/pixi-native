const { createRequire } = require("node:module");
const { getBindingPath } = require("../binding-path.js");

const requireNative = createRequire(__filename);
module.exports = requireNative(getBindingPath());
