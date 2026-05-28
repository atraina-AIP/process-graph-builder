"""
Model router — the only place in the codebase that calls an LLM provider.

Business logic calls router.compile_assist(...).
It never imports openai or azure-identity directly.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_ENDPOINT: str = os.environ.get("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
_MODEL: str = os.environ.get("OPENAI_MODEL", "gpt-4o")

_SYSTEM_PROMPT = """
You are a process graph mutation compiler for the AIP Forge platform.

Given the current ProcessGraph JSON and a user instruction, return a single JSON object
with exactly these top-level fields:

  summary          – one sentence describing what you compiled
  mutations        – array of mutation objects (may be empty)
  questions        – array of plain-English strings for genuinely ambiguous structure
  warnings         – array of plain-English strings for potential issues
  handoff_readiness – object:
      structure_complete  bool
      missing_values      list[str]
      missing_constraints list[str]
      open_questions      list[str]

Each mutation object:
  action      – one of: add_node, update_node, delete_node,
                         add_edge, update_edge, delete_edge,
                         add_resource, update_resource,
                         add_constraint, update_constraint,
                         add_assumption, add_question
  target_id   – existing id string for update/delete, null for add
  payload     – fields for the new or updated object (see schema below)
  reason      – one sentence explaining why
  confidence  – "high", "medium", or "low"

Node payload schema:
  id                  "n_<snake_case_name>"  (preserve existing IDs)
  name                string
  type                "source" | "sink" | "task" | "decision"
  description         string (plain-language definition of the step)
  description_status  "suggested"
  inputs              list[str]
  outputs             list[str]
  resources_required  list[{name, quantity}]
  attributes          {}
  notes               ""

Edge payload schema:
  id          "e_<from_node_id>_<to_node_id>"
  from_node   existing node id
  to_node     existing node id
  type        "flow"
  condition   ""
  flows       []

Rules:
- Preserve all existing node and edge IDs exactly.
- Never invent numeric capacity or duration values unless the user stated them.
- Create an assumption mutation for any fact you inferred but are not certain about.
- Ask questions only when the graph structure would be genuinely ambiguous without them.
- All JSON field names are snake_case.
- Treat every mutation as a proposal; humans will preview and approve before applying.
""".strip()


def is_configured() -> bool:
    return bool(_ENDPOINT)


async def compile_assist(graph: dict[str, Any], user_message: str) -> dict[str, Any]:
    """
    Call GPT-4o to compile a user instruction into graph mutations.
    Raises RuntimeError if AZURE_OPENAI_ENDPOINT is not set.
    """
    if not is_configured():
        raise RuntimeError("AZURE_OPENAI_ENDPOINT is not configured")

    from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider
    from openai import AsyncAzureOpenAI

    token_provider = get_bearer_token_provider(
        DefaultAzureCredential(),
        "https://cognitiveservices.azure.com/.default",
    )

    # Send only the structural parts of the graph to keep the prompt tight.
    graph_summary = {
        "id": graph.get("id"),
        "name": graph.get("name"),
        "modeling_style": graph.get("modeling_style"),
        "nodes": [
            {"id": n["id"], "name": n["name"], "type": n["type"]}
            for n in graph.get("nodes", [])
        ],
        "edges": [
            {"id": e["id"], "from_node": e["from_node"], "to_node": e["to_node"]}
            for e in graph.get("edges", [])
        ],
    }

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Current graph:\n{json.dumps(graph_summary, indent=2)}\n\n"
                f"User instruction: {user_message}"
            ),
        },
    ]

    async with AsyncAzureOpenAI(
        azure_endpoint=_ENDPOINT,
        azure_ad_token_provider=token_provider,
        api_version="2024-10-21",
    ) as client:
        resp = await client.chat.completions.create(
            model=_MODEL,
            messages=messages,
            response_format={"type": "json_object"},
        )

    logger.info("router: tokens used=%s", resp.usage)
    return json.loads(resp.choices[0].message.content)
