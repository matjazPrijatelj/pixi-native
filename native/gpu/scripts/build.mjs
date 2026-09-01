import C from './util/common.js'
import { removeDirectory } from './util/remove-directory.mjs'
import { initializeWindowsDevEnvironment } from './windows-dev-environment.mjs'

initializeWindowsDevEnvironment()
await import('./preflight.mjs')

await Promise.all([
	C.dir.depotTools,
	C.dir.dawn,
	C.dir.build,
	C.dir.dist,
	C.dir.publish,
].map(async (dir) => {
	await removeDirectory(dir)
}))

await import('./download-depot-tools.mjs')
await import('./download-dawn.mjs')
await import('./configure.mjs')
await import('./make.mjs')
