import { execFileSync } from 'child_process'

const parseVersion = (value) => value
	.replace(/[^0-9.].*$/u, '')
	.split('.')
	.filter(Boolean)
	.map(Number)

const isAtLeast = (actual, required) => {
	const length = Math.max(actual.length, required.length)
	for (let index = 0; index < length; index++) {
		const difference = (actual[index] ?? 0) - (required[index] ?? 0)
		if (difference !== 0) return difference > 0
	}
	return true
}

const commandOutput = (command, args) => {
	try {
		return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
	}
	catch (_) {
		return null
	}
}

if (process.platform === 'win32') {
	const errors = []
	const nodeMajor = Number(process.versions.node.split('.')[0])
	if (nodeMajor !== 24) errors.push(`Node.js 24 LTS is required; found ${process.versions.node}.`)
	if (process.arch !== 'x64') errors.push(`Windows x64 is required; found ${process.arch}.`)

	if (!process.env.VSCMD_VER) {
		errors.push('Run this command from Developer PowerShell for Visual Studio 2022.')
	}
	if (!commandOutput('where.exe', ['cl.exe'])) {
		errors.push('MSVC cl.exe is not available in PATH.')
	}

	const vcToolsVersion = parseVersion(process.env.VCToolsVersion ?? '')
	if (vcToolsVersion.length > 0 && !isAtLeast(vcToolsVersion, [14, 41])) {
		errors.push(`Visual Studio 2022 v17.11 / MSVC tools 14.41 or newer are required; found ${process.env.VCToolsVersion}.`)
	}

	const windowsSdk = parseVersion(process.env.WindowsSDKVersion ?? '')
	if (windowsSdk.length === 0) {
		errors.push('Windows SDK was not detected in the developer environment; install and select SDK 10.0.26100.0 or newer.')
	}
	else if (!isAtLeast(windowsSdk, [10, 0, 26100, 0])) {
		errors.push(`Windows SDK 10.0.26100.0 or newer is required; found ${process.env.WindowsSDKVersion}.`)
	}

	if (!commandOutput('cmake.exe', ['--version'])) errors.push('CMake is required in PATH.')
	if (!commandOutput('git.exe', ['--version'])) errors.push('Git is required in PATH.')
	const goVersionOutput = commandOutput('go.exe', ['version'])
	if (!goVersionOutput) {
		errors.push('Go 1.26 or newer is required in PATH.')
	}
	else {
		const match = goVersionOutput.match(/\bgo([0-9]+(?:\.[0-9]+)+)/u)
		if (!match || !isAtLeast(parseVersion(match[1]), [1, 26])) {
			errors.push(`Go 1.26 or newer is required; found ${goVersionOutput}.`)
		}
	}

	if (errors.length > 0) {
		throw new Error(`Windows native build prerequisites are not satisfied:\n- ${errors.join('\n- ')}`)
	}

	console.log('Windows native build prerequisites OK', {
		node: process.versions.node,
		msvcTools: process.env.VCToolsVersion,
		windowsSdk: process.env.WindowsSDKVersion,
		go: goVersionOutput,
	})
}
