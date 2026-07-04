#!/usr/bin/env bash
# Build (linux/amd64), push to ECR, and rollout svelteRumOtel on SigmaDev (namespace svelte-rum-sigma).
# Prerequisites: aws ecr get-login-password | docker login ... ; kubectl context SigmaDev
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REGISTRY="${REGISTRY:-827602716714.dkr.ecr.us-west-2.amazonaws.com}"
NAMESPACE="${NAMESPACE:-svelte-rum-sigma}"
KUSTOMIZE="${KUSTOMIZE:-deploy/k8s/sigma-dev}"
PLATFORM="${PLATFORM:-linux/amd64}"
KUBECTL_CONTEXT="${KUBECTL_CONTEXT:-SigmaDev}"

if [[ -z "${BUILDX_BUILDER:-}" ]]; then
	if docker buildx inspect desktop-linux &>/dev/null; then
		BUILDX_BUILDER=desktop-linux
	else
		BUILDX_BUILDER=default
	fi
fi

if ! kubectl config use-context "$KUBECTL_CONTEXT" >/dev/null 2>&1; then
	echo "WARN: kubectl context '$KUBECTL_CONTEXT' not found — using current context: $(kubectl config current-context)"
fi

if [[ ! -f "$KUSTOMIZE/secret-generator.env" ]]; then
	echo "Missing $KUSTOMIZE/secret-generator.env — copy secret-generator.env.example and set keys." >&2
	exit 1
fi

echo "==> kubectl apply -k $KUSTOMIZE/"
kubectl apply -k "$KUSTOMIZE/"
echo "==> Rollout otel-collector (Secret / ConfigMap)"
kubectl rollout restart deployment/otel-collector -n "$NAMESPACE"
kubectl rollout status deployment/otel-collector -n "$NAMESPACE" --timeout=300s

usage() {
	echo "Usage: ${0##*/} [all|backend|frontend|harness]"
	echo "  default: all — build+push images; rollout chat + harness."
	echo "  ENV: REGISTRY NAMESPACE KUSTOMIZE PLATFORM KUBECTL_CONTEXT BUILDX_BUILDER"
	echo "       SKIP_EKS_PUBLIC_URL_LOG=1 — skip NLB hostname poll"
	exit "${1:-0}"
}

case "${1:-all}" in
-h | --help | help) usage ;;
esac

TARGET="${1:-all}"

want() {
	case "$TARGET" in
	all) return 0 ;;
	backend | frontend | harness) [[ "$TARGET" == "$1" ]] ;;
	*) echo "Unknown target: $TARGET" >&2; usage 2 ;;
	esac
}

build_push() {
	local name="$1" file="$2"
	echo "==> Build & push ${REGISTRY}/${name}:latest ($PLATFORM) [buildx builder=${BUILDX_BUILDER}]"
	docker buildx build --builder "${BUILDX_BUILDER}" --platform "$PLATFORM" \
		-t "${REGISTRY}/${name}:latest" \
		-f "$file" \
		. \
		--push
}

if want backend; then
	build_push svelte-chatbot-backend deploy/docker/Dockerfile.backend
fi
if want frontend; then
	build_push svelte-chatbot-frontend deploy/docker/Dockerfile.frontend
fi
if want harness; then
	build_push svelte-chatbot-rum-harness deploy/docker/Dockerfile.harness
fi

if [[ "$TARGET" == "all" ]]; then
	DEPS=(chat-backend chat-frontend rum-harness)
elif [[ "$TARGET" == "backend" ]]; then
	DEPS=(chat-backend)
elif [[ "$TARGET" == "frontend" ]]; then
	DEPS=(chat-frontend)
else
	DEPS=(rum-harness)
fi

echo "==> Rollout restart (${DEPS[*]}) in ns/${NAMESPACE}"
for d in "${DEPS[@]}"; do
	kubectl rollout restart "deployment/$d" -n "$NAMESPACE"
done
for d in "${DEPS[@]}"; do
	kubectl rollout status "deployment/$d" -n "$NAMESPACE" --timeout=300s
done

log_frontend_public_url() {
	local log_dir="$ROOT/.logs"
	local log_file="$log_dir/sigma-dev-frontend-public-url.log"
	mkdir -p "$log_dir"
	local ts
	ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
	local h=""
	local i
	for ((i = 1; i <= 60; i++)); do
		h="$(kubectl get svc chat-frontend -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
		[[ -z "$h" ]] && h="$(kubectl get svc chat-frontend -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
		[[ -n "$h" ]] && break
		sleep 5
	done
	local url
	if [[ -n "$h" ]]; then
		url="http://${h}/"
	else
		url="(pending — kubectl get svc chat-frontend -n ${NAMESPACE} -w)"
	fi
	{
		echo "----- ${ts} (cluster=SigmaDev namespace=${NAMESPACE}) -----"
		echo "Frontend: ${url}"
		echo ""
	} >>"$log_file"
	echo "Public frontend URL (also in ${log_file}): ${url}"
}

if [[ "${SKIP_EKS_PUBLIC_URL_LOG:-}" != "1" ]]; then
	log_frontend_public_url
fi

echo "==> Done."
