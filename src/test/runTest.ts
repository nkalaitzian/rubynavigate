import * as path from 'path';
import * as fs from 'fs';

import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// Download the VS Code ZIP build and run the integration test
		const vscodePath = await downloadAndUnzipVSCode('stable');
		let vscodeExecutablePath = vscodePath;
		if (process.platform === 'win32') {
			const baseDir = vscodePath.toLowerCase().endsWith('code.exe')
				? path.dirname(vscodePath)
				: vscodePath;
			const cmdPath = path.join(baseDir, 'code.cmd');
			const exePath = path.join(baseDir, 'Code.exe');
			vscodeExecutablePath = fs.existsSync(cmdPath) ? cmdPath : exePath;
		}
		await runTests({ extensionDevelopmentPath, extensionTestsPath, vscodeExecutablePath });
	} catch (err) {
		console.error('Failed to run tests', err);
		process.exit(1);
	}
}

main();
