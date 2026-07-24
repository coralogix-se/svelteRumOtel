from __future__ import annotations

import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CORALOGIX_GUARDRAILS_KEY"] = ""
os.environ["CX_GUARDRAILS_TOKEN"] = ""
os.environ["CX_TOKEN"] = ""
os.environ["GEMINI_API_KEY"] = "test-gemini-key"

from fastapi.testclient import TestClient

import chat_orchestrator
import main
from agents import history_to_messages
from agents.topology import _agent_trace_attributes


class FakeResult:
    stop_reason = "end_turn"
    metrics = type("Metrics", (), {"cycle_count": 2, "tool_metrics": {"knowledge_specialist": {}}})()

    def __str__(self) -> str:
        return "Delegated answer"


class FakeCoordinator:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict, dict]] = []

    async def invoke_async(self, message: str, **kwargs):
        self.calls.append((message, kwargs["invocation_state"], kwargs["limits"]))
        return FakeResult()


class AgentTopologyTests(unittest.TestCase):
    def test_history_to_messages_preserves_public_contract(self):
        self.assertEqual(
            history_to_messages(
                [
                    {"role": "user", "content": "first"},
                    {"role": "assistant", "content": "second"},
                    {"role": "assistant", "content": ""},
                ]
            ),
            [
                {"role": "user", "content": [{"text": "first"}]},
                {"role": "assistant", "content": [{"text": "second"}]},
            ],
        )


    def test_agent_trace_attributes_include_genai_semantic_identity(self):
        attributes = _agent_trace_attributes(
            {"cx.application.name": "svelte-chatbot"},
            agent_id="knowledge-specialist",
            agent_name="knowledge-specialist",
            agent_description="Answers general requests.",
            agent_role="knowledge",
        )

        self.assertEqual(attributes["gen_ai.agent.id"], "knowledge-specialist")
        self.assertEqual(attributes["gen_ai.agent.name"], "knowledge-specialist")
        self.assertEqual(attributes["gen_ai.agent.description"], "Answers general requests.")
        self.assertEqual(attributes["agent.role"], "knowledge")
        self.assertEqual(attributes["cx.application.name"], "svelte-chatbot")


class OrchestratorTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_chat_uses_fresh_topology_and_limits(self):
        coordinator = FakeCoordinator()
        with (
            patch.object(chat_orchestrator, "build_model", return_value=object()),
            patch.object(
                chat_orchestrator,
                "build_agent_topology",
                return_value=coordinator,
            ) as build_topology,
        ):
            text = await chat_orchestrator.run_chat(
                "hello",
                [{"role": "user", "content": "earlier"}],
                api_key="key",
                is_harness=True,
            )

        self.assertEqual(text, "Delegated answer")
        build_topology.assert_called_once()
        self.assertEqual(coordinator.calls[0][0], "hello")
        self.assertEqual(coordinator.calls[0][1], {"is_harness": True})
        self.assertEqual(coordinator.calls[0][2]["turns"], 8)


class ChatContractTests(unittest.TestCase):
    def test_chat_contract_is_preserved(self):
        with patch.object(main, "run_chat", new=AsyncMock(return_value="Agent reply")) as run:
            response = TestClient(main.app).post(
                "/api/chat",
                json={
                    "message": "Current question",
                    "history": [{"role": "user", "content": "Earlier question"}],
                },
                headers={"user-agent": "test_harness/Puppeteer"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"message": "Agent reply"})
        run.assert_awaited_once_with(
            "Current question",
            [{"role": "user", "content": "Earlier question"}],
            api_key="test-gemini-key",
            is_harness=True,
        )


if __name__ == "__main__":
    unittest.main()
