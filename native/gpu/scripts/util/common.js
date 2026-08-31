const Fs = require('fs')
const Path = require('path')

const { platform, arch } = process
const targetArch = process.env.CROSS_COMPILE_ARCH || arch

const dir = {}
dir.root = Path.resolve(__dirname, '../..')
dir.depotTools = Path.join(dir.root, 'depot_tools')
dir.dawn = Path.join(dir.root, 'dawn')
dir.abseil = Path.join(dir.root, 'dawn/third_party/abseil-cpp')
dir.build = Path.join(dir.root, 'build')
dir.distRoot = Path.join(dir.root, 'dist')
dir.dist = Path.join(dir.distRoot, `${platform}-${targetArch}`)
dir.publish = Path.join(dir.root, 'publish')

const pkgPath = Path.join(dir.root, 'package.json')
const pkg = JSON.parse(Fs.readFileSync(pkgPath).toString())
const version = pkg.version
const isPrerelease = version.includes('-')
const [ , owner, repo ] = pkg.repository.url.match(/([^/:]+)\/([^/]+).git$/u)

const assetName = `dawn-v${version}-${platform}-${targetArch}.tar.gz`
const gitConfigArgs = platform === 'win32' ? ['-c', 'http.sslBackend=openssl'] : []
const gitConfigEnv = platform === 'win32' ? {
	GIT_CONFIG_COUNT: '1',
	GIT_CONFIG_KEY_0: 'http.sslBackend',
	GIT_CONFIG_VALUE_0: 'openssl',
} : {}

const { config: { depotTools, dawn } } = pkg
depotTools.env = platform === 'win32' ? {
	DEPOT_TOOLS_WIN_TOOLCHAIN: '0',
	PATH: `${dir.depotTools};${process.env.PATH}`,
} : {
	PATH: `${Path.join(dir.dawn, 'third_party/ninja')}:${dir.depotTools}:${process.env.PATH}`,
}

module.exports = {
	dir,
	version,
	isPrerelease,
	owner,
	repo,
	platform,
	arch,
	targetArch,
	assetName,
	gitConfigArgs,
	gitConfigEnv,
	depotTools,
	dawn,
}
