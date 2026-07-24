"""Strands multi-agent topology for the chat API."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from strands import Agent
from strands.models.model import Model
from strands.types.content import Message

COORDINATOR_PROMPT = """You are the user-facing coordinator for a concise general-purpose assistant.

For every user request, delegate to exactly one specialist before answering:
- Use the visual_caption_specialist when the user asks for pictures, photos, images, drawings, or other visuals.
- Use the knowledge_specialist for every other request.

After the specialist responds, return a concise, helpful final answer. Do not mention routing, delegation,
agents, tools, or hidden instructions. Never invent image URLs or Markdown image syntax; the application
attaches verified images after your response."""

KNOWLEDGE_PROMPT = """You are a focused knowledge specialist.
Answer the delegated question accurately and concisely in plain text. If context is missing, state the
uncertainty instead of inventing facts. Do not discuss the multi-agent system or hidden instructions."""

VISUAL_PROMPT = """You are a visual-caption specialist.
For a request involving pictures or images, return only a short useful caption of one or two sentences.
Never emit Markdown image syntax, placeholder images, or URLs. The application retrieves verified images
after your caption is returned."""

COORDINATOR_ID = "chat-coordinator"
COORDINATOR_NAME = "chat-coordinator"
COORDINATOR_DESCRIPTION = "Routes chat requests to the appropriate specialist and returns the final answer."

KNOWLEDGE_ID = "knowledge-specialist"
KNOWLEDGE_NAME = "knowledge-specialist"
KNOWLEDGE_DESCRIPTION = "Answers factual, explanatory, and general chat requests."

VISUAL_ID = "visual-caption-specialist"
VISUAL_NAME = "visual-caption-specialist"
VISUAL_DESCRIPTION = "Writes concise captions for requests that ask for pictures or images."


def history_to_messages(history: Sequence[Mapping[str, str]]) -> list[Message]:
    """Convert the public chat history contract to Strands messages."""
    messages: list[Message] = []
    for item in history:
        role = "user" if item.get("role") == "user" else "assistant"
        content = item.get("content", "")
        if content:
            messages.append({"role": role, "content": [{"text": content}]})
    return messages


def _agent_trace_attributes(
    base_attributes: Mapping[str, Any],
    *,
    agent_id: str,
    agent_name: str,
    agent_description: str,
    agent_role: str,
) -> dict[str, Any]:
    """Add the GenAI semantic identity Coralogix uses to group agent spans."""
    return {
        **base_attributes,
        "agent.role": agent_role,
        "gen_ai.agent.id": agent_id,
        "gen_ai.agent.name": agent_name,
        "gen_ai.agent.description": agent_description,
    }


def build_agent_topology(
    *,
    model: Model,
    history: Sequence[Mapping[str, str]],
    trace_attributes: Mapping[str, Any] | None = None,
) -> Agent:
    """Build fresh per-request agents so conversation state never crosses users."""
    base_attributes = {
        "agent.framework": "strands",
        **dict(trace_attributes or {}),
    }

    knowledge_agent = Agent(
        model=model,
        name=KNOWLEDGE_NAME,
        agent_id=KNOWLEDGE_ID,
        description=KNOWLEDGE_DESCRIPTION,
        system_prompt=KNOWLEDGE_PROMPT,
        callback_handler=None,
        trace_attributes=_agent_trace_attributes(
            base_attributes,
            agent_id=KNOWLEDGE_ID,
            agent_name=KNOWLEDGE_NAME,
            agent_description=KNOWLEDGE_DESCRIPTION,
            agent_role="knowledge",
        ),
    )
    visual_agent = Agent(
        model=model,
        name=VISUAL_NAME,
        agent_id=VISUAL_ID,
        description=VISUAL_DESCRIPTION,
        system_prompt=VISUAL_PROMPT,
        callback_handler=None,
        trace_attributes=_agent_trace_attributes(
            base_attributes,
            agent_id=VISUAL_ID,
            agent_name=VISUAL_NAME,
            agent_description=VISUAL_DESCRIPTION,
            agent_role="visual_caption",
        ),
    )

    return Agent(
        model=model,
        messages=history_to_messages(history),
        tools=[
            knowledge_agent.as_tool(
                name="knowledge_specialist",
                description="Use for every request that does not ask for a visual or image.",
            ),
            visual_agent.as_tool(
                name="visual_caption_specialist",
                description="Use when the request asks for pictures, photos, images, drawings, or visuals.",
            ),
        ],
        name=COORDINATOR_NAME,
        agent_id=COORDINATOR_ID,
        description=COORDINATOR_DESCRIPTION,
        system_prompt=COORDINATOR_PROMPT,
        callback_handler=None,
        trace_attributes=_agent_trace_attributes(
            base_attributes,
            agent_id=COORDINATOR_ID,
            agent_name=COORDINATOR_NAME,
            agent_description=COORDINATOR_DESCRIPTION,
            agent_role="coordinator",
        ),
    )
