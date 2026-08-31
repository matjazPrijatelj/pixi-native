import Fs from 'fs'
import { execFileSync } from 'child_process'
import C from './util/common.js'

console.log("clone", C.depotTools.url)
await Fs.promises.rm(C.dir.depotTools, { recursive: true }).catch(() => {})
await Fs.promises.mkdir(C.dir.depotTools, { recursive: true })
execFileSync('git', [...C.gitConfigArgs, 'init'], { stdio: 'inherit', cwd: C.dir.depotTools })
execFileSync('git', [...C.gitConfigArgs, 'remote', 'add', 'origin', C.depotTools.url], { stdio: 'inherit', cwd: C.dir.depotTools })
execFileSync('git', [...C.gitConfigArgs, 'fetch', '--depth', '1', 'origin', C.depotTools.commit], { stdio: 'inherit', cwd: C.dir.depotTools })
execFileSync('git', [...C.gitConfigArgs, 'checkout', 'FETCH_HEAD'], { stdio: 'inherit', cwd: C.dir.depotTools })

if (C.platform === 'win32') {
	await import('./bootstrap-cipd.mjs')
	execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'gclient.bat'], {
		stdio: 'inherit',
		env: {
			...process.env,
			...C.depotTools.env,
			...C.gitConfigEnv,
		},
	})

	await Fs.promises.rm(`${C.dir.depotTools}/ninja`, { force: true })
}
