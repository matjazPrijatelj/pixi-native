import Fs from 'fs'
import Path from 'path'
import { execFileSync } from 'child_process'
import C from './util/common.js'

process.chdir(C.dir.dawn)
await Fs.promises.cp('scripts/standalone-with-node.gclient', '.gclient')

const needsSync = !Fs.existsSync(Path.join(C.dir.dawn, '.gclient_previous_sync_commits'))
if (needsSync) {
	console.log("run gclient sync")
	const gclientCommand = C.platform === 'win32'
		? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'gclient.bat', 'sync', '--no-history', '-j8', '-vvv']]
		: ['gclient', ['sync', '--no-history', '-j8', '-vvv']]
	execFileSync(gclientCommand[0], gclientCommand[1], {
		stdio: 'inherit',
		env: {
			...process.env,
			...C.depotTools.env,
			...C.gitConfigEnv,
			DEPOT_TOOLS_UPDATE: '0',
		},
	})
}

process.chdir(C.dir.abseil)
const abseilPatch = Path.join(C.dir.root, 'abseil-cpp.patch')
if (needsSync) {
	console.log("applying abseil-cpp.patch")
	execFileSync('git', [...C.gitConfigArgs, 'apply', '--ignore-space-change', '--ignore-whitespace', abseilPatch], {
		stdio: 'inherit',
	})
}


process.chdir(C.dir.dawn)
console.log("configure build in", C.dir.build)

if (!Fs.existsSync(C.dir.ninja)) {
	throw new Error(`Pinned Dawn Ninja executable was not found: ${C.dir.ninja}`)
}

if (process.env.DAWN_CLEAN_BUILD === '1') {
	await Fs.promises.rm(C.dir.build, { recursive: true }).catch(() => {})
}
await Fs.promises.mkdir(C.dir.build, { recursive: true })

let CFLAGS
let LDFLAGS
let crossCompileFlag
let backendFlags = []
let windowsToolchainArgs = []
const cmakePath = (value) => value.replaceAll('\\', '/')
if (C.platform === 'darwin') {
	let arch = process.env.CROSS_COMPILE_ARCH ?? C.arch
	if (arch === 'x64') { arch = 'x86_64' }

	crossCompileFlag = `-DCMAKE_OSX_ARCHITECTURES=${arch}`

	if (C.targetArch === 'arm64') {
		CFLAGS = '-mmacosx-version-min=11.0'
		LDFLAGS = '-mmacosx-version-min=11.0'
	}
	else {
		CFLAGS = [
			'-mmacosx-version-min=10.9',
			'-DMAC_OS_X_VERSION_MIN_REQUIRED=1070',
		].join(' ')
		LDFLAGS = '-mmacosx-version-min=10.9'
	}
}
else if (C.platform === 'linux') {
	backendFlags = [
		'-DDAWN_USE_X11=ON',
		'-DDAWN_USE_WAYLAND=OFF',
	]
}
else if (C.platform === 'win32') {
	backendFlags = [
		'-DDAWN_USE_WINDOWS_UI=ON',
		'-DDAWN_ENABLE_D3D12=ON',
	]
	// CMake may prefer an LLVM clang installation found earlier in PATH even
	// after VsDevCmd initialized MSVC. Resolve the compiler and linker from the
	// same MSVC bin directory so Ninja cannot silently mix CRT/toolchains.
	const clOutput = execFileSync('where.exe', ['cl.exe'], { encoding: 'utf8' })
	const clPath = clOutput.split(/\r?\n/u).map((line) => line.trim()).find(Boolean)
	if (!clPath) throw new Error('MSVC cl.exe was not found after Visual Studio initialization.')
	const msvcBin = Path.dirname(clPath)
	const linkPath = Path.join(msvcBin, 'link.exe')
	if (!Fs.existsSync(linkPath)) throw new Error(`MSVC linker was not found beside cl.exe: ${linkPath}`)
	const findWindowsTool = (name) => {
		const output = execFileSync('where.exe', [`${name}.exe`], { encoding: 'utf8' })
		const resolved = output.split(/\r?\n/u).map((line) => line.trim()).find(Boolean)
		if (!resolved) throw new Error(`Windows SDK tool ${name}.exe was not found after Visual Studio initialization.`)
		return resolved
	}
	const rcPath = findWindowsTool('rc')
	const mtPath = findWindowsTool('mt')
	windowsToolchainArgs = [
		`-DCMAKE_C_COMPILER=${cmakePath(clPath)}`,
		`-DCMAKE_CXX_COMPILER=${cmakePath(clPath)}`,
		`-DCMAKE_LINKER=${cmakePath(linkPath)}`,
		`-DCMAKE_RC_COMPILER=${cmakePath(rcPath)}`,
		`-DCMAKE_MT=${cmakePath(mtPath)}`,
	]
}

const cmakeArgs = [
	'-S',
	C.dir.dawn,
	'-B',
	C.dir.build,
	'-GNinja',
	`-DCMAKE_PROJECT_INCLUDE=${cmakePath(Path.join(C.dir.root, 'addon', 'bootstrap.cmake'))}`,
	`-DPIXI_NATIVE_GPU_ADDON_DIR=${cmakePath(Path.join(C.dir.root, 'addon'))}`,
	`-DCMAKE_MAKE_PROGRAM=${C.dir.ninja}`,
	'-DCMAKE_BUILD_TYPE=Release',
	'-DCMAKE_CXX_SCAN_FOR_MODULES=OFF',
	'-DDAWN_SUPPORTS_CXX_MODULES=OFF',
	'-DTINT_BUILD_SPV_READER=OFF',
	'-DTINT_BUILD_SPV_WRITER=ON',
	'-DTINT_BUILD_GLSL_WRITER=OFF',
	'-DTINT_BUILD_GLSL_VALIDATOR=OFF',
	'-DTINT_BUILD_IR_BINARY=OFF',
	'-DDAWN_BUILD_NODE_BINDINGS=ON',
	'-DDAWN_ENABLE_DESKTOP_GL=OFF',
	'-DDAWN_ENABLE_OPENGLES=OFF',
	'-DDAWN_BUILD_SAMPLES=OFF',
	'-DTINT_BUILD_TESTS=OFF',
	'-DTINT_BUILD_CMD_TOOLS=OFF',
	'-DDAWN_USE_GLFW=OFF',
	'-DDAWN_SUPPORTS_GLFW_FOR_WINDOWING=OFF',
	'-DDAWN_ENABLE_PIC=ON',
	'-DDAWN_ENABLE_SPIRV_VALIDATION=OFF',
	'-DDAWN_ALWAYS_ASSERT=ON',
	crossCompileFlag,
	...windowsToolchainArgs,
	...backendFlags,
].filter(Boolean)
const childEnv = {
	...process.env,
	...C.depotTools.env,
}
if (C.platform === 'win32') {
	// Do not let inherited Unix/LLVM compiler hints override the explicit MSVC
	// CMake cache entries above.
	delete childEnv.CC
	delete childEnv.CXX
	delete childEnv.CMAKE_C_COMPILER
	delete childEnv.CMAKE_CXX_COMPILER
	delete childEnv.CMAKE_LINKER
	// Node can expose both case variants after importing `set` output from
	// VsDevCmd.bat; keep them identical when spawning CMake/Ninja.
	childEnv.Path = childEnv.PATH
}
if (CFLAGS) childEnv.CFLAGS = CFLAGS
if (LDFLAGS) childEnv.LDFLAGS = LDFLAGS
execFileSync('cmake', cmakeArgs, {
	stdio: 'inherit',
	env: childEnv,
})
