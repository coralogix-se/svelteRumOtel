#!/usr/bin/env bash
# Build (linux/amd64), push to ECR, and rollout workloads in ai-agent-sim.
# Prerequisites: aws ecr get-login-password | docker login ... ; kubectl configured.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REGISTRY="${REGISTRY:-827602716714.dkr.ecr.us-west-2.amazonaws.com}"
NAMESPACE="${NAMESPACE:-ai-agent-sim}"
PLATFORM="${PLATFORM:-linux/amd64}"
# Prefer Docker Desktop's `desktop-linux` (docker driver) so host `docker login` applies; avoid a selected
# `docker-container` builder (e.g. img-builder) that cannot see host ECR creds. Override: BUILDX_BUILDER=...
if [[ -z "${BUILDX_BUILDER:-}" ]]; then
	if docker buildx inspect desktop-linux &>/dev/null; then
		BUILDX_BUILDER=desktop-linux
	else
		BUILDX_BUILDER=default
	fi
fi

# Manifests + Secret (from secret-generator.env via kustomize); restart collector so new OTLP keys load.
echo "==> kubectl apply -k deploy/k8s/ai-agent-sim/"
kubectl apply -k deploy/k8s/ai-agent-sim/
echo "==> Rollout otel-collector-chatbot (Secret / ConfigMap)"
kubectl rollout restart deployment/otel-collector-chatbot -n "$NAMESPACE"
kubectl rollout status deployment/otel-collector-chatbot -n "$NAMESPACE" --timeout=300s

usage() {
	echo "Usage: ${0##*/} [all|backend|frontend|harness]"
	echo "  default: all — build+push backend, frontend, harness; rollout every app deployment."
	echo "  ENV: REGISTRY NAMESPACE PLATFORM BUILDX_BUILDER (auto: desktop-linux if present, else default)"
	echo "       SKIP_EKS_PUBLIC_URL_LOG=1 — skip NLB hostname poll and .logs/eks-frontend-public-urls.log append"
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
	DEPS=(
		chat-backend-team-a
		chat-backend-team-b
		chat-frontend-team-a
		chat-frontend-team-b
		rum-harness-dual
	)
elif [[ "$TARGET" == "backend" ]]; then
	DEPS=(chat-backend-team-a chat-backend-team-b)
elif [[ "$TARGET" == "frontend" ]]; then
	DEPS=(chat-frontend-team-a chat-frontend-team-b)
else
	DEPS=(rum-harness-dual)
fi

echo "==> Rollout restart (${DEPS[*]}) in ns/${NAMESPACE}"
for d in "${DEPS[@]}"; do
	kubectl rollout restart "deployment/$d" -n "$NAMESPACE"
done
for d in "${DEPS[@]}"; do
	kubectl rollout status "deployment/$d" -n "$NAMESPACE" --timeout=240s
done

# After frontend Services (type LoadBalancer) reconcile, write public http:// URLs for operators.
# Skip in CI or non-AWS: SKIP_EKS_PUBLIC_URL_LOG=1
log_frontend_public_urls() {
	local log_dir="$ROOT/.logs"
	local log_file="$log_dir/eks-frontend-public-urls.log"
	mkdir -p "$log_dir"
	local ts
	ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

	get_lb_host() {
		local svc="$1"
		local h
		h="$(kubectl get svc "$svc" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
		if [[ -z "$h" ]]; then
			h="$(kubectl get svc "$svc" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
		fi
		echo "$h"
	}

	local ha="" hb=""
	local i
	echo ""
	echo "==> Resolving AWS LoadBalancer hostnames for frontend Services (up to ~5m both; set SKIP_EKS_PUBLIC_URL_LOG=1 to skip)"
	for ((i = 1; i <= 60; i++)); do
		[[ -z "$ha" ]] && ha="$(get_lb_host chat-frontend-team-a)"
		[[ -z "$hb" ]] && hb="$(get_lb_host chat-frontend-team-b)"
		if [[ -n "$ha" && -n "$hb" ]]; then
			break
		fi
		sleep 5
	done

	local url_a url_b
	if [[ -n "$ha" ]]; then
		url_a="http://${ha}/"
	else
		url_a="(pending — kubectl get svc chat-frontend-team-a -n ${NAMESPACE} -w)"
	fi
	if [[ -n "$hb" ]]; then
		url_b="http://${hb}/"
	else
		url_b="(pending — kubectl get svc chat-frontend-team-b -n ${NAMESPACE} -w)"
	fi

	{
		echo "----- ${ts} (namespace=${NAMESPACE}) -----"
		echo "Team A (US2 stack / RUM + OTLP via collector :34317): ${url_a}"
		echo "Team B (EU1 stack / :34327): ${url_b}"
		echo ""
	} >>"$log_file"

	echo "Public frontend URLs (also appended to ${log_file}):"
	echo "  Team A: ${url_a}"
	echo "  Team B: ${url_b}"
}

if [[ "${SKIP_EKS_PUBLIC_URL_LOG:-}" != "1" ]]; then
	log_frontend_public_urls
else
	echo "==> SKIP_EKS_PUBLIC_URL_LOG=1 — not polling LoadBalancer hostnames."
fi

echo "==> Done."
