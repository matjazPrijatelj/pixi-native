import Fs from 'fs'

// Large Dawn checkouts can remain briefly locked by Git or antivirus on Windows.
// Retry their removal, but never continue with a partially cleaned directory.
export const removeDirectory = async (directory) => {
	try {
		await Fs.promises.rm(directory, {
			force: true,
			maxRetries: process.platform === 'win32' ? 20 : 2,
			recursive: true,
			retryDelay: 250,
		})
	}
	catch (error) {
		throw new Error(`Failed to clean native build directory: ${directory}`, { cause: error })
	}
}
