from __future__ import annotations

import json
import os
import re
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Protocol

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


STORE_PATH = Path(os.environ.get("PROCESS_GRAPH_STORE", Path(__file__).parent / "data" / "graphs.json"))
STATIC_DIR = Path(__file__).parent / "static"
VERSION = os.environ.get("APP_VERSION", "dev")


def resolve_tenant_id(x_tenant_id: str | None = Header(default=None)) -> str:
    """Resolve the tenant for a request (Propel guardrail: no tenant-less records).

    Order: the ``X-Tenant-Id`` request header, then the
    ``PROCESS_GRAPH_DEFAULT_TENANT`` env var, then the literal ``"default"``.
    Used as a FastAPI dependency on every durable route so a tenant id is always
    threaded through to the store. The id stays ``snake_case`` on the wire.
    """
    if x_tenant_id and x_tenant_id.strip():
        return x_tenant_id.strip()
    return os.environ.get("PROCESS_GRAPH_DEFAULT_TENANT", "default")

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


MutationAction = Literal[
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
]


class Mutation(BaseModel):
    """A single deterministic graph mutation. Mirrors schema/mutation.schema.json."""

    action: MutationAction
    target_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    reason: str = ""
    confidence: Literal["high", "medium", "low"] = "medium"


class MutateRequest(BaseModel):
    """Request envelope for POST /graph/mutate."""

    graph_id: str
    mutations: list[Mutation] = Field(default_factory=list)


class AssistRequest(BaseModel):
    """Request envelope for POST /graph/assist."""

    graph_id: str
    user_message: str = ""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slug(value: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "_", str(value).lower()).strip("_")
    return clean[:58] or "id"


def default_graph(graph_id: str = "pg-intake-to-close", tenant_id: str = "default") -> dict[str, Any]:
    return {
        "id": graph_id,
        "tenant_id": tenant_id,
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
        "metadata": {"created_by": "FastAPI scaffold", "created_at": now(), "tags": []},
    }


