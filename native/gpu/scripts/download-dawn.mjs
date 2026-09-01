import Fs from 'fs'
import Path from 'path'
import { execFileSync } from 'child_process'
import C from './util/common.js'

console.log("clone", C.dawn.url)
await Fs.promises.rm(C.dir.dawn, { recursive: true }).catch(() => {})
await Fs.promises.mkdir(C.dir.dawn, { recursive: true })
execFileSync('git', [...C.gitConfigArgs, 'init'], { stdio: 'inherit', cwd: C.dir.dawn })
execFileSync('git', [...C.gitConfigArgs, 'remote', 'add', 'origin', C.dawn.url], { stdio: 'inherit', cwd: C.dir.dawn })
execFileSync('git', [...C.gitConfigArgs, 'fetch', '--depth', '1', 'origin', C.dawn.commit], { stdio: 'inherit', cwd: C.dir.dawn })
execFileSync('git', [...C.gitConfigArgs, 'checkout', 'FETCH_HEAD'], { stdio: 'inherit', cwd: C.dir.dawn })

console.log("applying dawn.patch")
process.chdir(C.dir.dawn)
execFileSync('git', [...C.gitConfigArgs, 'apply', '--recount', '--ignore-space-change', '--ignore-whitespace', '--exclude=DEPS', Path.join(C.dir.root, 'dawn.patch')], {
	stdio: 'inherit',
})
