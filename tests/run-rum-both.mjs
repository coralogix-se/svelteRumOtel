#!/usr/bin/env node
/**
 * Runs tests/rum-harness.mjs against one or two app URLs (dual Coralogix RUM stacks).
 *
 * Pairing matches K8s: instance 1 = US2 RUM + OTLP :34317, instance 2 = EU1 + :34327.
 * Uses the SAME harness logic each time; only BASE_URL differs (each page loads its own RUM key).
 *
 * Env (repo root cwd, inherits .env):
 *   BASE_URL_TEAM_A — first harness target (optional)
 *   BASE_URL_TEAM_B — second harness target (optional)
 *   Aliases: RUM_HARNESS_URL_A, RUM_HARNESS_URL_B
 *
 * If neither team URL is set, falls back to a single run: BASE_URL or http://localhost:5173
 *
 * Sequential by default (one browser at a time). Set RUM_HARNESS_PARALLEL=1 to launch both Puppeteers
 * together (more CPU/RAM).
 *
 * When both team URLs are set, RUM_HARNESS_CONTINUE_ON_ERROR=1 (default in K8s rum-harness-dual) runs
 * team B even if team A fails, so EU1 still gets synthetic RUM traffic while US2 is debugged.
 *
 * **RUM_HARNESS_CHILD_MAX_MS** — per spawned **rum-harness.mjs** wall clock (default 32 min), same as the loop.
 */
import { spawn } from 'child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { killAllBrowserProcesses, killProcessTree } from './rum-harness-chrome-cleanup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function numEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PER_HARNESS_SPAWN_MAX_MS = numEnv('RUM_HARNESS_CHILD_MAX_MS', 32 * 60 * 1000);

function nodeArgsForChild() {
  const harnessRel = join('tests', 'rum-harness.mjs');
  const envPath = join(ROOT, '.env');
  const args = [];
  if (existsSync(envPath)) {
    args.push('--env-file=.env');
  }
  args.push(harnessRel);
  return args;
}

function collectTargets() {
  const pairs = [];
  const a =
    process.env.BASE_URL_TEAM_A?.trim() || process.env.RUM_HARNESS_URL_A?.trim();
  const b =
    process.env.BASE_URL_TEAM_B?.trim() || process.env.RUM_HARNESS_URL_B?.trim();
  if (a) pairs.push(['team-A (instance 1 / US2 RUM)', a]);
  if (b) pairs.push(['team-B (instance 2 / EU1 RUM)', b]);
  if (!pairs.length) {
    pairs.push([
      'default',
      process.env.BASE_URL?.trim() || 'http://localhost:5173',
    ]);
  }
  return pairs;
}

function runHarnessOnce(label, baseUrl) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` RUM harness → ${label}`);
  console.log(` BASE_URL=${baseUrl}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return new Promise((resolve, reject) => {
    const child = spawn('node', nodeArgsForChild(), {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        RUM_HARNESS_PERSONA: label.includes('team-A')
          ? 'vega'
          : label.includes('team-B')
            ? 'orion'
            : 'guest',
      },
    });
    let deathWatch = null;
    const killTimer = setTimeout(() => {
      console.error(
        `[run-rum-both] ${label}: exceeded ${PER_HARNESS_SPAWN_MAX_MS}ms — SIGTERM`
      );
      child.kill('SIGTERM');
      deathWatch = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* exited */
        }
      }, 10_000);
    }, PER_HARNESS_SPAWN_MAX_MS);
    child.on('close', (code, signal) => {
      clearTimeout(killTimer);
      if (deathWatch) clearTimeout(deathWatch);
      void (async () => {
        if (child.pid) killProcessTree(child.pid);
        await killAllBrowserProcesses();
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          reject(
            new Error(
              `Harness killed (${signal}) after ${PER_HARNESS_SPAWN_MAX_MS}ms (${label})`
            )
          );
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(`Harness exit ${code} (${label})`));
      })();
    });
    child.on('error', (err) => {
      clearTimeout(killTimer);
      if (deathWatch) clearTimeout(deathWatch);
      void (async () => {
        if (child.pid) killProcessTree(child.pid);
        await killAllBrowserProcesses();
        reject(err);
      })();
    });
  });
}

const targets = collectTargets();

const parallel = process.env.RUM_HARNESS_PARALLEL === '1';
const continueOnError =
	process.env.RUM_HARNESS_CONTINUE_ON_ERROR === '1' ||
	process.env.RUM_HARNESS_CONTINUE_ON_ERROR === 'true';

(async () => {
  try {
    if (parallel && targets.length > 1) {
      const results = await Promise.allSettled(
        targets.map(([label, url]) => runHarnessOnce(label, url))
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) {
        failed.forEach((r) =>
          console.error('[run-rum-both]', r.reason?.message ?? r.reason)
        );
      }
      if (failed.length === results.length) {
        console.error(
          `[run-rum-both] All ${results.length} parallel harness run(s) failed`
        );
        process.exit(1);
      }
      console.log('\n[run-rum-both] All harness runs finished (parallel).');
    } else {
      let failures = 0;
      for (const [label, url] of targets) {
        try {
          await runHarnessOnce(label, url);
        } catch (e) {
          console.error('[run-rum-both]', e.message);
          failures++;
          if (!continueOnError) {
            process.exit(1);
          }
        }
      }
      console.log(
        `\n[run-rum-both] Done (${targets.length} run(s), sequential)${
          failures ? ` (${failures} failure(s); continued)` : ''
        }.`
      );
      if (failures === targets.length) {
        process.exit(1);
      }
    }
  } catch (e) {
    console.error('[run-rum-both]', e.message);
    process.exit(1);
  }
})();
