"""Per-request Strands orchestration behind the stable chat API contract."""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping, Sequence

from strands.models.gemini import GeminiModel

from agents import build_agent_topology

logger = logging.getLogger("chat-api")

DEFAULT_MODEL = "gemini-2.5-flash-lite"


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def build_model(api_key: str) -> GeminiModel:
    """Create the Strands Gemini provider without installing another OTEL exporter."""
    return GeminiModel(
        client_args={"api_key": api_key},
        model_id=os.getenv("STRANDS_MODEL_ID", DEFAULT_MODEL),
        params={
            "temperature": _float_env("STRANDS_TEMPERATURE", 0.3),
            "max_output_tokens": _positive_int_env("STRANDS_MAX_OUTPUT_TOKENS", 1024),
        },
    )


async def run_chat(
    message: str,
    history: Sequence[Mapping[str, str]],
    *,
    api_key: str,
    is_harness: bool = False,
) -> str:
    """Run the coordinator and specialists using fresh state for this request."""
    model = build_model(api_key)
    coordinator = build_agent_topology(
        model=model,
        history=history,
        trace_attributes={
            "cx.application.name": "svelte-chatbot",
            "cx.subsystem.name": "chat-api",
            "chat.is_harness": is_harness,
        },
    )
    result = await coordinator.invoke_async(
        message,
        invocation_state={"is_harness": is_harness},
        limits={
            "turns": _positive_int_env("STRANDS_MAX_TURNS", 8),
            "output_tokens": _positive_int_env("STRANDS_MAX_RUN_OUTPUT_TOKENS", 4096),
        },
    )
    text = str(result).strip()
    logger.info(
        "Strands multi-agent run completed",
        extra={
            "agent_framework": "strands",
            "agent_topology": "agents_as_tools",
            "agent_name": "chat-coordinator",
            "agent_stop_reason": result.stop_reason,
            "agent_cycle_count": result.metrics.cycle_count,
            "agent_tools": sorted(result.metrics.tool_metrics),
            "model": os.getenv("STRANDS_MODEL_ID", DEFAULT_MODEL),
        },
    )
    return text or "No response generated."
