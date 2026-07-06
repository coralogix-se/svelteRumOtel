import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** Matches Debian/apt Chromium multiprocess children (renderer, GPU, etc.), not only the main binary path. */
const BROWSER_PGREP_PATTERN = 'chromium|chrome_crashpad|google-chrome';

function sh(cmd) {
	const result = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
	return (result.stdout ?? '').trim();
}

/** @returns {number[]} */
export function findBrowserProcessPids() {
	if (process.platform === 'win32') return [];
	const out = sh(`pgrep -f '${BROWSER_PGREP_PATTERN}' 2>/dev/null || true`);
	if (!out) return [];
	return [...new Set(out.split('\n').map((s) => Number.parseInt(s, 10)).filter((n) => n > 0))];
}

/** @returns {number[]} */
function listChildPids(pid) {
	const out = sh(`pgrep -P ${pid} 2>/dev/null || true`);
	if (!out) return [];
	return out.split('\n').map((s) => Number.parseInt(s, 10)).filter((n) => n > 0);
}

/** Kill a process and every descendant (bottom-up so children die before parents). */
export function killProcessTree(pid) {
	if (process.platform === 'win32' || !pid || pid <= 1) return;

	const ordered = [];
	const walk = (p) => {
		for (const child of listChildPids(p)) walk(child);
		ordered.push(p);
	};
	walk(pid);

	for (const p of ordered) {
		try {
			process.kill(p, 'SIGKILL');
		} catch {
			/* already exited */
		}
	}
}

/** @param {import('node:child_process').ChildProcess | null | undefined} proc */
async function waitForChildExit(proc, timeoutMs = 8000) {
	if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
	await new Promise((resolve) => {
		const timer = setTimeout(resolve, timeoutMs);
		proc.once('exit', () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

/** @returns {number} */
export function countZombieBrowserProcesses() {
	if (process.platform === 'win32') return 0;
	const out = sh(
		`ps -eo stat=,comm= 2>/dev/null | awk '$1 ~ /^Z/ && ($2 ~ /chrome|chromium/)' | wc -l`
	);
	const n = Number.parseInt(out, 10);
	return Number.isFinite(n) ? n : 0;
}

/** @returns {number} */
function getProcessGroup(pid) {
	if (!pid || pid <= 1) return 0;
	const out = sh(`ps -o pgid= -p ${pid} 2>/dev/null | tr -d ' '`);
	const pgid = Number.parseInt(out, 10);
	return Number.isFinite(pgid) ? pgid : 0;
}

/** Kill every process in the browser's process group (negative PGID signal). */
export function killProcessGroup(pgid) {
	if (process.platform === 'win32' || !pgid || pgid <= 1) return;
	try {
		process.kill(-pgid, 'SIGKILL');
	} catch {
		/* group already gone */
	}
}

/** @param {number} [delayMs] */
function sleep(delayMs) {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Kill every Chromium/Chrome process in the container (safe in the harness-only image). */
export async function killAllBrowserProcesses(delayMs = 200) {
	if (process.platform === 'win32') return;

	for (let round = 0; round < 10; round++) {
		const pids = findBrowserProcessPids();
		if (!pids.length) break;
		for (const pid of pids) {
			killProcessTree(pid);
		}
		spawnSync('pkill', ['-9', '-f', BROWSER_PGREP_PATTERN], { stdio: 'ignore' });
		if (round < 9 && delayMs > 0) await sleep(delayMs);
	}
}

/** @param {Set<number>} exempt */
export async function killBrowserProcessesExcept(exempt = new Set()) {
	for (const pid of findBrowserProcessPids()) {
		if (!exempt.has(pid)) killProcessTree(pid);
	}
	await killAllBrowserProcesses();
}

/** Kill processes still holding a Puppeteer profile dir (orphans after abrupt child exit). */
export function killBrowserProcessesByUserDataDir(userDataDir) {
	if (process.platform === 'win32' || !userDataDir) return;
	const quoted = userDataDir.replace(/'/g, `'\\''`);
	const pids = sh(
		`pgrep -f '--user-data-dir=${quoted}' 2>/dev/null || pgrep -f '${quoted}' 2>/dev/null || true`
	);
	if (!pids) return;
	for (const pid of pids.split('\n')) {
		const n = Number.parseInt(pid, 10);
		if (n > 0) killProcessTree(n);
	}
}

/**
 * Reap leftover node/chromium children of the harness loop (e.g. after SIGKILL cap).
 * @param {number} [loopPid]
 */
export async function killHarnessChildProcesses(loopPid = process.pid) {
	if (process.platform === 'win32') return;

	const children = sh(`pgrep -P ${loopPid} 2>/dev/null || true`);
	if (children) {
		for (const pid of children.split('\n')) {
			const n = Number.parseInt(pid, 10);
			if (n > 0) killProcessTree(n);
		}
	}
	await killAllBrowserProcesses();
}

/**
 * @param {import('puppeteer').Browser | null | undefined} browser
 * @param {{ userDataDir?: string }} [opts]
 */
export async function disposePuppeteerBrowser(browser, opts = {}) {
	const { userDataDir } = opts;

	if (browser) {
		try {
			const pages = await browser.pages();
			await Promise.all(pages.map((p) => p.close().catch(() => {})));
		} catch {
			/* browser may already be disconnected */
		}
		const proc = browser.process?.();
		const pid = proc?.pid;
		const pgid = pid ? getProcessGroup(pid) : 0;
		await browser.close().catch(() => {});
		await waitForChildExit(proc);
		await sleep(400);
		if (pgid) killProcessGroup(pgid);
		if (pid) killProcessTree(pid);
	}

	if (userDataDir) {
		killBrowserProcessesByUserDataDir(userDataDir);
		try {
			rmSync(userDataDir, { recursive: true, force: true });
		} catch {
			/* profile dir may already be gone */
		}
	}

	await killAllBrowserProcesses();
}
