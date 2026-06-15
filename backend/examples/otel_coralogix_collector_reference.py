# Copyright: reference derived from svelteRumOtel backend/main.py — see repository license.
#
# This file is a **standalone reference** for customers. It is not imported by the demo app.
# It shows how the chat API configures OpenTelemetry to send traces (including GenAI spans)
# and structured logs to a **local OpenTelemetry Collector** over OTLP/gRPC. The collector
# forwards to Coralogix (see repo ``otel-collector-config.yaml``).

"""Reference: OTLP traces and logs via local collector (Python)

Overview
========

1. **Traces (including Gemini / GenAI spans)** — ``TracerProvider`` + ``OTLPSpanExporter`` to the
   collector, then ``GoogleGenAiSdkInstrumentor`` from ``opentelemetry-instrumentation-google-genai``
   **after** the tracer provider is set and **before** the Google GenAI client is used.

2. **Application logs over OTLP** — A ``LoggerProvider`` with ``OTLPLogExporter`` sends the same JSON
   log lines you emit to stdout so backends can correlate **logs** with **traces** via ``traceId`` /
   ``spanId`` (see ``attach_json_logging_with_trace_correlation`` below).

FastAPI is instrumented separately with ``FastAPIInstrumentor.instrument_app(app)`` so incoming
HTTP requests carry ``traceparent`` from the browser (RUM) and join the same trace as AI spans.

Environment variables
=====================

+-------------------------------+------------------------------------------+---------------------+
| Variable                      | When it applies                         | Typical value       |
+===============================+=========================================+=====================+
| ``OTEL_SDK_DISABLED``         | Skip all OTLP + GenAI instrumentation   | ``true`` to disable |
+-------------------------------+------------------------------------------+---------------------+
| ``OTEL_EXPORTER_OTLP_ENDPOINT`` | gRPC OTLP host for traces (and logs)   | ``http://localhost:4317`` |
+-------------------------------+------------------------------------------+---------------------+
| ``OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`` | Alternative to endpoint for traces | Same as above       |
+-------------------------------+------------------------------------------+---------------------+
| ``OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`` | Optional; defaults to trace endpoint | Same host as traces |
+-------------------------------+------------------------------------------+---------------------+
| ``OTEL_EXPORTER_OTLP_INSECURE`` | ``true`` for local collectors without TLS | ``true``         |
+-------------------------------+------------------------------------------+---------------------+
| ``OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT`` | Optional; caps span attributes      | e.g. ``512``        |
+-------------------------------+------------------------------------------+---------------------+

**Coralogix key:** Put your Send-Your-Data OTLP key on the **collector** (e.g. ``CORALOGIX_PRIVATE_KEY``
in ``otel-collector-config.yaml``), not in the Python OTLP exporter.

**Guardrails vs OTLP:** The Coralogix Guardrails REST API uses a **separate** key (see
``CORALOGIX_GUARDRAILS_KEY`` in ``.env.template``).

Python dependencies (pip)
===========================

``fastapi``, ``uvicorn``, ``google-genai``, ``python-dotenv``,
``opentelemetry-instrumentation-fastapi``, ``opentelemetry-instrumentation-google-genai``,
``opentelemetry-exporter-otlp-proto-grpc``, and OpenTelemetry SDK (see ``backend/requirements.txt``).

Usage
=====

Call ``configure_traces_and_logs()`` once at process startup (before creating the GenAI client and
before mounting FastAPI instrumentation). Optionally call ``attach_json_logging_with_trace_correlation``
for JSON logs with trace context.

See function docstrings for details.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from opentelemetry import trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.google_genai import GoogleGenAiSdkInstrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import SpanLimits, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter


@dataclass(frozen=True)
class OtelExportResult:
    """Outcome of :func:`configure_traces_and_logs`."""

    mode: Literal["collector", "disabled"]
    """``collector`` if OTLP export is configured, else ``disabled`` (``OTEL_SDK_DISABLED``)."""


def configure_traces_and_logs(
    *,
    service_name: str = "svelte-chatbot",
    application_name: str = "svelte-chatbot",
    subsystem_name: str = "chat-api",
) -> OtelExportResult:
    """Configure OpenTelemetry traces and OTLP logs (mirrors ``backend/main.py``).

    Exports to a local OpenTelemetry Collector unless ``OTEL_SDK_DISABLED`` is set to a truthy value.

    Returns
    -------
    OtelExportResult
        Indicates which branch ran. Call ``FastAPIInstrumentor.instrument_app(app)`` after
        your ``FastAPI`` instance exists.
    """
    os.environ.setdefault("OTEL_SEMCONV_STABILITY_OPT_IN", "gen_ai_latest_experimental")
    os.environ.setdefault(
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "SPAN_AND_EVENT"
    )

    if os.getenv("OTEL_SDK_DISABLED", "").lower().strip() in ("true", "1", "yes"):
        return OtelExportResult(mode="disabled")

    grpc_endpoint = (
        os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        or os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
        or "http://localhost:4317"
    )
    logs_endpoint = os.getenv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT") or grpc_endpoint
    insecure = os.getenv("OTEL_EXPORTER_OTLP_INSECURE", "true").lower() == "true"

    span_attr_limit = 512
    raw_limit = os.getenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT")
    if raw_limit:
        try:
            span_attr_limit = int(raw_limit)
        except ValueError:
            pass
    span_limits = SpanLimits(max_span_attributes=span_attr_limit)

    resource = Resource.create(
        {
            SERVICE_NAME: service_name,
            "cx.application.name": application_name,
            "cx.subsystem.name": subsystem_name,
        }
    )
    tracer_provider = TracerProvider(resource=resource, span_limits=span_limits)
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=grpc_endpoint, insecure=insecure))
    )
    trace.set_tracer_provider(tracer_provider)
    GoogleGenAiSdkInstrumentor().instrument()

    log_provider = LoggerProvider(resource=resource)
    log_provider.add_log_record_processor(
        BatchLogRecordProcessor(
            OTLPLogExporter(endpoint=logs_endpoint, insecure=insecure)
        )
    )
    set_logger_provider(log_provider)
    return OtelExportResult(mode="collector")


class TraceContextFilter(logging.Filter):
    """Inject ``traceId`` and ``spanId`` from the current OpenTelemetry span into log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        span = trace.get_current_span()
        if span.is_recording():
            ctx = span.get_span_context()
            record.traceId = format(ctx.trace_id, "032x")
            record.spanId = format(ctx.span_id, "016x")
        else:
            record.traceId = record.spanId = ""
        return True


