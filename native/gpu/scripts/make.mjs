import Fs from 'fs'
import Path from 'path'
import { execFileSync } from 'child_process'
import C from './util/common.js'

console.log("build in", C.dir.build)
const ninjaCommand = C.platform === 'win32'
	? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'ninja.bat', '-v', '-C', C.dir.build, 'dawn.node']]
	: ['ninja', ['-v', '-C', C.dir.build, 'dawn.node']]
execFileSync(ninjaCommand[0], ninjaCommand[1], {
	stdio: 'inherit',
	env: {
		...process.env,
		...C.depotTools.env,
	},
})

console.log("copy to", C.dir.dist)
await Fs.promises.rm(C.dir.dist, { recursive: true }).catch(() => {})
await Fs.promises.mkdir(C.dir.dist, { recursive: true })
await Fs.promises.cp(
	Path.join(C.dir.build, 'dawn.node'),
	Path.join(C.dir.dist, 'dawn.node'),
)

if (C.platform === 'win32') {
	await Fs.promises.cp(
		Path.join(C.dir.build, 'd3dcompiler_47.dll'),
		Path.join(C.dir.dist, 'd3dcompiler_47.dll'),
	)
}

// Strip binaries on linux
if (C.platform === 'linux') {
	execFileSync('strip', ['-s', Path.join(C.dir.dist, 'dawn.node')])
}
