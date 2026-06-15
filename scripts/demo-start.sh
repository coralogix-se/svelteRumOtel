#!/usr/bin/env bash
# Demo-only helper: restart api/vite (optional collector/RUM loop). Requires repo .env — no keys in git.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

load_dotenv() {
	if [[ -f "$ROOT/.env" ]]; then
		set -a
		# shellcheck source=/dev/null
		source "$ROOT/.env"
		set +a
	fi
}

require_env() {
	local missing=()
	for var in "$@"; do
		if [[ -z "${!var:-}" || "${!var}" == *your_*_here* || "${!var}" == REPLACE_ME ]]; then
			missing+=("$var")
		fi
	done
	if ((${#missing[@]} > 0)); then
		echo "Missing or placeholder env vars: ${missing[*]}" >&2
		echo "Copy .env.template to .env and set Coralogix + Gemini keys before npm run demo:start." >&2
		exit 1
	fi
}

apply_demo_defaults() {
	# Backend + Node OTLP default: local collector (matches backend/main.py and instrumentation.cjs)
	export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4317}"
	export OTEL_EXPORTER_OTLP_INSECURE="${OTEL_EXPORTER_OTLP_INSECURE:-true}"
}

stop_demo() {
	pkill -f 'otelcol-contrib.*otel-collector-config' 2>/dev/null || true
	pkill -f 'uvicorn main:app' 2>/dev/null || true
	pkill -f 'vite dev' 2>/dev/null || true
	pkill -f 'rum-harness-loop.mjs' 2>/dev/null || true
	echo "Stopped demo processes (otel collector matching this repo, api, vite, rum loop) — best effort."
}

wait_urls() {
	local i
	for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
		if curl -sf -o /dev/null http://localhost:5173/ && curl -sf -o /dev/null http://localhost:8000/docs; then
			echo "OK: http://localhost:5173 and http://localhost:8000/docs"
			return 0
		fi
		sleep 1
	done
	echo "WARN: servers not healthy yet — check .logs/"
	return 1
}

start_demo() {
	local with_collector=false
	local with_rum_loop=false
	for arg in "$@"; do
		case "$arg" in
			--collector) with_collector=true ;;
			--rum-loop) with_rum_loop=true ;;
		esac
	done

	load_dotenv
	require_env CORALOGIX_PRIVATE_KEY VITE_CORALOGIX_RUM_KEY GEMINI_API_KEY
	apply_demo_defaults

	mkdir -p "$ROOT/.logs"

	if [[ "$with_collector" == true ]]; then
		if ! command -v otelcol-contrib >/dev/null 2>&1; then
			echo "SKIP: otelcol-contrib not on PATH (install or omit --collector)."
		else
			nohup env CORALOGIX_PRIVATE_KEY="$CORALOGIX_PRIVATE_KEY" \
				otelcol-contrib --config=file:"$ROOT/otel-collector-config.yaml" \
				>>"$ROOT/.logs/otel-collector.log" 2>&1 &
			echo $! >"$ROOT/.logs/otel-collector.pid"
			echo "Started otel collector (pid $(cat "$ROOT/.logs/otel-collector.pid")). Log: .logs/otel-collector.log"
		fi
	fi

	nohup env OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT}" \
		OTEL_EXPORTER_OTLP_INSECURE="${OTEL_EXPORTER_OTLP_INSECURE}" \
		VITE_CORALOGIX_RUM_KEY="$VITE_CORALOGIX_RUM_KEY" \
		npm run api >>"$ROOT/.logs/api.log" 2>&1 &
	echo $! >"$ROOT/.logs/api.pid"

	nohup env VITE_CORALOGIX_RUM_KEY="$VITE_CORALOGIX_RUM_KEY" \
		npm run dev >>"$ROOT/.logs/vite.log" 2>&1 &
	echo $! >"$ROOT/.logs/vite.pid"

	echo "Started npm run api (pid $(cat "$ROOT/.logs/api.pid")), npm run dev (pid $(cat "$ROOT/.logs/vite.pid"))."
	echo "Logs: $ROOT/.logs/api.log , $ROOT/.logs/vite.log"

	wait_urls || true

	if [[ "$with_rum_loop" == true ]]; then
		if [[ -f "$ROOT/.env" ]]; then
			nohup node --env-file="$ROOT/.env" "$ROOT/tests/rum-harness-loop.mjs" >>"$ROOT/.logs/rum-loop.log" 2>&1 &
		else
			nohup node "$ROOT/tests/rum-harness-loop.mjs" >>"$ROOT/.logs/rum-loop.log" 2>&1 &
		fi
		echo $! >"$ROOT/.logs/rum-loop.pid"
		echo "Started RUM harness loop (pid $(cat "$ROOT/.logs/rum-loop.pid")). Log: .logs/rum-loop.log"
	fi

	echo ""
	echo "Demo running with keys from .env (not stored in git)."
}

usage() {
	echo "Usage: $(basename "$0") {start|stop|restart} [--collector] [--rum-loop]"
	echo "  start    Stop old demo processes, then start api + vite (default)."
	echo "  stop     pkill api, vite, optional collector/rum-loop matching AGENTS.md patterns."
	echo "  restart  stop then start."
	echo "  --collector   Also start otelcol-contrib with otel-collector-config.yaml (needs otelcol-contrib on PATH)."
	echo "  --rum-loop    Also start tests/rum-harness-loop.mjs (needs .env for full chat)."
}

main() {
	local cmd="start"
	if [[ "${1:-}" == "start" || "${1:-}" == "stop" || "${1:-}" == "restart" || "${1:-}" == "help" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
		cmd="$1"
		shift
	fi
	case "$cmd" in
		stop)
			stop_demo
			;;
		restart)
			stop_demo
			sleep 1
			start_demo "$@"
			;;
		start)
			start_demo "$@"
			;;
		help | -h | --help)
			usage
			exit 0
			;;
		*)
			usage
			exit 1
			;;
	esac
}

main "$@"