class JsonTraceFormatter(logging.Formatter):
    """JSON lines with ``traceId`` / ``spanId`` for log–trace correlation in Coralogix."""

    _STANDARD_ATTRS = frozenset(
        {
            "name", "msg", "args", "created", "filename", "funcName", "levelname",
            "levelno", "lineno", "module", "msecs", "pathname", "process", "processName",
            "relativeCreated", "stack_info", "exc_info", "exc_text", "thread",
            "threadName", "message", "taskName", "asctime", "traceId", "spanId",
        }
    )

    def format(self, record: logging.LogRecord) -> str:
        log = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "traceId": getattr(record, "traceId", ""),
            "spanId": getattr(record, "spanId", ""),
        }
        for key, value in record.__dict__.items():
            if key not in self._STANDARD_ATTRS and value is not None:
                log[key] = value
        if record.exc_info:
            log["exception"] = self.formatException(record.exc_info)
        return json.dumps(log)


def attach_json_logging_with_trace_correlation(
    logger: logging.Logger,
    *,
    export_logs_via_otel: bool,
) -> None:
    """Wire JSON formatting, trace context filter, and optional OTLP log export.

    When ``export_logs_via_otel`` is true (same condition as ``configure_traces_and_logs`` returned
    ``collector``), add an OpenTelemetry ``LoggingHandler`` so structured logs are duplicated to OTLP
    with the same JSON body as stdout.

    Parameters
    ----------
    logger
        Your application logger (e.g. ``logging.getLogger("chat-api")``).
    export_logs_via_otel
        Set to ``True`` when telemetry export was configured; ``False`` for local-only logs.
    """
    json_formatter = JsonTraceFormatter()
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(json_formatter)
    logger.handlers.clear()
    logger.addHandler(stream_handler)
    if export_logs_via_otel:
        otel_handler = LoggingHandler(level=logging.NOTSET)
        otel_handler.setFormatter(json_formatter)
        logger.addHandler(otel_handler)
    logger.addFilter(TraceContextFilter())
    logger.setLevel(logging.INFO)
    logger.propagate = False


# --- Minimal self-check (optional): from repo root, PYTHONPATH=backend:
#     python backend/examples/otel_coralogix_collector_reference.py
if __name__ == "__main__":
    import sys

    from dotenv import load_dotenv
    from pathlib import Path

    _here = Path(__file__).resolve()
    load_dotenv()
    load_dotenv(_here.parent.parent / ".env")
    load_dotenv(_here.parent.parent.parent / ".env")

    result = configure_traces_and_logs()
    print(f"configure_traces_and_logs -> {result.mode}", file=sys.stderr)
    log = logging.getLogger("otel-reference")
    attach_json_logging_with_trace_correlation(
        log,
        export_logs_via_otel=result.mode != "disabled",
    )
    log.info("example log line with trace context", extra={"extra_field": "ok"})
