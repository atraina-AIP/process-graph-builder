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
LLM_ASSIST_TRUE_VALUES = {"1", "true", "yes", "on"}
COMPILER_PROMPT_VERSION = "process_graph_compiler_v2"
DEFAULT_LLM_MODEL = "gpt-5.5"
LLM_ASSIST_CLIENT: Any = None


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
    graph: dict[str, Any] | None = None
    chat_messages: list[dict[str, Any]] = Field(default_factory=list)
    use_llm: bool = False


class GraphEnvelopeRequest(BaseModel):
    """Request envelope for saving the full frontend graph state."""

    envelope: dict[str, Any] = Field(default_factory=dict)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slug(value: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "_", str(value).lower()).strip("_")
    return clean[:58] or "id"


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in LLM_ASSIST_TRUE_VALUES


def is_llm_assist_enabled() -> bool:
    return env_flag("PROCESS_GRAPH_LLM_ASSIST_ENABLED", False)


def llm_model_name() -> str:
    return os.environ.get("PROCESS_GRAPH_LLM_MODEL", DEFAULT_LLM_MODEL).strip() or DEFAULT_LLM_MODEL


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
    compiler = {"mode": "deterministic", "prompt_version": COMPILER_PROMPT_VERSION}
    if not text:
        return compiler_response(
            "No instruction provided",
            [],
            ["What process structure should be added or modified?"],
            compiler=compiler,
        )

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
        return compiler_response("Instruction needs sequencing clarification", [mutation], [question], compiler=compiler)

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

    for index, (from_id, to_id) in enumerate(zip(node_ids, node_ids[1:])):
        from_name = parts[index]
        to_name = parts[index + 1]
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
                    "flows": infer_flows_from_text(text, from_name, to_name),
                },
                "reason": "User described flow between steps",
                "confidence": "high",
            }
        )

    return compiler_response("Compiled user instruction into graph mutations", mutations, [], compiler=compiler)


def infer_flows_from_text(text: str, from_name: str = "", to_name: str = "") -> list[dict[str, Any]]:
    haystack = f"{text} {from_name} {to_name}"
    candidates = [
        (r"\b(cash|money|payment|invoice|revenue|cost|budget|price|dollar|margin)\b", "cash", "cash"),
        (r"\b(energy|electric|electricity|power|heat|fuel|steam|compressed air)\b", "energy", "energy"),
        (r"\b(part|parts|material|component|inventory|product|goods|scrap|unit|pallet|pallets|shipment|shipments)\b", "parts", "parts"),
        (r"\b(data|record|file|measurement|table|model input|model output|telemetry|sensor)\b", "data", "data"),
        (r"\b(approval|approve|sign off|permission|authorization|release)\b", "approval", "approval"),
        (r"\b(request|order|message|document|information|notice|signal|instruction|forecast)\b", "information", "information"),
        (r"\b(work|job|case|task|effort|wip|ticket)\b", "work", "work"),
    ]
    flows: list[dict[str, Any]] = []
    seen: set[str] = set()
    edge_prefix = slug(f"{from_name}_{to_name}")
    for pattern, name, kind in candidates:
        if re.search(pattern, haystack, flags=re.I) and name not in seen:
            seen.add(name)
            flows.append(
                {
                    "id": f"f_{edge_prefix}_{slug(name)}",
                    "name": name,
                    "kind": kind,
                    "quantity": "",
                    "unit": "",
                    "properties": {},
                }
            )
    return flows


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


def compiler_response(
    summary: str,
    mutations: list[dict[str, Any]],
    questions: list[str],
    warnings: list[str] | None = None,
    compiler: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "summary": summary,
        "mutations": mutations,
        "questions": questions,
        "warnings": warnings or [],
        "handoff_readiness": {
            "structure_complete": not questions,
            "missing_values": [],
            "missing_constraints": ["constraints"],
            "open_questions": questions,
        },
    }
    if compiler:
        result["compiler"] = compiler
    return result


