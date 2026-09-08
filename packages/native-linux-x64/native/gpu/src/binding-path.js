const Path = require('path')

const getPlatformDirectory = (platform = process.platform, arch = process.arch) => `${platform}-${arch}`

const getBindingPath = (platform = process.platform, arch = process.arch) => Path.resolve(
	__dirname,
	'../dist',
	getPlatformDirectory(platform, arch),
	'pixi_native_gpu.node',
)

module.exports = { getBindingPath, getPlatformDirectory }
