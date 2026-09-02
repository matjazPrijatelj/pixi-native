const Fs = require('fs')
const { createRequire } = require('node:module')
const { getBindingPath } = require('../binding-path.js')

const requireNative = createRequire(__filename)
const bindingPath = getBindingPath()
if (!Fs.existsSync(bindingPath)) {
    throw new Error(`Native window addon not found for ${process.platform}-${process.arch}. Run pnpm native:window:build.`)
}

const binding = requireNative(bindingPath)

const create = (nativeData, onFrame, onState) => {
    const controller = new binding.ModalFrameController(nativeData, onFrame, onState)
    controller.attach()
    return controller
}

module.exports = { create }
