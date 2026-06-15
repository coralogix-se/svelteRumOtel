#!/usr/bin/env node
/**
 * Runs the RUM test harness on a fixed interval.
 *
 * If **BASE_URL_TEAM_A** and **BASE_URL_TEAM_B** (or RUM_HARNESS_URL_A / _B) are both set — e.g. in EKS —
 * each cycle runs **tests/run-rum-both.mjs** against both stacks. Otherwise runs **tests/rum-harness.mjs**
 * once (uses repo `.env` when present via `--env-file`).
 *
 * Local dev: unset team URLs so a single harness uses BASE_URL default (see rum-harness.mjs).
 *
 * **RUM_HARNESS_LOOP_INTERVAL_MS** — idle time after a run finishes before the next (default 300000 = 5 min).
 *
 * **RUM_HARNESS_CHILD_MAX_MS** — wall-clock cap for one **rum-harness.mjs** run (default 32 min).
 * The loop doubles this when running **run-rum-both.mjs** (two stacks). Prevents wedging for hours.
 */
import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

dotenv.config({ path: join(ROOT, '.env'), quiet: true });

function numEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const INTERVAL_MS = numEnv('RUM_HARNESS_LOOP_INTERVAL_MS', 5 * 60 * 1000);

/** Chromium orphans from failed Puppeteer launches accumulate under the loop PID in K8s. */
function killOrphanedChromium() {
	if (process.platform === 'win32') return;
	spawnSync('pkill', ['-9', '-f', 'chromium'], { stdio: 'ignore' });
}

/** Log /proc count so EAGAIN / fork leaks show up in kubectl logs before hitting ~9k PIDs. */
function logProcessBudget() {
	if (process.platform === 'win32') return;
	const procCount = spawnSync('sh', ['-c', 'ls -1 /proc 2>/dev/null | wc -l'], {
		encoding: 'utf8'
	});
	const chromiumCount = spawnSync('sh', ['-c', 'pgrep -c chromium 2>/dev/null || echo 0'], {
		encoding: 'utf8'
	});
	const procs = procCount.stdout?.trim() ?? '?';
	const chromes = chromiumCount.stdout?.trim() ?? '?';
	const warn = Number(procs) > 300 ? ' WARN_HIGH_PROC_COUNT' : '';
	console.log(`[rum-harness-loop] process budget: procs=${procs} chromium=${chromes}${warn}`);
}

function harnessEntrypoint() {
  const hasA =
    Boolean(process.env.BASE_URL_TEAM_A?.trim()) ||
    Boolean(process.env.RUM_HARNESS_URL_A?.trim());
  const hasB =
    Boolean(process.env.BASE_URL_TEAM_B?.trim()) ||
    Boolean(process.env.RUM_HARNESS_URL_B?.trim());
  const dual = hasA && hasB;

  const rel = dual ? join('tests', 'run-rum-both.mjs') : join('tests', 'rum-harness.mjs');
  const args = [];
  if (!dual) {
    const envPath = join(ROOT, '.env');
    if (existsSync(envPath)) {
      args.push('--env-file=.env');
    }
  }
  args.push(rel);
  return { args, dual };
}

async function runHarness() {
  const { args, dual } = harnessEntrypoint();
  const perHarnessMs = numEnv('RUM_HARNESS_CHILD_MAX_MS', 32 * 60 * 1000);
  const spawnMaxMs = dual ? perHarnessMs * 2 + 120_000 : perHarnessMs;

  return new Promise((resolve, reject) => {
    const child = spawn('node', args, {
      stdio: 'inherit',
      cwd: ROOT,
      env: { ...process.env },
    });
    let deathWatch = null;
    const killTimer = setTimeout(() => {
      console.error(
        `[rum-harness-loop] child exceeded ${spawnMaxMs}ms — sending SIGTERM`
      );
      child.kill('SIGTERM');
      deathWatch = setTimeout(() => {
        console.error('[rum-harness-loop] child still alive — SIGKILL');
        try {
          child.kill('SIGKILL');
        } catch {
          /* process may have exited */
        }
      }, 10_000);
    }, spawnMaxMs);
    const onClose = (code, signal) => {
      clearTimeout(killTimer);
      if (deathWatch) clearTimeout(deathWatch);
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new Error(`Harness killed (${signal}) after ${spawnMaxMs}ms cap`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`Exit ${code}`));
    };
    child.on('close', onClose);
    child.on('error', (err) => {
      clearTimeout(killTimer);
      if (deathWatch) clearTimeout(deathWatch);
      reject(err);
    });
  });
}

async function loop() {
  while (true) {
    const startIso = new Date().toISOString();
    console.log(`[${startIso}] Running RUM harness...`);
    try {
      await runHarness();
      const doneIso = new Date().toISOString();
      console.log(
        `[${doneIso}] Harness finished OK. Sleeping ${INTERVAL_MS}ms (${Math.round(INTERVAL_MS / 1000)}s) until next run.`
      );
    } catch (err) {
      const failIso = new Date().toISOString();
      console.error(`[${failIso}] Harness failed:`, err.message);
    } finally {
      killOrphanedChromium();
      logProcessBudget();
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
