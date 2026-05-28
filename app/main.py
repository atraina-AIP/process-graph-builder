from __future__ import annotations

import json
import logging
import os
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import router as model_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

VERSION = os.environ.get("APP_VERSION", "dev")

STORE_PATH = Path(
    os.environ.get("PROCESS_GRAPH_STORE", Path(__file__).parent / "data" / "graphs.json")
)

STATIC_DIR = Path(__file__).parent / "static"

MUTATION_ACTIONS = {
    "add_node",
    "update_node",
    "delete_node",
    "add_edge",
    "update_edge",
    "delete_edge",
    "add_resource",
    "update_resource",
    "add_constraint",
    "update_constraint",
    "add_assumption",
    "add_question",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slug(value: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "_", str(value).lower()).strip("_")
    return clean[:58] or "id"


def default_graph(graph_id: str = "pg-untitled") -> dict[str, Any]:
    return {
        "id": graph_id,
        "name": "Untitled Process Graph",
        "version": "0.1.0",
        "description": "",
        "modeling_style": "none",
        "nodes": [],
        "edges": [],
        "resources": [],
        "constraints": [],
        "assumptions": [],
        "open_questions": [],
        "chat_messages": [],
        "versions": [],
        "ontology": {
            "modeling_styles": {},
            "node_types": {},
            "edge_types": {},
            "flow_types": {},
            "constraint_types": {},
            "resource_types": {},
            "properties": {},
        },
        "metadata": {"created_by": "api", "created_at": now(), "tags": []},
    }


def load_store() -> dict[str, Any]:
    if not STORE_PATH.exists():
        return {"graphs": {}, "mutation_batches": []}
    with STORE_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save_store(store: dict[str, Any]) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with STORE_PATH.open("w", encoding="utf-8") as fh:
        json.dump(store, fh, indent=2)


def get_graph_or_create(store: dict[str, Any], graph_id: str) -> dict[str, Any]:
    graphs = store.setdefault("graphs", {})
    if graph_id not in graphs:
        graphs[graph_id] = default_graph(graph_id)
    return graphs[graph_id]


def upsert_by_id(items: list[dict[str, Any]], item: dict[str, Any]) -> None:
    for i, existing in enumerate(items):
        if existing.get("id") == item.get("id"):
            items[i] = {**existing, **item}
            return
    items.append(item)


def apply_mutation(graph: dict[str, Any], mutation: dict[str, Any]) -> None:
    action = mutation.get("action")
    if action not in MUTATION_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported mutation action: {action}")
    payload = mutation.get("payload") or {}
    target_id = mutation.get("target_id")

    if action == "add_node":
        upsert_by_id(graph.setdefault("nodes", []), payload)
    elif action == "update_node":
        upsert_by_id(graph.setdefault("nodes", []), {"id": target_id, **payload})
    elif action == "delete_node":
        graph["nodes"] = [n for n in graph.get("nodes", []) if n.get("id") != target_id]
        graph["edges"] = [
            e for e in graph.get("edges", [])
            if e.get("from_node") != target_id and e.get("to_node") != target_id
        ]
    elif action == "add_edge":
        upsert_by_id(graph.setdefault("edges", []), payload)
    elif action == "update_edge":
        upsert_by_id(graph.setdefault("edges", []), {"id": target_id, **payload})
    elif action == "delete_edge":
        graph["edges"] = [e for e in graph.get("edges", []) if e.get("id") != target_id]
    elif action == "add_resource":
        upsert_by_id(graph.setdefault("resources", []), payload)
    elif action == "update_resource":
        upsert_by_id(graph.setdefault("resources", []), {"id": target_id, **payload})
    elif action == "add_constraint":
        upsert_by_id(graph.setdefault("constraints", []), payload)
    elif action == "update_constraint":
        upsert_by_id(graph.setdefault("constraints", []), {"id": target_id, **payload})
    elif action == "add_assumption":
        graph.setdefault("assumptions", []).append(payload)
    elif action == "add_question":
        graph.setdefault("open_questions", []).append(
            payload.get("text") or payload.get("question") or ""
        )


# ---------------------------------------------------------------------------
# Deterministic fallback compiler (used when AZURE_OPENAI_ENDPOINT is unset)
# ---------------------------------------------------------------------------

def _make_node(name: str) -> dict[str, Any]:
    lower = name.lower()
    if re.search(r"\b(source|start|supplier|customer|input)\b", lower):
        node_type = "source"
    elif re.search(r"\b(sink|end|closed|posted|done|ledger)\b", lower):
        node_type = "sink"
    elif re.search(r"\b(decision|is |whether|approved|complete|found)\b", lower):
        node_type = "decision"
    else:
        node_type = "task"
    clean = re.sub(r"\b(source|sink|task|decision)\b[:\s-]*", "", name, flags=re.I).strip() or name
    label = clean[:1].upper() + clean[1:]
    return {
        "id": f"n_{slug(clean)}",
        "name": label,
        "type": node_type,
        "description": _suggest_description(label, node_type),
        "description_status": "suggested",
        "inputs": [],
        "outputs": [],
        "resources_required": [],
        "attributes": {},
        "notes": "",
    }


def _suggest_description(name: str, node_type: str) -> str:
    label = name[:1].upper() + name[1:] if name else "This node"
    if node_type == "source":
        return f"{label} is the entry point where work, material, data, demand, or value first enters the graph."
    if node_type == "sink":
        return f"{label} is the end point where work, material, data, demand, or value leaves the graph or is considered complete."
    if node_type == "decision":
        return f"{label} is a decision point that checks incoming work or flow and routes the next step based on clear conditions."
    return f"{label} is a process step that turns incoming work or flow into outgoing work or flow."


def _deterministic_compile(graph: dict[str, Any], user_message: str) -> dict[str, Any]:
    text = user_message.strip()
    if not text:
        return _compiler_response("No instruction provided", [], ["What process structure should be added or modified?"])

    parts = [
        p.strip(" .;")
        for p in re.split(r"\s*(?:->|=>|,|\bthen\b|\bnext\b|\bto\b)\s*", text, flags=re.I)
        if p.strip(" .;")
    ]
    if len(parts) < 2:
        node = _make_node(parts[0] if parts else text)
        return _compiler_response(
            "Instruction needs sequencing clarification",
            [{"action": "add_node", "target_id": None, "payload": node, "reason": "User described a step without clear sequencing", "confidence": "medium"}],
            ["Which existing node should this step connect from and to?"],
        )

    mutations: list[dict[str, Any]] = []
    node_ids: list[str] = []
    existing = {slug(n.get("name", "")): n for n in graph.get("nodes", [])}

    for part in parts:
        node = existing.get(slug(part)) or _make_node(part)
        node_ids.append(node["id"])
        if slug(part) not in existing:
            mutations.append({"action": "add_node", "target_id": None, "payload": node, "reason": "User described a process step", "confidence": "high"})

    for from_id, to_id in zip(node_ids, node_ids[1:]):
        mutations.append({
            "action": "add_edge",
            "target_id": None,
            "payload": {
                "id": f"e_{slug(from_id)}_{slug(to_id)}",
                "from_node": from_id,
                "to_node": to_id,
                "type": "flow",
                "condition": "",
                "flows": [],
            },
            "reason": "User described flow between steps",
            "confidence": "high",
        })

    return _compiler_response("Compiled user instruction into graph mutations", mutations, [])


def _compiler_response(
    summary: str,
    mutations: list[dict[str, Any]],
    questions: list[str],
) -> dict[str, Any]:
    return {
        "summary": summary,
        "mutations": mutations,
        "questions": questions,
        "warnings": [],
        "handoff_readiness": {
            "structure_complete": not questions,
            "missing_values": [],
            "missing_constraints": [],
            "open_questions": questions,
        },
    }


# ---------------------------------------------------------------------------
# Markdown export
# ---------------------------------------------------------------------------

def markdown_export(graph: dict[str, Any]) -> str:
    lines = [
        f"# Process Graph: {graph.get('name', graph.get('id', 'Untitled'))}",
        "",
        "## Description",
        graph.get("description", ""),
        "",
        "## Nodes",
        "",
    ]
    for node in graph.get("nodes", []):
        lines.append(f"- **{node.get('id')}**: {node.get('name')} ({node.get('type')})")
        if node.get("description"):
            lines.append(f"  > {node.get('description')} [{node.get('description_status', 'custom')}]")
    lines += ["", "## Edges", ""]
    for edge in graph.get("edges", []):
        lines.append(f"- {edge.get('from_node')} → {edge.get('to_node')} ({edge.get('type')})")
    lines += ["", "## Graph JSON", "", "```json", json.dumps(graph, indent=2), "```"]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Process Graph API", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, str]:
    return {"status": "ok", "version": VERSION}


@app.get("/graph/{graph_id}")
def get_graph(graph_id: str) -> dict[str, Any]:
    store = load_store()
    graph = get_graph_or_create(store, graph_id)
    save_store(store)
    return graph


@app.post("/graph/mutate")
def mutate_graph(request: dict[str, Any]) -> dict[str, Any]:
    graph_id = request.get("graph_id")
    mutations = request.get("mutations") or []
    if not graph_id:
        raise HTTPException(status_code=400, detail="graph_id is required")

    store = load_store()
    graph = get_graph_or_create(store, graph_id)
    before = deepcopy(graph)

    for mutation in mutations:
        apply_mutation(graph, mutation)

    graph.setdefault("versions", []).append(
        {"created_at": now(), "label": "mutation batch", "graph": before}
    )
    graph["versions"] = graph["versions"][-20:]

    store.setdefault("mutation_batches", []).append(
        {"graph_id": graph_id, "created_at": now(), "mutations": mutations, "before": before}
    )
    save_store(store)
    return {"graph": graph, "applied": len(mutations)}


@app.post("/graph/assist")
async def assist_graph(request: dict[str, Any]) -> dict[str, Any]:
    graph_id = request.get("graph_id")
    user_message = request.get("user_message", "")
    if not graph_id:
        raise HTTPException(status_code=400, detail="graph_id is required")

    store = load_store()
    graph = get_graph_or_create(store, graph_id)
    save_store(store)

    if model_router.is_configured():
        try:
            return await model_router.compile_assist(graph, user_message)
        except Exception:
            logger.exception("LLM assist failed; falling back to deterministic compiler")

    return _deterministic_compile(graph, user_message)


@app.get("/graph/{graph_id}/export/md")
def export_markdown(graph_id: str) -> str:
    store = load_store()
    graph = get_graph_or_create(store, graph_id)
    save_store(store)
    return markdown_export(graph)


# ---------------------------------------------------------------------------
# Static frontend — mounted last so API routes take precedence.
# ---------------------------------------------------------------------------
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
