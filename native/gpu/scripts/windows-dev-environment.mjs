import Fs from 'fs'
import Path from 'path'
import { execFileSync, execSync } from 'child_process'

const REQUIRED_VISUAL_STUDIO_COMPONENT = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'

export const parseEnvironment = (output) => {
	const environment = {}
	for (const line of output.split(/\r?\n/u)) {
		const separator = line.indexOf('=')
		if (separator <= 0) continue
		environment[line.slice(0, separator)] = line.slice(separator + 1)
	}
	return environment
}

const findVsWhere = () => {
	const programFilesX86 = process.env['ProgramFiles(x86)']
	const candidates = [
		programFilesX86 && Path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
		process.env.ProgramFiles && Path.join(process.env.ProgramFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
	].filter(Boolean)

	for (const candidate of candidates) {
		if (Fs.existsSync(candidate)) return candidate
	}
	throw new Error('Visual Studio Installer vswhere.exe was not found. Install Visual Studio 2022 with Desktop development with C++.')
}

const findVisualStudioInstallation = () => execFileSync(findVsWhere(), [
	'-latest',
	'-products', '*',
	'-version', '[17.0,18.0)',
	'-requires', REQUIRED_VISUAL_STUDIO_COMPONENT,
	'-property', 'installationPath',
], {
	encoding: 'utf8',
	stdio: ['ignore', 'pipe', 'pipe'],
}).trim()

// VsDevCmd.bat can only modify its cmd.exe child, so import the resulting
// environment into this Node process before running preflight and the build.
export const initializeWindowsDevEnvironment = () => {
	if (process.platform !== 'win32' || (process.env.VSCMD_VER && process.env.VCToolsVersion)) return false

	const installationPath = findVisualStudioInstallation()
	if (!installationPath) {
		throw new Error('Visual Studio 2022 with Desktop development with C++ was not found.')
	}

	const developerCommand = Path.join(installationPath, 'Common7', 'Tools', 'VsDevCmd.bat')
	if (!Fs.existsSync(developerCommand)) {
		throw new Error(`Visual Studio developer command was not found: ${developerCommand}`)
	}

	const command = `call "${developerCommand}" -no_logo -arch=x64 -host_arch=x64 >nul && set`
	const output = execSync(command, {
		encoding: 'utf8',
		maxBuffer: 4 * 1024 * 1024,
		shell: process.env.ComSpec ?? 'cmd.exe',
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	Object.assign(process.env, parseEnvironment(output))
	console.log(`Initialized Visual Studio developer environment from ${installationPath}`)
	return true
}
