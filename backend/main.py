from __future__ import annotations

import json
import os
import re
import uuid
import base64
import binascii
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Protocol

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


STORE_PATH = Path(os.environ.get("PROCESS_GRAPH_STORE", Path(__file__).parent / "data" / "graphs.json"))
STATIC_DIR = Path(os.environ.get("PROCESS_GRAPH_STATIC_DIR", Path(__file__).resolve().parents[1]))
VERSION = os.environ.get("APP_VERSION", "dev")
PRIVATE_GRAPH_DOCUMENT_FIELDS = {"frontend_envelope", "updated_at"}


class IdentityContext(BaseModel):
    tenant_id: str
    user_id: str = ""
    user_name: str = ""
    source: str = "default"


def _header_value(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _slug_tenant(value: str) -> str:
    value = value.strip()
    return slug(value) if value else "default"


def _claim_value(claims: list[dict[str, Any]], *claim_types: str) -> str:
    normalized = {claim_type.lower() for claim_type in claim_types}
    for claim in claims:
        claim_type = str(claim.get("typ") or claim.get("type") or claim.get("name") or "").lower()
        if claim_type in normalized:
            return str(claim.get("val") or claim.get("value") or "")
    return ""


def parse_client_principal(value: Any) -> dict[str, Any] | None:
    """Parse Azure App Service Easy Auth's X-MS-CLIENT-PRINCIPAL header."""
    value = _header_value(value)
    if not value:
        return None
    try:
        padded = value + "=" * (-len(value) % 4)
        decoded = base64.b64decode(padded).decode("utf-8")
        parsed = json.loads(decoded)
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def resolve_identity_context(
    x_tenant_id: str | None = Header(default=None),
    x_ms_client_principal: str | None = Header(default=None, alias="X-MS-CLIENT-PRINCIPAL"),
    x_ms_client_principal_id: str | None = Header(default=None, alias="X-MS-CLIENT-PRINCIPAL-ID"),
    x_ms_client_principal_name: str | None = Header(default=None, alias="X-MS-CLIENT-PRINCIPAL-NAME"),
) -> IdentityContext:
    """Resolve user/tenant context from auth headers, then explicit/dev fallbacks.

    In cloud deployments with Azure App Service Authentication (Easy Auth), the
    tenant is derived from the signed-in user's token claims. Local dev can still
    pass X-Tenant-Id or use PROCESS_GRAPH_DEFAULT_TENANT.
    """
    tenant_header = _header_value(x_tenant_id)
    principal_id = _header_value(x_ms_client_principal_id)
    principal_name = _header_value(x_ms_client_principal_name)
    principal = parse_client_principal(x_ms_client_principal)
    if principal:
        claims = principal.get("claims") if isinstance(principal.get("claims"), list) else []
        tenant_claim = _claim_value(
            claims,
            "http://schemas.microsoft.com/identity/claims/tenantid",
            "tid",
            "tenant_id",
        )
        user_id = (
            _claim_value(claims, "http://schemas.microsoft.com/identity/claims/objectidentifier", "oid", "sub")
            or str(principal.get("userId") or principal_id or "")
        )
        user_name = str(principal.get("userDetails") or principal_name or "")
        if tenant_claim:
            return IdentityContext(
                tenant_id=_slug_tenant(tenant_claim),
                user_id=user_id,
                user_name=user_name,
                source="auth_claim",
            )
        if user_name and "@" in user_name:
            return IdentityContext(
                tenant_id=_slug_tenant(user_name.split("@", 1)[1]),
                user_id=user_id,
                user_name=user_name,
                source="auth_user_domain",
            )

    if tenant_header:
        return IdentityContext(tenant_id=tenant_header, source="x_tenant_id")
    return IdentityContext(tenant_id=os.environ.get("PROCESS_GRAPH_DEFAULT_TENANT", "default"), source="default")


def resolve_tenant_id(
    x_tenant_id: str | None = Header(default=None),
    x_ms_client_principal: str | None = Header(default=None, alias="X-MS-CLIENT-PRINCIPAL"),
    x_ms_client_principal_id: str | None = Header(default=None, alias="X-MS-CLIENT-PRINCIPAL-ID"),
    x_ms_client_principal_name: str | None = Header(default=None, alias="X-MS-CLIENT-PRINCIPAL-NAME"),
) -> str:
    """Resolve the tenant for a request (Propel guardrail: no tenant-less records).

    Order: authenticated cloud identity headers, the ``X-Tenant-Id`` request
    header, then the ``PROCESS_GRAPH_DEFAULT_TENANT`` env var, then the literal
    ``"default"``. The id stays ``snake_case`` on the wire.
    """
    return resolve_identity_context(
        x_tenant_id=x_tenant_id,
        x_ms_client_principal=x_ms_client_principal,
        x_ms_client_principal_id=x_ms_client_principal_id,
        x_ms_client_principal_name=x_ms_client_principal_name,
    ).tenant_id

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


class GraphEnvelopeRequest(BaseModel):
    """Request envelope for saving the full frontend graph state."""

    envelope: dict[str, Any] = Field(default_factory=dict)


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
    return {
        key: value
        for key, value in item.items()
        if not key.startswith("_") and key not in PRIVATE_GRAPH_DOCUMENT_FIELDS
    }


class GraphStore(Protocol):
    """Storage boundary for graphs and mutation batches.

    Every method is tenant-scoped: a ``tenant_id`` partitions all durable
    records so a graph saved under one tenant is never readable or mutable
    under another (Propel guardrail: no tenant-less production records, and
    no cross-tenant access by default)."""

    def get_graph(self, tenant_id: str, graph_id: str) -> dict[str, Any] | None: ...

    def upsert_graph(self, tenant_id: str, graph: dict[str, Any]) -> None: ...

    def append_mutation_batch(self, tenant_id: str, batch: dict[str, Any]) -> None: ...

    def list_graphs(self, tenant_id: str) -> list[dict[str, Any]]: ...

    def get_envelope(self, tenant_id: str, graph_id: str) -> dict[str, Any] | None: ...

    def upsert_envelope(self, tenant_id: str, graph_id: str, envelope: dict[str, Any]) -> None: ...


class JsonFileStore:
    """Local dev store backed by a single JSON file. Reads/writes the whole file
    per operation - fine for a single-user scaffold, not for production.

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
    ``None`` - so tenant B never sees tenant A's graph."""

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
        bucket = store.setdefault("tenants", {}).setdefault(
            tenant_id, {"graphs": {}, "graph_envelopes": {}, "mutation_batches": []}
        )
        bucket.setdefault("graphs", {})
        bucket.setdefault("graph_envelopes", {})
        bucket.setdefault("mutation_batches", [])
        return bucket

    def get_graph(self, tenant_id: str, graph_id: str) -> dict[str, Any] | None:
        tenant = self._load().get("tenants", {}).get(tenant_id)
        if tenant is None:
            return None
        graph = tenant.get("graphs", {}).get(graph_id)
        return _strip_cosmos_system_fields(graph) if graph else None

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

    def list_graphs(self, tenant_id: str) -> list[dict[str, Any]]:
        tenant = self._load().get("tenants", {}).get(tenant_id)
        if tenant is None:
            return []
        envelopes = tenant.get("graph_envelopes", {})
        summaries = []
        for graph_id, graph in tenant.get("graphs", {}).items():
            envelope = envelopes.get(graph_id, {})
            updated_at = envelope.get("updated_at") or graph.get("updated_at") or graph.get("metadata", {}).get("created_at", "")
            summaries.append(graph_summary(_strip_cosmos_system_fields(graph), updated_at=updated_at))
        return sorted(summaries, key=lambda item: item.get("updated_at", ""), reverse=True)

    def get_envelope(self, tenant_id: str, graph_id: str) -> dict[str, Any] | None:
        tenant = self._load().get("tenants", {}).get(tenant_id)
        if tenant is None:
            return None
        envelope = tenant.get("graph_envelopes", {}).get(graph_id)
        if envelope:
            return envelope
        graph = tenant.get("graphs", {}).get(graph_id)
        return {"graph": _strip_cosmos_system_fields(graph)} if graph else None

    def upsert_envelope(self, tenant_id: str, graph_id: str, envelope: dict[str, Any]) -> None:
        store = self._load()
        bucket = self._tenant_bucket(store, tenant_id)
        graph = envelope.get("graph") if isinstance(envelope.get("graph"), dict) else default_graph(graph_id, tenant_id)
        graph = {**_strip_cosmos_system_fields(graph), "id": graph_id, "tenant_id": tenant_id, "updated_at": now()}
        envelope = {**envelope, "graph": _strip_cosmos_system_fields(graph), "updated_at": graph["updated_at"]}
        bucket["graphs"][graph_id] = graph
        bucket["graph_envelopes"][graph_id] = envelope
        self._save(store)


class CosmosGraphStore:
    """Azure Cosmos DB store, tenant-partitioned. Both containers partition by
    ``/tenant_id`` so every read and write is physically scoped to a single
    tenant - cross-tenant access is impossible by default (Propel guardrail).
    The Cosmos SDK is imported lazily so local dev needs no Azure dependency.

    Partition strategy: ``/tenant_id`` is the partition key on both containers.
    A graph's logical identity within a tenant is ``id`` (the ``graph_id``), so
    a graph is uniquely addressed by the composite (``tenant_id``, ``id``) - the
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
        from azure.cosmos import exceptions

        document = {**_strip_cosmos_system_fields(graph), "tenant_id": tenant_id, "updated_at": now()}
        existing = None
        try:
            existing = self._graphs.read_item(item=document["id"], partition_key=tenant_id)
        except exceptions.CosmosResourceNotFoundError:
            existing = None
        if existing and existing.get("frontend_envelope"):
            document["frontend_envelope"] = existing["frontend_envelope"]
        self._graphs.upsert_item(document)

    def append_mutation_batch(self, tenant_id: str, batch: dict[str, Any]) -> None:
        self._batches.upsert_item({**batch, "tenant_id": tenant_id, "id": uuid.uuid4().hex})

    def list_graphs(self, tenant_id: str) -> list[dict[str, Any]]:
        query = "SELECT c.id, c.name, c.version, c.tenant_id, c.updated_at, c.metadata, c.nodes, c.edges FROM c WHERE c.tenant_id = @tenant_id"
        items = self._graphs.query_items(
            query=query,
            parameters=[{"name": "@tenant_id", "value": tenant_id}],
            partition_key=tenant_id,
        )
        summaries = [graph_summary(_strip_cosmos_system_fields(item), updated_at=item.get("updated_at", "")) for item in items]
        return sorted(summaries, key=lambda item: item.get("updated_at", ""), reverse=True)

    def get_envelope(self, tenant_id: str, graph_id: str) -> dict[str, Any] | None:
        from azure.cosmos import exceptions

        try:
            item = self._graphs.read_item(item=graph_id, partition_key=tenant_id)
        except exceptions.CosmosResourceNotFoundError:
            return None
        if item.get("tenant_id") != tenant_id:
            return None
        envelope = item.get("frontend_envelope")
        if isinstance(envelope, dict):
            return envelope
        return {"graph": _strip_cosmos_system_fields(item)}

    def upsert_envelope(self, tenant_id: str, graph_id: str, envelope: dict[str, Any]) -> None:
        graph = envelope.get("graph") if isinstance(envelope.get("graph"), dict) else default_graph(graph_id, tenant_id)
        updated_at = now()
        document = {
            **_strip_cosmos_system_fields(graph),
            "id": graph_id,
            "tenant_id": tenant_id,
            "updated_at": updated_at,
            "frontend_envelope": {**envelope, "graph": _strip_cosmos_system_fields(graph), "updated_at": updated_at},
        }
        self._graphs.upsert_item(document)


def select_store_kind() -> str:
    """Pick the storage backend from the environment: Cosmos when ``COSMOS_URI``
    is set, otherwise the local JSON file store."""
    return "cosmos" if os.environ.get("COSMOS_URI") else "json"


def create_store() -> GraphStore:
    if select_store_kind() == "cosmos":
        return CosmosGraphStore()
    return JsonFileStore(STORE_PATH)


store: GraphStore = create_store()


def graph_summary(graph: dict[str, Any], updated_at: str = "") -> dict[str, Any]:
    return {
        "id": graph.get("id", ""),
        "name": graph.get("name") or graph.get("id", "Untitled Process Graph"),
        "version": graph.get("version", ""),
        "tenant_id": graph.get("tenant_id", ""),
        "updated_at": updated_at or graph.get("updated_at") or graph.get("metadata", {}).get("created_at", ""),
        "node_count": len(graph.get("nodes", []) or []),
        "edge_count": len(graph.get("edges", []) or []),
    }


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


@app.get("/session")
def session(identity: IdentityContext = Depends(resolve_identity_context)) -> dict[str, str]:
    return identity.model_dump()


@app.get("/graphs")
def list_graphs(tenant_id: str = Depends(resolve_tenant_id)) -> dict[str, list[dict[str, Any]]]:
    return {"graphs": store.list_graphs(tenant_id)}


@app.get("/graph/{graph_id}/envelope")
def get_graph_envelope(graph_id: str, tenant_id: str = Depends(resolve_tenant_id)) -> dict[str, Any]:
    envelope = store.get_envelope(tenant_id, graph_id)
    if envelope is None:
        raise HTTPException(status_code=404, detail="Graph not found")
    return envelope


@app.put("/graph/{graph_id}/envelope")
def save_graph_envelope(
    graph_id: str,
    request: GraphEnvelopeRequest,
    tenant_id: str = Depends(resolve_tenant_id),
) -> dict[str, Any]:
    envelope = request.envelope or {}
    graph = envelope.get("graph") if isinstance(envelope.get("graph"), dict) else None
    if graph is None:
        raise HTTPException(status_code=422, detail="Envelope must include graph")
    graph["id"] = graph_id
    store.upsert_envelope(tenant_id, graph_id, envelope)
    return {"graph": store.get_graph(tenant_id, graph_id), "envelope": store.get_envelope(tenant_id, graph_id)}


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
