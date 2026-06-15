#!/usr/bin/env bash
# Quick check: RUM harness pod process count (fork leak → Chromium EAGAIN → no chat traces).
set -euo pipefail
NS="${NAMESPACE:-ai-agent-sim}"
POD="$(kubectl -n "$NS" get pods -l app=rum-harness-dual -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -z "$POD" ]]; then
	echo "No rum-harness-dual pod in namespace $NS"
	exit 1
fi
kubectl -n "$NS" exec "$POD" -- sh -c '
  procs=$(ls -1 /proc 2>/dev/null | wc -l | tr -d " ")
  chromes=$(pgrep -c chromium 2>/dev/null || echo 0)
  echo "pod=$HOSTNAME procs=$procs chromium=$chromes"
  if [ "$procs" -gt 300 ] 2>/dev/null; then echo "WARN: high process count — consider rollout restart deployment/rum-harness-dual"; exit 2; fi
'
