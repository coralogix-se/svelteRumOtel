# Agent notes — running the demo and RUM harness

## Svelte RUM demo

Start **two** processes from the repo root (order does not matter):

1. **Backend:** `npm run api` — FastAPI on port **8000** (`/docs` for Swagger).
2. **Frontend:** `npm run dev` — Vite on port **5173** (chat at `/`).

Prereqs: `npm install`, backend venv + `pip install -r backend/requirements.txt`, `.env` configured (see `.env.template` / README). The Python API exports OTLP to a **local OpenTelemetry Collector** (default `http://localhost:4317`); put your Coralogix Send-Your-Data key on the collector (`CORALOGIX_PRIVATE_KEY` in `otel-collector-config.yaml`), not in the app’s OTLP client.

### One-shot demo restart

For local demo only, **`npm run demo:start`** runs `scripts/demo-start.sh`: stops matching long-running processes (same patterns as below), sources **`.env`** (copy from `.env.template`; keys are not stored in git), writes logs under **`.logs/`**, and starts `npm run api` + `npm run dev`. Options: `--collector` (local `otelcol-contrib`), `--rum-loop`. **`npm run demo:stop`** / **`npm run demo:restart`** wrap the same script.

## Restart tooling — **every time** after edits

**Do not rely on HMR or `--reload` alone.** After **any** code or config change in this repo (frontend, backend, harness, **otel-collector-config.yaml**, `.env`, dependencies), **always** restart the long-running processes so what’s running matches the workspace.

**Agents:** do this **at the end of every task** that changes behavior or config—not only when the user says “restart.”

1. **Stop:** `pkill -f 'otelcol-contrib.*otel-collector-config'` (local OTEL collector), `pkill -f 'uvicorn main:app'` (API), `pkill -f 'vite dev'` (Vite), `pkill -f 'rum-harness-loop.mjs'` (loop harness).
2. **Start collector** (if you use it): from repo root, load `.env` and run `otelcol-contrib` with `otel-collector-config.yaml` (see team `/tmp/otelcol-svelteRum.log` pattern), or your usual command.
3. **Start:** `npm run api` and `npm run dev`; wait until `http://localhost:5173` and `http://localhost:8000/health` (or `/docs`) respond.
4. **Start** `npm run test:rum:loop` again if the user expects continuous RUM traffic.

## RUM test harness

The harness (`tests/rum-harness.mjs`) drives Puppeteer against **`http://localhost:5173`** (override with `BASE_URL`). It needs the **dev server** up; for real chat replies it also needs the **API** on 8000.

From repo root:

```bash
npm run test:rum
```

Uses `node --env-file=.env`.

**Dual stacks** (different RUM keys / regions, e.g. K8s team A + B): **`npm run test:rum:both`** with **`BASE_URL_TEAM_A`** / **`BASE_URL_TEAM_B`** (or **`RUM_HARNESS_PARALLEL=1`** for two browsers at once). Same harness binary; each page loads its own RUM snippet from runtime env per deployment.

### Continuous loop (background RUM traffic)

Runs on a timer (`tests/rum-harness-loop.mjs`, default **5 minutes**). With **`BASE_URL_TEAM_A`** and **`BASE_URL_TEAM_B`** set, each cycle runs **`tests/run-rum-both.mjs`** (both stacks). Otherwise runs a single harness and uses repo **`.env`** when present.

Local: start Vite + API first, then:

```bash
npm run test:rum:loop
```

**EKS:** `deploy/k8s/ai-agent-sim/rum-harness-dual.yaml` — build/push **`svelte-chatbot-rum-harness`** (`deploy/docker/Dockerfile.harness`); `kubectl apply -k deploy/k8s/ai-agent-sim/` includes a Deployment that runs the loop in-cluster against both frontends’ ClusterIPs.

Leave it in a dedicated terminal or run as a background job. If dev or API stops, later iterations fail until you restart those servers; the loop keeps scheduling.

**Stop:** `Ctrl+C` in that terminal, or `pkill -f 'rum-harness-loop.mjs'`.

Before the first chat message, the harness waits for RUM session replay (`RUM_HARNESS_WAIT_RUM_RECORDING=1`, default; `RUM_HARNESS_RUM_RECORDING_TIMEOUT_MS`, default 15000) via `window.__svelteRumHarness` / a `sessionrecording` network response — improves AI Explorer `hasRecording` correlation (same pattern as customai).

## EKS (`ai-agent-sim`) — **rebuild & rollout after every change**

Whenever you change **anything** that ships in Docker (frontend, backend Python, harness scripts/images, Dockerfile, app env baked into layers) or manifests that imply a rolling update of those workloads:

1. **`npm run deploy:eks`** — from repo root. This **build/pushes** **`linux/amd64`** images to **`REGISTRY`** (default matching `deploy/k8s/ai-agent-sim/*.yaml`), then **`kubectl rollout restart`** + **`rollout status`** for both chat stacks + **`rum-harness-dual`**.

Subset builds (faster iterations): **`npm run deploy:eks:frontend`**, **`deploy:eks:backend`**, **`deploy:eks:harness`**.

Overrides: **`REGISTRY=…`** **`NAMESPACE=ai-agent-sim`** **`PLATFORM=linux/amd64`**.

Prereqs: ECR **`docker login`**, **`kubectl`** context on the cluster. Config-only tweaks (collector ConfigMap alone) still need **`kubectl apply -k deploy/k8s/ai-agent-sim/`**; restart **`otel-collector-chatbot`** if the pod doesn’t reload.

Agents: treat **`npm run deploy:eks`** (or the appropriate subset script) as **required cleanup** after tasks that touched cluster-bound code—not only when the user explicitly asks to deploy.

## Quick verification

Wait until both respond, then run the harness:

```bash
curl -sf -o /dev/null http://localhost:5173/ && curl -sf -o /dev/null http://localhost:8000/docs && npm run test:rum
```