ASSIST_RESPONSE_SCHEMA = {
    "type": "object",
    "required": ["summary", "mutations", "questions", "warnings", "handoff_readiness"],
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "mutations": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["action", "target_id", "payload", "reason", "confidence"],
                "additionalProperties": False,
                "properties": {
                    "action": {"enum": sorted(MUTATION_ACTIONS)},
                    "target_id": {"type": ["string", "null"]},
                    "payload": {"type": "object"},
                    "reason": {"type": "string"},
                    "confidence": {"enum": ["high", "medium", "low"]},
                },
            },
        },
        "questions": {"type": "array", "items": {"type": "string"}},
        "warnings": {"type": "array", "items": {"type": "string"}},
        "handoff_readiness": {
            "type": "object",
            "additionalProperties": True,
            "properties": {
                "structure_complete": {"type": "boolean"},
                "missing_values": {"type": "array", "items": {"type": "string"}},
                "missing_constraints": {"type": "array", "items": {"type": "string"}},
                "open_questions": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
}


PROCESS_GRAPH_COMPILER_BASE_PROMPT = """You are a process-graph mutation planner.

Your job is to convert a user's process-mapping instruction into graph mutation commands.
Return strict JSON only with summary, mutations, questions, warnings, and handoff_readiness.

Rules:
1. Use only allowed mutation actions, node types, edge types, flow kinds, and constraint types.
2. Preserve existing IDs unless a mutation intentionally modifies or deletes an existing element.
3. Never invent numeric quantities, costs, durations, capacities, rates, probabilities, or dates.
4. If information is implied but uncertain, add an assumption or ask a clarification question.
5. Directed edges imply precedence; do not create separate precedence constraints.
6. Create typed edge flows for what moves: parts, cash, energy, information, data, work, approval, or custom.
7. Branching compiles into decision nodes, conditioned outgoing edges, and routing_rule constraints when useful.
8. Conservation, scrap, waste, loss, storage, and transformation compile into flow_balance constraints when useful.
9. Resource needs and capacity limits compile into resource nodes, allocation edges, or capability_limit constraints.
10. Treat your output as a proposal for human approval, not an operational fact.
11. When the user mentions plant JSON, structured MILP, optimizer, NOR, scenarios, commodities, or process equipment, keep returning process-graph mutations but preserve exporter hints in node.attributes, edge.properties, flow.properties, assumptions, and constraints.
12. For optimizer/MILP-oriented graphs, prioritize the transferable abstraction: stable node IDs, node roles (source/supply, transformation, storage/buffer, decision/quality, product/sink), named properties with units and variableType hints, typed flows, relationship constraints, objective terms, and timeConfig. Stage labels like Mixer/Dryer/Pellet Press are examples only; never force them when the user's domain has better vocabulary.
13. Do not embed contracts as plant topology. Contracts and scenarios layer on later; ask a question when the selected contracts, scenario periods, or periodLength are unclear.
14. Every constraint or objective hint that references node.property must refer to a property named on that node; otherwise ask a question instead of creating a dangling reference.
"""


PROCESS_GRAPH_COMPILER_EXAMPLES = [
    {
        "domain": "dta_flow",
        "user_message": "Map the DTA flow: equipment telemetry lands in the historian, the analytics model scores anomalies, maintenance reviews high-risk alerts, and approved work orders go to CMMS.",
        "assistant_response": {
            "summary": "Compiled a data-to-action flow with data, information, approval, and work movement.",
            "mutations": [
                {"action": "add_node", "target_id": None, "payload": {"id": "n_equipment_telemetry", "name": "Equipment telemetry", "type": "source", "inputs": [], "outputs": ["telemetry"], "attributes": {}}, "reason": "Telemetry is the data source.", "confidence": "high"},
                {"action": "add_node", "target_id": None, "payload": {"id": "n_score_anomalies", "name": "Score anomalies", "type": "task", "inputs": ["telemetry"], "outputs": ["risk score"], "attributes": {}}, "reason": "Analytics transforms telemetry into risk scores.", "confidence": "high"},
                {"action": "add_node", "target_id": None, "payload": {"id": "n_review_alert", "name": "Review high-risk alert", "type": "decision", "inputs": ["risk score"], "outputs": ["approved work", "rejected alert"], "attributes": {}}, "reason": "Human review decides whether action is required.", "confidence": "medium"},
                {"action": "add_edge", "target_id": None, "payload": {"id": "e_telemetry_score", "from_node": "n_equipment_telemetry", "to_node": "n_score_anomalies", "type": "flow", "condition": "", "flows": [{"id": "f_telemetry", "name": "telemetry", "kind": "data", "quantity": "", "unit": "", "properties": {}}]}, "reason": "Telemetry data feeds anomaly scoring.", "confidence": "high"},
            ],
            "questions": ["What happens to rejected alerts after maintenance review?"],
            "warnings": [],
            "handoff_readiness": {"structure_complete": False, "missing_values": [], "missing_constraints": [], "open_questions": ["What happens to rejected alerts after maintenance review?"]},
        },
    },
    {
        "domain": "network_distribution_flow",
        "user_message": "Supplier ships pallets to the regional DC, the DC cross-docks priority orders to stores and stores return damaged goods to the returns center.",
        "assistant_response": {
            "summary": "Compiled a distribution network with material movements and a returns feedback path.",
            "mutations": [
                {"action": "add_node", "target_id": None, "payload": {"id": "n_supplier", "name": "Supplier", "type": "source", "inputs": [], "outputs": ["pallets"], "attributes": {}}, "reason": "Supplier is the upstream material source.", "confidence": "high"},
                {"action": "add_node", "target_id": None, "payload": {"id": "n_regional_dc", "name": "Regional DC", "type": "task", "inputs": ["pallets"], "outputs": ["priority orders"], "attributes": {}}, "reason": "The DC receives and cross-docks goods.", "confidence": "high"},
                {"action": "add_edge", "target_id": None, "payload": {"id": "e_supplier_dc", "from_node": "n_supplier", "to_node": "n_regional_dc", "type": "flow", "condition": "", "flows": [{"id": "f_pallets", "name": "pallets", "kind": "parts", "quantity": "", "unit": "", "properties": {}}]}, "reason": "Physical goods move into the DC.", "confidence": "high"},
            ],
            "questions": ["Should non-priority orders also leave the regional DC through a separate branch?"],
            "warnings": [],
            "handoff_readiness": {"structure_complete": False, "missing_values": [], "missing_constraints": [], "open_questions": ["Should non-priority orders also leave the regional DC through a separate branch?"]},
        },
    },

    {
        "domain": "plant_structured_milp",
        "user_message": "Build a structured MILP-ready graph: hardwood chips and pine chips are purchased, blended into feed, moisture is reduced, finished product is produced and sold monthly using a 730 hour period length.",
        "assistant_response": {
            "summary": "Compiled an optimization-ready process graph with reusable node roles, material flows, property/variable hints, relationship constraints, objective guidance, and timeConfig assumptions for a future structured-MILP exporter.",
            "mutations": [
                {"action": "add_node", "target_id": None, "payload": {"id": "n_hardwood_chips", "name": "Hardwood chips supply", "type": "source", "inputs": [], "outputs": ["hardwood chips"], "attributes": {"optimizer_role": "source_supply", "milp_properties": {"Purchases_sTPerHr": {"variableType": "decision", "unit": "sT/hr"}, "UnitCost": {"variableType": "exogenous", "unit": "USD/sT"}, "Capacity": {"variableType": "processParameter", "unit": "sT/hr"}}}}, "reason": "Supply nodes should expose purchasable quantity, cost, and capacity properties for optimization export.", "confidence": "high"},
                {"action": "add_node", "target_id": None, "payload": {"id": "n_blend_feed", "name": "Blend feed", "type": "task", "inputs": ["hardwood chips", "pine chips"], "outputs": ["blended feed"], "attributes": {"optimizer_role": "transformation", "milp_properties": {"Throughput_sTPerHr": {"variableType": "decision", "unit": "sT/hr"}, "RatedCapacity_sTPerHr": {"variableType": "processParameter", "unit": "sT/hr"}, "Yield": {"variableType": "processParameter", "unit": "percent"}}}}, "reason": "Transformation nodes should name throughput, capacity, and yield properties without relying on a fixed stage vocabulary.", "confidence": "high"},
                {"action": "add_node", "target_id": None, "payload": {"id": "n_finished_product", "name": "Finished product", "type": "sink", "inputs": ["finished product"], "outputs": [], "attributes": {"optimizer_role": "product_sink", "milp_properties": {"Sales_sTPerHr": {"variableType": "decision", "unit": "sT/hr"}, "SellingPrice": {"variableType": "exogenous", "unit": "USD/sT"}}}}, "reason": "Product/sink nodes should expose sales and price properties for objective generation.", "confidence": "high"},
                {"action": "add_edge", "target_id": None, "payload": {"id": "e_hardwood_chips_blend_feed", "from_node": "n_hardwood_chips", "to_node": "n_blend_feed", "type": "flow", "condition": "", "properties": {"export_flow_type": "material"}, "flows": [{"id": "f_hardwood_chips", "name": "hardwood chips", "kind": "parts", "quantity": "", "unit": "sT/hr", "properties": {"material": "hardwood chips", "flowType": "material"}}]}, "reason": "Edges preserve topology and material-flow metadata for future JSON export.", "confidence": "high"},
                {"action": "add_constraint", "target_id": None, "payload": {"id": "c_blend_feed_balance", "type": "flow_balance", "fields": {"target": "n_blend_feed"}, "expression": "For each period, Blend feed output Throughput_sTPerHr should equal the sum of named input purchase or consumption rates adjusted by Yield when present; all node.property references must exist before export."}, "reason": "Relationship constraints over node.property references are the portable MILP abstraction.", "confidence": "medium"},
                {"action": "add_constraint", "target_id": None, "payload": {"id": "c_blend_feed_capacity", "type": "capability_limit", "fields": {"target": "n_blend_feed"}, "expression": "For each period, Blend feed Throughput_sTPerHr must be less than or equal to RatedCapacity_sTPerHr, optionally adjusted by uptime and utilization if those properties are added."}, "reason": "Capacity constraints transfer across many process domains.", "confidence": "medium"},
                {"action": "add_constraint", "target_id": None, "payload": {"id": "c_profit_objective_hint", "type": "policy_rule", "fields": {"target": "n_finished_product"}, "expression": "Structured MILP objective should maximize finished product Sales_sTPerHr revenue minus supply Purchases_sTPerHr costs; only reference node.property names that exist in the graph."}, "reason": "Objective guidance should be expressed as valid node.property terms for the exporter.", "confidence": "medium"},
                {"action": "add_assumption", "target_id": None, "payload": {"id": "a_time_config", "text": "User specified monthly periods using a 730 hour periodLength; carry this as timeConfig guidance for rate-to-quantity conversion in structured-MILP export."}, "reason": "timeConfig.periodLength is load-bearing for rate-to-quantity conversion.", "confidence": "high"}
            ],
            "questions": ["How many periods should the scenario expose, and are contracts selected later outside the graph?"],
            "warnings": [],
            "handoff_readiness": {"structure_complete": False, "missing_values": ["scenario periods", "selected contracts"], "missing_constraints": [], "open_questions": ["How many periods should the scenario expose, and are contracts selected later outside the graph?"]}
        }
    },
    {
        "domain": "manufacturing_flow",
        "user_message": "Customer order triggers MRP, material is cut on CNC, quality checks pass parts to assembly or fail parts to rework, then finished units ship.",
        "assistant_response": {
            "summary": "Compiled a make-to-order manufacturing flow with material, data, decision, and rework paths.",
            "mutations": [
                {"action": "add_node", "target_id": None, "payload": {"id": "n_customer_order", "name": "Customer order", "type": "source", "inputs": [], "outputs": ["order"], "attributes": {}}, "reason": "The order starts the manufacturing flow.", "confidence": "high"},
                {"action": "add_node", "target_id": None, "payload": {"id": "n_quality_check", "name": "Quality check", "type": "decision", "inputs": ["cut parts"], "outputs": ["passed parts", "failed parts"], "attributes": {}}, "reason": "Quality check routes pass/fail branches.", "confidence": "high"},
                {"action": "add_edge", "target_id": None, "payload": {"id": "e_qc_rework", "from_node": "n_quality_check", "to_node": "n_rework", "type": "flow", "condition": "if fail", "flows": [{"id": "f_failed_parts", "name": "failed parts", "kind": "parts", "quantity": "", "unit": "", "properties": {}}]}, "reason": "Failed parts move to rework.", "confidence": "high"},
                {"action": "add_constraint", "target_id": None, "payload": {"id": "c_qc_routing", "type": "routing_rule", "fields": {"target": "n_quality_check"}, "expression": "Quality check routes passed parts to assembly and failed parts to rework."}, "reason": "Pass/fail routing should be explicit for handoff.", "confidence": "medium"},
            ],
            "questions": [],
            "warnings": [],
            "handoff_readiness": {"structure_complete": True, "missing_values": [], "missing_constraints": [], "open_questions": []},
        },
    },
]


def build_compiler_prompt() -> str:
    return (
        PROCESS_GRAPH_COMPILER_BASE_PROMPT
        + "\nAllowed mutation actions: "
        + ", ".join(sorted(MUTATION_ACTIONS))
        + "\nAllowed node types: source, sink, task, decision, resource"
        + "\nAllowed edge types: flow, dependency, trigger, feedback, allocation, custom"
        + "\nAllowed flow kinds: parts, cash, energy, information, data, work, approval, custom"
        + "\nAllowed constraint types: flow_balance, capability_limit, timing, routing_rule, policy_rule"
        + "\n\nFew-shot examples:\n"
        + json.dumps(PROCESS_GRAPH_COMPILER_EXAMPLES, indent=2)
    )


def graph_context_for_prompt(graph: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": graph.get("id"),
        "name": graph.get("name"),
        "modeling_style": graph.get("modeling_style"),
        "nodes": graph.get("nodes", []),
        "edges": graph.get("edges", []),
        "constraints": graph.get("constraints", []),
        "assumptions": graph.get("assumptions", []),
        "open_questions": graph.get("open_questions", []),
        "ontology": graph.get("ontology", {}),
    }


def build_llm_user_payload(graph: dict[str, Any], user_message: str, chat_messages: list[dict[str, Any]]) -> str:
    payload = {
        "user_message": user_message,
        "current_graph": graph_context_for_prompt(graph),
        "recent_chat_messages": chat_messages[-12:],
        "response_contract": ASSIST_RESPONSE_SCHEMA,
    }
    return json.dumps(payload, indent=2)


def extract_response_text(response: Any) -> str:
    output_text = getattr(response, "output_text", "")
    if output_text:
        return str(output_text)
    if isinstance(response, dict):
        if response.get("output_text"):
            return str(response["output_text"])
        outputs = response.get("output") or []
    else:
        outputs = getattr(response, "output", []) or []
    chunks: list[str] = []
    for item in outputs:
        content = item.get("content", []) if isinstance(item, dict) else getattr(item, "content", []) or []
        for part in content:
            if isinstance(part, dict):
                text = part.get("text") or part.get("content")
            else:
                text = getattr(part, "text", None) or getattr(part, "content", None)
            if text:
                chunks.append(str(text))
    return "".join(chunks)


def normalize_llm_assist_response(raw: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("LLM assist response must be a JSON object")
    normalized_mutations: list[dict[str, Any]] = []
    for item in raw.get("mutations") or []:
        candidate = {"target_id": None, "payload": {}, "reason": "", "confidence": "medium", **(item or {})}
        normalized_mutations.append(Mutation(**candidate).model_dump())
    questions = [str(question) for question in (raw.get("questions") or []) if str(question).strip()]
    warnings = [str(warning) for warning in (raw.get("warnings") or []) if str(warning).strip()]
    result = compiler_response(
        str(raw.get("summary") or "Compiled user instruction into graph mutations"),
        normalized_mutations,
        questions,
        warnings=warnings,
        compiler={
            "mode": "llm",
            "prompt_version": COMPILER_PROMPT_VERSION,
            "model": llm_model_name(),
        },
    )
    if isinstance(raw.get("handoff_readiness"), dict):
        result["handoff_readiness"] = {**result["handoff_readiness"], **raw["handoff_readiness"]}
    return result


def call_openai_assist(graph: dict[str, Any], user_message: str, chat_messages: list[dict[str, Any]]) -> dict[str, Any]:
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("Install the optional openai package to enable LLM assist") from exc

    client = OpenAI()
    response = client.responses.create(
        model=llm_model_name(),
        instructions=build_compiler_prompt(),
        input=[{"role": "user", "content": build_llm_user_payload(graph, user_message, chat_messages)}],
        text={
            "format": {
                "type": "json_schema",
                "name": "process_graph_assist_response",
                "description": "Graph mutation plan returned by the process graph compiler.",
                "schema": ASSIST_RESPONSE_SCHEMA,
                "strict": False,
            }
        },
    )
    output_text = extract_response_text(response)
    if not output_text:
        raise ValueError("LLM assist returned no text")
    return normalize_llm_assist_response(json.loads(output_text))


def compile_assist_message_with_llm(
    graph: dict[str, Any],
    user_message: str,
    chat_messages: list[dict[str, Any]],
) -> dict[str, Any]:
    if LLM_ASSIST_CLIENT is not None:
        return normalize_llm_assist_response(LLM_ASSIST_CLIENT(graph, user_message, chat_messages))
    return call_openai_assist(graph, user_message, chat_messages)


def deterministic_fallback_response(
    graph: dict[str, Any],
    user_message: str,
    warning: str | None = None,
    llm_requested: bool = False,
) -> dict[str, Any]:
    response = compile_assist_message(graph, user_message)
    response["compiler"] = {
        "mode": "deterministic",
        "prompt_version": COMPILER_PROMPT_VERSION,
        "llm_requested": llm_requested,
    }
    if warning:
        response.setdefault("warnings", []).append(warning)
    return response


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
def session(identity: IdentityContext = Depends(resolve_identity_context)) -> dict[str, Any]:
    data = identity.model_dump()
    data["llm_assist_available"] = is_llm_assist_enabled()
    data["llm_model"] = llm_model_name() if is_llm_assist_enabled() else ""
    return data


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
    graph = deepcopy(request.graph) if isinstance(request.graph, dict) else get_graph_or_create(store, tenant_id, request.graph_id)
    if request.use_llm:
        if not is_llm_assist_enabled():
            return deterministic_fallback_response(
                graph,
                request.user_message,
                "LLM assist is disabled on the server; used deterministic fallback.",
                llm_requested=True,
            )
        try:
            return compile_assist_message_with_llm(graph, request.user_message, request.chat_messages)
        except Exception as exc:
            return deterministic_fallback_response(
                graph,
                request.user_message,
                f"LLM assist failed ({type(exc).__name__}); used deterministic fallback.",
                llm_requested=True,
            )
    return deterministic_fallback_response(graph, request.user_message)


@app.get("/graph/{graph_id}/export/md")
def export_markdown(graph_id: str, tenant_id: str = Depends(resolve_tenant_id)) -> str:
    graph = get_graph_or_create(store, tenant_id, graph_id)
    return markdown_export(graph)


# Mounted last so API routes take precedence over the static frontend.
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