def _strip_cosmos_system_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Drop Cosmos-managed properties (``_rid``, ``_etag``, ``_ts``, ...) so the
    public graph contract stays clean snake_case with no SDK-native fields."""
    return {key: value for key, value in item.items() if not key.startswith("_")}


class GraphStore(Protocol):
    """Storage boundary for graphs and mutation batches.

    Every method is tenant-scoped: a ``tenant_id`` partitions all durable
    records so a graph saved under one tenant is never readable or mutable
    under another (Propel guardrail: no tenant-less production records, and
    no cross-tenant access by default)."""

    def get_graph(self, tenant_id: str, graph_id: str) -> dict[str, Any] | None: ...

    def upsert_graph(self, tenant_id: str, graph: dict[str, Any]) -> None: ...

    def append_mutation_batch(self, tenant_id: str, batch: dict[str, Any]) -> None: ...


class JsonFileStore:
    """Local dev store backed by a single JSON file. Reads/writes the whole file
    per operation — fine for a single-user scaffold, not for production.

    Layout is tenant-namespaced so cross-tenant access is impossible by default::

        {
          "tenants": {
            "<tenant_id>": {
              "graphs": { "<graph_id>": { ...graph, "tenant_id": "<tenant_id>" } },
              "mutation_batches": [ { ...batch, "tenant_id": "<tenant_id>" } ]
            }
          }
        }

    A read for a missing tenant (or a missing graph within a tenant) returns
    ``None`` — so tenant B never sees tenant A's graph."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"tenants": {}}
        with self.path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _save(self, store: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(store, handle, indent=2)

    def _tenant_bucket(self, store: dict[str, Any], tenant_id: str) -> dict[str, Any]:
        return store.setdefault("tenants", {}).setdefault(
            tenant_id, {"graphs": {}, "mutation_batches": []}
        )

    def get_graph(self, tenant_id: str, graph_id: str) -> dict[str, Any] | None:
        tenant = self._load().get("tenants", {}).get(tenant_id)
        if tenant is None:
            return None
        return tenant.get("graphs", {}).get(graph_id)

    def upsert_graph(self, tenant_id: str, graph: dict[str, Any]) -> None:
        store = self._load()
        bucket = self._tenant_bucket(store, tenant_id)
        bucket["graphs"][graph["id"]] = {**graph, "tenant_id": tenant_id}
        self._save(store)

    def append_mutation_batch(self, tenant_id: str, batch: dict[str, Any]) -> None:
        store = self._load()
        bucket = self._tenant_bucket(store, tenant_id)
        bucket["mutation_batches"].append({**batch, "tenant_id": tenant_id})
        self._save(store)


class CosmosGraphStore:
    """Azure Cosmos DB store, tenant-partitioned. Both containers partition by
    ``/tenant_id`` so every read and write is physically scoped to a single
    tenant — cross-tenant access is impossible by default (Propel guardrail).
    The Cosmos SDK is imported lazily so local dev needs no Azure dependency.

    Partition strategy: ``/tenant_id`` is the partition key on both containers.
    A graph's logical identity within a tenant is ``id`` (the ``graph_id``), so
    a graph is uniquely addressed by the composite (``tenant_id``, ``id``) — the
    same ``graph_id`` may exist independently under different tenants. Reads use
    ``read_item(item=graph_id, partition_key=tenant_id)``; a graph that lives in
    another tenant's partition is never returned. Mutation-batch queries always
    filter by partition (``partition_key=tenant_id``) so a batch listing is
    tenant-scoped too.

    Auth: uses ``COSMOS_KEY`` when set, otherwise ``DefaultAzureCredential``
    (managed identity / ``az login``)."""

    def __init__(self) -> None:
        from azure.cosmos import CosmosClient, PartitionKey

        uri = os.environ["COSMOS_URI"]
        database_name = os.environ.get("COSMOS_DATABASE", "process_graph_builder")
        graphs_name = os.environ.get("COSMOS_GRAPHS_CONTAINER", "graphs")
        batches_name = os.environ.get("COSMOS_MUTATION_BATCHES_CONTAINER", "mutation_batches")
        key = os.environ.get("COSMOS_KEY")

        if key:
            client = CosmosClient(uri, credential=key)
        else:
            from azure.identity import DefaultAzureCredential

            client = CosmosClient(uri, credential=DefaultAzureCredential())

        if os.environ.get("COSMOS_CREATE_IF_MISSING", "true").lower() != "false":
            database = client.create_database_if_not_exists(database_name)
            self._graphs = database.create_container_if_not_exists(
                id=graphs_name, partition_key=PartitionKey(path="/tenant_id")
            )
            self._batches = database.create_container_if_not_exists(
                id=batches_name, partition_key=PartitionKey(path="/tenant_id")
            )
        else:
            database = client.get_database_client(database_name)
            self._graphs = database.get_container_client(graphs_name)
            self._batches = database.get_container_client(batches_name)

    def get_graph(self, tenant_id: str, graph_id: str) -> dict[str, Any] | None:
        from azure.cosmos import exceptions

        try:
            item = self._graphs.read_item(item=graph_id, partition_key=tenant_id)
        except exceptions.CosmosResourceNotFoundError:
            return None
        # Defense in depth: never hand back a doc from another tenant's partition.
        if item.get("tenant_id") != tenant_id:
            return None
        return _strip_cosmos_system_fields(item)

    def upsert_graph(self, tenant_id: str, graph: dict[str, Any]) -> None:
        document = {**_strip_cosmos_system_fields(graph), "tenant_id": tenant_id}
        self._graphs.upsert_item(document)

    def append_mutation_batch(self, tenant_id: str, batch: dict[str, Any]) -> None:
        self._batches.upsert_item({**batch, "tenant_id": tenant_id, "id": uuid.uuid4().hex})


def select_store_kind() -> str:
    """Pick the storage backend from the environment: Cosmos when ``COSMOS_URI``
    is set, otherwise the local JSON file store."""
    return "cosmos" if os.environ.get("COSMOS_URI") else "json"


def create_store() -> GraphStore:
    if select_store_kind() == "cosmos":
        return CosmosGraphStore()
    return JsonFileStore(STORE_PATH)


store: GraphStore = create_store()


def get_graph_or_create(store: GraphStore, tenant_id: str, graph_id: str) -> dict[str, Any]:
    graph = store.get_graph(tenant_id, graph_id)
    if graph is None:
        graph = default_graph(graph_id, tenant_id)
        store.upsert_graph(tenant_id, graph)
    return graph


def upsert_by_id(items: list[dict[str, Any]], item: dict[str, Any]) -> None:
    for index, existing in enumerate(items):
        if existing.get("id") == item.get("id"):
            items[index] = {**existing, **item}
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
        graph["nodes"] = [node for node in graph.get("nodes", []) if node.get("id") != target_id]
        graph["edges"] = [
            edge
            for edge in graph.get("edges", [])
            if edge.get("from_node") != target_id and edge.get("to_node") != target_id
        ]
    elif action == "add_edge":
        upsert_by_id(graph.setdefault("edges", []), payload)
    elif action == "update_edge":
        upsert_by_id(graph.setdefault("edges", []), {"id": target_id, **payload})
    elif action == "delete_edge":
        graph["edges"] = [edge for edge in graph.get("edges", []) if edge.get("id") != target_id]
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
        graph.setdefault("open_questions", []).append(payload.get("text") or payload.get("question") or "")


def compile_assist_message(graph: dict[str, Any], user_message: str) -> dict[str, Any]:
    text = user_message.strip()
    if not text:
        return compiler_response("No instruction provided", [], ["What process structure should be added or modified?"])

    parts = [part.strip(" .;") for part in re.split(r"\s*(?:->|=>|,|\bthen\b|\bnext\b|\bto\b)\s*", text, flags=re.I)]
    parts = [part for part in parts if part]
    if len(parts) < 2:
        question = "Which existing node should this step connect from and to?"
        node_name = parts[0] if parts else text
        mutation = {
            "action": "add_node",
            "target_id": None,
            "payload": make_node(node_name, text),
            "reason": "User described a step without clear sequencing",
            "confidence": "medium",
        }
        return compiler_response("Instruction needs sequencing clarification", [mutation], [question])

    mutations: list[dict[str, Any]] = []
    node_ids: list[str] = []
    existing_names = {slug(node.get("name", "")): node for node in graph.get("nodes", [])}
    for part in parts:
        node = existing_names.get(slug(part)) or make_node(part, text)
        node_ids.append(node["id"])
        if slug(part) not in existing_names:
            mutations.append(
                {
                    "action": "add_node",
                    "target_id": None,
                    "payload": node,
                    "reason": "User described a process step",
                    "confidence": "high",
                }
            )

    for from_id, to_id in zip(node_ids, node_ids[1:]):
        mutations.append(
            {
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
            }
        )

    return compiler_response("Compiled user instruction into graph mutations", mutations, [])


def make_node(name: str, full_text: str) -> dict[str, Any]:
    lower = name.lower()
    if re.search(r"\b(source|start|supplier|customer|input)\b", lower):
        node_type = "source"
    elif re.search(r"\b(sink|end|closed|posted|done|ledger)\b", lower):
        node_type = "sink"
    elif re.search(r"\b(decision|is |whether|approved|complete|found)\b", lower):
        node_type = "decision"
    else:
        node_type = "task"
    clean_name = re.sub(r"\b(source|sink|task|decision)\b[:\s-]*", "", name, flags=re.I).strip() or name
    return {
        "id": f"n_{slug(clean_name)}",
        "name": clean_name[:1].upper() + clean_name[1:],
        "type": node_type,
        "description": suggest_node_description(clean_name, node_type),
        "description_status": "suggested",
        "inputs": [],
        "outputs": [],
        "resources_required": [],
        "attributes": {},
        "notes": "",
    }


def suggest_node_description(name: str, node_type: str) -> str:
    label = name[:1].upper() + name[1:] if name else "This node"
    if node_type == "source":
        return f"{label} is the entry point where work, material, data, demand, or value first enters the graph."
    if node_type == "sink":
        return f"{label} is the end point where work, material, data, demand, or value leaves the graph or is considered complete."
    if node_type == "decision":
        return f"{label} is a decision point that checks incoming work or flow and routes the next step based on clear conditions."
    return f"{label} is a process step that turns incoming work or flow into outgoing work or flow."


def compiler_response(summary: str, mutations: list[dict[str, Any]], questions: list[str]) -> dict[str, Any]:
    return {
        "summary": summary,
        "mutations": mutations,
        "questions": questions,
        "warnings": [],
        "handoff_readiness": {
            "structure_complete": not questions,
            "missing_values": [],
            "missing_constraints": ["constraints"],
            "open_questions": questions,
        },
    }


def markdown_export(graph: dict[str, Any]) -> str:
    lines = [f"# Process Graph: {graph.get('name', graph.get('id', 'Untitled'))}", "", "## Description", graph.get("description", ""), ""]
    lines.extend(["## Nodes", ""])
    for node in graph.get("nodes", []):
        lines.append(f"- {node.get('id')}: {node.get('name')} ({node.get('type')})")
        if node.get("description"):
            lines.append(f"  Definition: {node.get('description')} [{node.get('description_status', 'custom')}]")
    lines.extend(["", "## Edges", ""])
    for edge in graph.get("edges", []):
        lines.append(f"- {edge.get('from_node')} -> {edge.get('to_node')} ({edge.get('type')})")
    lines.extend(["", "## Graph JSON", "", "```json", json.dumps(graph, indent=2), "```"])
    return "\n".join(lines)


app = FastAPI(title="Process Graph Builder API", version=VERSION)
DEV_ORIGINS = os.environ.get(
    "PROCESS_GRAPH_CORS_ORIGINS",
    "http://localhost:4173,http://127.0.0.1:4173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in DEV_ORIGINS if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, str]:
    return {"status": "ok", "version": VERSION}


# Routes are intentionally sync `def`, not `async def`. The active storage
# backends (JSON file, Cosmos sync SDK) do blocking I/O; FastAPI runs sync
# handlers in a threadpool, so they don't block the event loop. Making them
# `async def` over blocking I/O would block it. Switch to `async def` only when
# the store offers async I/O (e.g. azure.cosmos.aio).
@app.get("/graph/{graph_id}")
def get_graph(graph_id: str, tenant_id: str = Depends(resolve_tenant_id)) -> dict[str, Any]:
    return get_graph_or_create(store, tenant_id, graph_id)


@app.post("/graph/mutate")
def mutate_graph(request: MutateRequest, tenant_id: str = Depends(resolve_tenant_id)) -> dict[str, Any]:
    graph_id = request.graph_id
    mutations = [mutation.model_dump() for mutation in request.mutations]
    graph = get_graph_or_create(store, tenant_id, graph_id)
    before = deepcopy(graph)
    for mutation in mutations:
        apply_mutation(graph, mutation)
    graph.setdefault("versions", []).append({"created_at": now(), "label": "mutation batch", "graph": before})
    graph["versions"] = graph["versions"][-20:]
    store.upsert_graph(tenant_id, graph)
    store.append_mutation_batch(
        tenant_id,
        {"graph_id": graph_id, "tenant_id": tenant_id, "created_at": now(), "mutations": mutations, "before": before},
    )
    return {"graph": graph, "applied": len(mutations)}


@app.post("/graph/assist")
def assist_graph(request: AssistRequest, tenant_id: str = Depends(resolve_tenant_id)) -> dict[str, Any]:
    graph = get_graph_or_create(store, tenant_id, request.graph_id)
    return compile_assist_message(graph, request.user_message)


@app.get("/graph/{graph_id}/export/md")
def export_markdown(graph_id: str, tenant_id: str = Depends(resolve_tenant_id)) -> str:
    graph = get_graph_or_create(store, tenant_id, graph_id)
    return markdown_export(graph)


# Mounted last so API routes take precedence over the static frontend.
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
