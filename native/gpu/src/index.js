const Fs = require('fs')
const { getBindingPath } = require('./binding-path.js')

const bindingPath = getBindingPath()
if (!Fs.existsSync(bindingPath)) {
	throw new Error(`Native GPU addon not found for ${process.platform}-${process.arch}. Run pnpm native:build.`)
}
const binding = require(bindingPath)

const {
	_create,
	renderGPUDeviceToWindow,
	globals,
} = binding

const instances = new Set()

const fn = () => { instances.delete(null) }
let interval = null

const create = (...args) => {
	const instance = _create(...args)

	if (instances.size === 0) {
		interval = setInterval(fn, 60e3)
	}
	instances.add(instance)

	return instance
}

const destroy = (instance) => {
	instances.delete(instance)
	if (instances.size === 0) {
		clearInterval(interval)
		interval = null
	}
}

module.exports = {
	create,
	destroy,
	renderGPUDeviceToWindow,
	...globals,
}
