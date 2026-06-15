# Kubernetes (EKS) — `ai-agent-sim` namespace

Deploys **two isolated chat stacks** (team A / team B) into **`ai-agent-sim`**:

- **In-namespace OpenTelemetry Collector** (`otel-collector-chatbot`): OTLP **gRPC** on **`34317`** (team A) and **`34327`** (team B). Each listener has its **own** export pipeline to **one** Coralogix team (OTLP `Authorization: Bearer` using `coralogix-otel-key-team-a` / `…-team-b`). Nothing is fan-out duplicated; each app instance sends OTLP to **only** its port.
- **Two FastAPI backends** + **two SvelteKit frontends**, shared **`gemini-api-key`**, **paired keys per team**: `rum-public-key-team-*` (browser RUM, runtime env) + `coralogix-otel-key-team-*` (collector exporter — same Coralogix account as that RUM key).
- **Public HTTP (AWS)**: each **frontend** `Service` is **`type: LoadBalancer`** with an **internet-facing NLB** (listener **80** → pods **:3000**). After `npm run deploy:eks`, hostnames are appended to **`.logs/eks-frontend-public-urls.log`** (and printed). Set **`SKIP_EKS_PUBLIC_URL_LOG=1`** to skip the wait/poll.
- **Ingress** (optional): two hostnames — `/api` → matching backend, `/` → matching frontend (same-origin `/api/chat` per host); use when you prefer ALB + TLS instead of raw NLB URLs.
- **RUM harness** (`rum-harness-dual` Deployment): one pod loops every 5 minutes and runs **`tests/run-rum-both.mjs`** so **both** frontends get Puppeteer traffic in-cluster (`http://…svc.cluster.local:3000`; Svelte **`hooks.server.ts`** proxies `/api` to each team’s backend).

## Prerequisites

- `kubectl` configured for your EKS cluster.
- Docker images pushed to a registry EKS can pull (ECR, etc.).
- DNS (or `/etc/hosts`) pointing **both** Ingress hosts at the load balancer.

## 1. Build and push images

One **frontend** image is enough: RUM keys are injected at **runtime** via `PUBLIC_CORALOGIX_RUM_KEY` (see `src/routes/+layout.server.ts`). You do **not** need separate images per team unless you prefer build-arg `VITE_CORALOGIX_RUM_KEY`.

From the **repository root**:

```bash
export REGISTRY=123456789012.dkr.ecr.us-east-1.amazonaws.com   # your ECR registry

docker build -t "${REGISTRY}/svelte-chatbot-backend:latest" -f deploy/docker/Dockerfile.backend .

docker build -t "${REGISTRY}/svelte-chatbot-frontend:latest" -f deploy/docker/Dockerfile.frontend .

docker push "${REGISTRY}/svelte-chatbot-backend:latest"
docker push "${REGISTRY}/svelte-chatbot-frontend:latest"

docker build -t "${REGISTRY}/svelte-chatbot-rum-harness:latest" -f deploy/docker/Dockerfile.harness .

docker push "${REGISTRY}/svelte-chatbot-rum-harness:latest"
```

Edit **`image:`** in `deploy/k8s/ai-agent-sim/chat-team-a.yaml`, `chat-team-b.yaml`, and **`rum-harness-dual.yaml`** if your registry or tags differ.

## 2. Create secrets (do not commit real keys)

```bash
cd deploy/k8s/ai-agent-sim
cp secret-generator.env.example secret-generator.env   # gitignored — fill all REPLACE_ME keys
```

Required Secret keys (via `secretGenerator`): **`gemini-api-key`**, **`coralogix-otel-key-team-a`**, **`coralogix-otel-key-team-b`**, **`rum-public-key-team-a`**, **`rum-public-key-team-b`**. Optional Guardrails: **`coralogix-guardrails-key`** (team A / US2) and **`coralogix-guardrails-key-team-b`** (team B / EU1 — Deployment uses **`CX_GUARDRAILS_ENDPOINT`** to `api.eu1.coralogix.com`).

Then from repo root:

```bash
kubectl apply -k deploy/k8s/ai-agent-sim/
```

Confirm: `kubectl get secret svelte-chatbot-app -n ai-agent-sim` — `DATA` should reflect how many keys you defined.

### Coralogix Guardrails

Guardrails use Coralogix’s **Guardrails HTTP API**, not OTLP. OTLP ingestion keys **will not work** on `…/api/v1/guardrails/guard` (expect 403).

1. Create a **Guardrails API key** per region/stack (same type as local `CORALOGIX_GUARDRAILS_KEY`, not OTLP).
2. In `secret-generator.env`: **`coralogix-guardrails-key`** for team A (US2 REST). **`coralogix-guardrails-key-team-b`** for team B (EU1 — must match **`CX_GUARDRAILS_ENDPOINT`** already set on the team‑B Deployment).

3. **`GUARDRAILS_ENABLED`** is **`"true"`** in manifests (enforcement). Use **`"false"`** for observe-only.

4. Region: team A uses default **US2** Guard REST in code unless overridden. Team B manifests set **`CX_GUARDRAILS_ENDPOINT`** to **`https://api.eu1.coralogix.com/api/v1/guardrails/guard`**.

5. Restart backends after Secret changes:

```bash
kubectl rollout restart deployment/chat-backend-team-a deployment/chat-backend-team-b -n ai-agent-sim
```

## 3. Public URLs (LoadBalancer) and Ingress

### 3.1 NLB URLs (default in manifests)

Frontends use **AWS NLB** annotations on `chat-frontend-team-a` / `chat-frontend-team-b`. Ensure your cluster can provision load balancers (subnets tagged for ELB, node security groups, etc.).

