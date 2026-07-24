# svelteRum

SvelteKit chatbot with a Strands coordinator and specialist agents backed by Google Gemini 2.5 Flash Lite. Includes Coralogix RUM, session replay, end-to-end OpenTelemetry trace propagation, Guardrails, and agent/model/tool spans for Coralogix AI Center.

## Architecture

- **Frontend**: SvelteKit app with Coralogix RUM (session replay, trace propagation to backend)
- **Backend**: Python FastAPI + Strands Agents (coordinator, knowledge specialist, visual-caption specialist) using Gemini 2.5 Flash Lite
- **Observability**: Strands reuses the API's global OpenTelemetry provider and emits GenAI agent/model/tool spans to the local collector, which forwards to Coralogix
- **Source Viewer**: Browser-based source code viewer with syntax highlighting at `/source`

## Prerequisites

- Node.js 20+
- Python 3.10+
- API keys: Coralogix (RUM + OTEL), Google Gemini

## Setup

### 1. Install dependencies

```bash
npm install
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
```

### 2. Configure environment

Copy the env template and add your keys (backend also reads from project root `.env`):

```bash
cp .env.template .env
```

Edit `.env` with your values:

| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP gRPC address for the Python API and Node build (default `http://localhost:4317`); targets your OpenTelemetry Collector. |
| `CORALOGIX_PRIVATE_KEY` | Send-Your-Data key for **otel-collector-config.yaml** so the collector exports to Coralogix (not used by the app process for OTLP). |
| `CORALOGIX_GUARDRAILS_KEY` | Optional. **Separate** Guardrails API key for `/api/chat` checks — do not reuse the OTLP ingestion key (OTLP keys do not work on the Guardrails HTTP API). |
| `GUARDRAILS_ENABLED` | Optional. `true` to enforce blocking on policy hits; `false` for observe-only (default). |
| `VITE_CORALOGIX_RUM_KEY` | Coralogix RUM key (browser monitoring) |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `STRANDS_MODEL_ID` | Optional Strands Gemini model override (default: `gemini-2.5-flash-lite`) |
| `STRANDS_MAX_TURNS` | Optional maximum coordinator turns per request (default: `8`) |
| `VITE_CHAT_API_URL` | Backend API URL (default: `http://localhost:8000`) |

### 3. Run

**Terminal 1 – Backend**

```bash
npm run api
```

**Terminal 2 – Frontend**

```bash
npm run dev
```

- Chat: http://localhost:5173
- Source viewer: http://localhost:5173/source

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Svelte dev server (port 5173) |
| `npm run api` | Start Python FastAPI backend (port 8000) |
| `npm run build` | Build frontend for production |
| `npm run start` | Run production frontend (port 3000) |
| `npm run test:rum` | Run RUM test harness once (`BASE_URL` default localhost:5173) |
| `npm run test:rum:both` | Run harness against **`BASE_URL_TEAM_A`** then **`BASE_URL_TEAM_B`** (dual RUM stacks; see `.env.template`) |
| `npm run test:rum:loop` | Run RUM harness every 5 minutes |

## Project Structure

```
├── backend/           # Python FastAPI + Strands Agents + Gemini
│   ├── agents/        # Coordinator and specialist topology
│   ├── chat_orchestrator.py
│   ├── main.py        # Chat API, Guardrails, OTLP traces/logs → collector
│   └── requirements.txt
├── src/
│   ├── lib/
│   │   ├── coralogix-rum.ts   # RUM init, session replay, user context
│   │   └── app.css
│   └── routes/
│       ├── +layout.svelte     # RUM init on mount
│       ├── +page.svelte       # Chat UI
│       └── source/           # Source code viewer
├── tests/
│   ├── rum-harness.mjs       # Puppeteer RUM tests
│   ├── run-rum-both.mjs       # Sequential runs for two stacks (dual RUM keys)
│   └── rum-harness-loop.mjs  # Loop harness every 5 min
└── instrumentation.cjs       # OpenTelemetry (production)
```

## User Context (RUM)

Call `setCoralogixUserContext()` after login to associate RUM sessions with users:

```typescript
import { setCoralogixUserContext } from '$lib/coralogix-rum';

setCoralogixUserContext({
  userId: 'user-123',
  userName: 'Jane Doe',
  userEmail: 'jane@example.com'
});
```

## License

MIT
