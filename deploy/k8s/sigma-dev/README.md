# SigmaDev cluster — single-stack svelteRumOtel

Deploys **one** chat stack (backend + frontend + OTEL collector + RUM harness) into namespace **`svelte-rum-sigma`** on the **SigmaDev** EKS cluster.

## Keys

Copy and fill secrets locally (gitignored):

```bash
cp deploy/k8s/sigma-dev/secret-generator.env.example deploy/k8s/sigma-dev/secret-generator.env
```

Required: `gemini-api-key`, `coralogix-otel-key`, `rum-public-key`, `coralogix-guardrails-key`.

Existing keys for other environments are tracked in **`.logs/coralogix-keys-registry.local.md`** (gitignored).

## Deploy

```bash
kubectl config use-context SigmaDev
npm run deploy:eks:sigma-dev
```

Subset builds: `npm run deploy:eks:sigma-dev:frontend`, `:backend`, `:harness`.

Public URL is appended to **`.logs/sigma-dev-frontend-public-url.log`** after deploy.

**CronJob** `frontend-public-url-logger` (every 5 minutes): resolves the NLB hostname, prints to Job pod logs, and sends the same line as OTLP logs to `otel-collector:4318`.

```bash
kubectl logs -n svelte-rum-sigma -l app=frontend-public-url-logger --tail=20
```

## Telemetry

| Component | OTLP target | Coralogix |
|-----------|-------------|-----------|
| Backend + frontend | `otel-collector:4317` | US2 via `coralogix-otel-key` |
| Browser RUM | direct to Coralogix | `rum-public-key`, domain US2 |
| Guardrails | HTTPS Guard API | `coralogix-guardrails-key` |

## Harness

In-cluster `rum-harness` hits `http://chat-frontend` every 5 minutes.

From laptop once NLB hostname is ready:

```bash
BASE_URL=http://<nlb-hostname>/ npm run test:rum
```
