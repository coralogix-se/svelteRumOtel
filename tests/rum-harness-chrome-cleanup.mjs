import { spawnSync } from 'child_process';

/** Kill a process and any descendants (Linux harness containers only). */
export function killProcessTree(pid) {
	if (process.platform === 'win32' || !pid || pid <= 1) return;
	spawnSync('sh', ['-c', `pkill -9 -P ${pid} 2>/dev/null; kill -9 ${pid} 2>/dev/null`], {
		stdio: 'ignore'
	});
}

/** Best-effort cleanup of stray Chrome/Chromium after Puppeteer runs. */
export function killOrphanedChromeProcesses() {
	if (process.platform === 'win32') return;
	spawnSync(
		'sh',
		['-c', "pkill -9 -f '(^|/)(chrome|chromium)( |$|-)' 2>/dev/null || true"],
		{ stdio: 'ignore' }
	);
}

/**
 * Reap leftover node/chromium children of the harness loop (e.g. after SIGKILL cap).
 * @param {number} [loopPid]
 */
export function killHarnessChildProcesses(loopPid = process.pid) {
	if (process.platform === 'win32') return;
	spawnSync(
		'sh',
		[
			'-c',
			`
        for child in $(pgrep -P ${loopPid} 2>/dev/null); do
          pkill -9 -P "$child" 2>/dev/null || true
          kill -9 "$child" 2>/dev/null || true
        done
      `
		],
		{ stdio: 'ignore' }
	);
	killOrphanedChromeProcesses();
}

/**
 * @param {import('puppeteer').Browser | null | undefined} browser
 */
export async function disposePuppeteerBrowser(browser) {
	if (!browser) return;
	try {
		const pages = await browser.pages();
		await Promise.all(pages.map((p) => p.close().catch(() => {})));
	} catch {
		/* browser may already be disconnected */
	}
	const pid = browser.process?.()?.pid;
	await browser.close().catch(() => {});
	if (pid) killProcessTree(pid);
	killOrphanedChromeProcesses();
}