From repo root after deploy:

- **`./.logs/eks-frontend-public-urls.log`** — timestamped **`http://<nlb-hostname>/`** lines for Team A and Team B (append-only across deploys).
- **`kubectl get svc -n ai-agent-sim 'chat-frontend-team-*'`** — `EXTERNAL-IP` / hostname column while `PENDING` clears.
- **`frontend-public-url-logger` CronJob** (every **5 minutes**): resolves NLB hostnames, prints lines to **Job pod logs** (`kubectl logs -n ai-agent-sim -l app=frontend-public-url-logger --tail=100`), and sends the **same text** as **OTLP/JSON** logs to the in-namespace collector on **HTTP `:34318`** (team A → US2 pipeline) and **`:34328`** (team B → EU1). In each Coralogix account, search logs for **`frontend-public-url-logger`** or **`service.name`** = **`frontend-public-url-logger`** (resource also sets **`cx.application.name`** = `svelte-chatbot`, **`cx.subsystem.name`** = `public-url-logger`).

Traffic is **HTTP** on port 80 (no TLS on the NLB in this demo). Same-origin **`/api/*`** is still proxied by SvelteKit to each team’s backend via **`CHAT_API_ORIGIN`**.

### 3.2 Ingress hostnames (optional)

Edit `deploy/k8s/ai-agent-sim/ingress.yaml`:

- Set **`chat-team-a.example.com`** and **`chat-team-b.example.com`** to real DNS (or `/etc/hosts`).
- Match **`ingressClassName`** to your cluster (`alb`, `nginx`, etc.).

Re-apply after edits.

## 4. Telemetry flow

Telemetry is split by **which OTLP port each app hits** inside the collector — **not** by routing one shared stream.

| Stack   | OTLP gRPC (apps → collector) | Collector pipeline → exporter → Coralogix | Browser RUM |
|--------|------------------------------|--------------------------------------------|---------------|
| **Instance 1 (team A)** | **Only `:34317`** | `traces/logs/metrics/team_a` → **`otlp/cx_a`** → **`ingress.us2.coralogix.com`** (US2 Bearer `coralogix-otel-key-team-a`) | `rum-public-key-team-a`, domain **US2** |
| **Instance 2 (team B)** | **Only `:34327`** | `traces/logs/metrics/team_b` → **`otlp/cx_b`** → **`ingress.eu1.coralogix.com`** (EU1 Bearer `coralogix-otel-key-team-b`) | `rum-public-key-team-b`, domain **EU1** |

Traffic from `:34317` never enters the `:34327` pipelines (and vice versa), so US2 and EU1 remain **two separate exporters** with no fan-out duplication.

Use an EU1 **Send your data → OpenTelemetry** API key for **`coralogix-otel-key-team-b`** (same Coralogix account as the EU1 RUM key).

## 5. RUM test harness (two stacks)

Production layout: **separate browser RUM keys** per stack (team A vs B in `secret-generator.env`). The **collector** uses **two OTLP exporters** (`otlp/cx_a` → US2, `otlp/cx_b` → EU1); each frontend/backend pair only sends OTLP to its port (**34317** vs **34327**).

**In-cluster** `rum-harness-dual` uses `http://chat-frontend-team-*.ai-agent-sim.svc.cluster.local` (Service port **80**).

From your laptop, use the **NLB URLs** from **`.logs/eks-frontend-public-urls.log`** or **`kubectl get svc`**, or **Ingress** hostnames if you enabled TLS + DNS:

```bash
BASE_URL_TEAM_A=http://k8s-aiaagent-chatfr-xxxxx.elb.us-west-2.amazonaws.com/ \
BASE_URL_TEAM_B=http://k8s-aiaagent-chatfr-yyyyy.elb.us-west-2.amazonaws.com/ \
npm run test:rum:both
```

With Ingress + TLS:

```bash
BASE_URL_TEAM_A=https://chat-team-a.example.com \
BASE_URL_TEAM_B=https://chat-team-b.example.com \
npm run test:rum:both
```

Aliases: **`RUM_HARNESS_URL_A`** / **`RUM_HARNESS_URL_B`**. Optionally **`RUM_HARNESS_PARALLEL=1`** runs two Puppeteers at once.

Single-stack or ad hoc:

```bash
BASE_URL=https://chat-team-a.example.com npm run test:rum
```

For NLB-only demos, use **`http://`** until you terminate TLS elsewhere. Ensure DNS or direct ELB hostname resolves.

## Troubleshooting

- **Upgrading from the old single-stack manifests** (`chat-backend` / `chat-frontend` pointing at `codeagentsim`): delete leftover objects after applying this kustomization, e.g. `kubectl delete deployment,svc chat-backend chat-frontend -n ai-agent-sim --ignore-not-found`.
- **`EXTERNAL-IP` / hostname stays `<pending>`**: AWS subnet tags / IAM for ELB creation; wait a few minutes after `kubectl apply`.
- Ingress 404 on `/api`: keep **`/api`** path **before** **`/`** (already ordered).
- Collector CrashLoop: verify Secret keys **`coralogix-otel-key-team-a`** / **`…-b`** exist and match region.
- No traces in a team: confirm that stack’s backend **and** frontend use the **same** collector port (`34317` vs `34327`) and that RUM key for that host matches the same Coralogix account as the OTLP key on that pipeline.
- **`rum-harness-dual`** CrashLoop / OOM: ensure **`svelte-chatbot-rum-harness`** image is built and pushed; raise memory limit if Puppeteer/chrome needs it. Logs: `kubectl logs deployment/rum-harness-dual -n ai-agent-sim`.
