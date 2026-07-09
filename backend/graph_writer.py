from __future__ import annotations

import json
import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

PROPERTY_GRAPH_SYNC_SCHEMA_VERSION = "property_graph_sync_v1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def gremlin_host_from_uri(uri: str) -> str:
    parsed = urlparse(uri if "://" in uri else f"https://{uri}")
    host = parsed.netloc or parsed.path
    host = host.split(":", 1)[0]
    if host.endswith(".documents.azure.com"):
        host = host.replace(".documents.azure.com", ".gremlin.cosmos.azure.com")
    return host


def gremlin_endpoint_from_env() -> str:
    explicit = os.environ.get("COSMOS_GREMLIN_ENDPOINT", "").strip()
    if explicit:
        return explicit
    host = os.environ.get("COSMOS_GREMLIN_HOST", "").strip()
    if not host:
        cosmos_uri = os.environ.get("COSMOS_URI", "").strip()
        if cosmos_uri:
            host = gremlin_host_from_uri(cosmos_uri)
    if not host:
        raise RuntimeError("Set COSMOS_GREMLIN_ENDPOINT, COSMOS_GREMLIN_HOST, or COSMOS_URI for Gremlin sync")
    if host.startswith("ws://") or host.startswith("wss://"):
        return host.rstrip("/") + "/"
    return f"wss://{host}:443/"


def sanitize_binding_key(value: str, fallback: str) -> str:
    clean = "".join(char if char.isalnum() or char == "_" else "_" for char in str(value))
    clean = clean.strip("_") or fallback
    if clean[0].isdigit():
        clean = f"_{clean}"
    return clean


def vertex_upsert_statement() -> str:
    return (
        "g.V([tenant_id, vertex_id]).fold()"
        ".coalesce(unfold(), addV(vertex_label).property('id', vertex_id).property('tenant_id', tenant_id))"
        ".property('graph_id', graph_id)"
        ".property('source_id', source_id)"
        ".property('record_kind', record_kind)"
        ".property('payload_json', payload_json)"
    )


def edge_upsert_statement(edge_label: str) -> str:
    safe_label = edge_label.replace("\\", "\\\\").replace("'", "\\'")
    return (
        "g.V([tenant_id, out_v]).outE('" + safe_label + "').has('id', edge_id).fold()"
        ".coalesce(unfold(), g.V([tenant_id, out_v]).addE('" + safe_label + "')"
        ".to(g.V([tenant_id, in_v])).property('id', edge_id))"
        ".property('tenant_id', tenant_id)"
        ".property('graph_id', graph_id)"
        ".property('source_id', source_id)"
        ".property('record_kind', record_kind)"
        ".property('payload_json', payload_json)"
    )


def vertex_bindings(vertex: dict[str, Any]) -> dict[str, Any]:
    return {
        "tenant_id": vertex.get("tenant_id", ""),
        "vertex_id": vertex.get("id", ""),
        "vertex_label": vertex.get("label", "vertex"),
        "graph_id": vertex.get("graph_id", ""),
        "source_id": vertex.get("source_id", ""),
        "record_kind": vertex.get("record_kind", ""),
        "payload_json": compact_json(vertex.get("properties", {})),
    }


def edge_bindings(edge: dict[str, Any]) -> dict[str, Any]:
    return {
        "tenant_id": edge.get("tenant_id", ""),
        "edge_id": edge.get("id", ""),
        "graph_id": edge.get("graph_id", ""),
        "source_id": edge.get("source_id", ""),
        "record_kind": edge.get("record_kind", ""),
        "out_v": edge.get("out_v", ""),
        "in_v": edge.get("in_v", ""),
        "payload_json": compact_json(edge.get("properties", {})),
    }


def sync_summary(projection: dict[str, Any], *, writer: str, dry_run: bool = False, details: dict[str, Any] | None = None) -> dict[str, Any]:
    vertices = projection.get("vertices") if isinstance(projection.get("vertices"), list) else []
    edges = projection.get("edges") if isinstance(projection.get("edges"), list) else []
    return {
        "schema_version": PROPERTY_GRAPH_SYNC_SCHEMA_VERSION,
        "writer": writer,
        "dry_run": dry_run,
        "tenant_id": projection.get("tenant_id", ""),
        "graph_id": projection.get("graph_id", ""),
        "synced_at": now(),
        "vertices": len(vertices),
        "edges": len(edges),
        "details": details or {},
    }


class PropertyGraphWriter(Protocol):
    def sync_property_graph(self, projection: dict[str, Any], *, dry_run: bool = False) -> dict[str, Any]: ...


class JsonFilePropertyGraphWriter:
    """Local writer that stores the projected graph as a sync artifact.

    This is intentionally not a graph database. It provides deterministic local
    behavior for tests and lets the API exercise the same sync boundary without
    requiring a live Cosmos DB for Apache Gremlin account.
    """

    def __init__(self, path: Path) -> None:
        self.path = path

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"schema_version": PROPERTY_GRAPH_SYNC_SCHEMA_VERSION, "tenants": {}}
        with self.path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        data.setdefault("schema_version", PROPERTY_GRAPH_SYNC_SCHEMA_VERSION)
        data.setdefault("tenants", {})
        return data

    def _save(self, store: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(store, handle, indent=2)

    def sync_property_graph(self, projection: dict[str, Any], *, dry_run: bool = False) -> dict[str, Any]:
        result = sync_summary(projection, writer="json_file", dry_run=dry_run)
        if dry_run:
            return result
        store = self._load()
        tenant_id = str(projection.get("tenant_id") or "default")
        graph_id = str(projection.get("graph_id") or "graph")
        tenant = store.setdefault("tenants", {}).setdefault(tenant_id, {"graphs": {}})
        graph = tenant.setdefault("graphs", {}).setdefault(graph_id, {"syncs": []})
        graph["latest_projection"] = deepcopy(projection)
        graph["latest_sync"] = result
        graph.setdefault("syncs", []).append(result)
        graph["syncs"] = graph["syncs"][-20:]
        self._save(store)
        return result


class GremlinPropertyGraphWriter:
    """Cosmos DB for Apache Gremlin writer.

    Configuration follows the Microsoft Gremlin Python quickstart:
    - endpoint: COSMOS_GREMLIN_ENDPOINT, or derived from COSMOS_GREMLIN_HOST/COSMOS_URI
    - username: /dbs/{COSMOS_GREMLIN_DATABASE or COSMOS_DATABASE}/colls/{COSMOS_GREMLIN_GRAPH}
    - password: COSMOS_GREMLIN_KEY or COSMOS_KEY

    Vertices use tenant_id as the Cosmos graph partition key. Edge writes use
    partition-qualified vertex lookups: g.V([tenant_id, vertex_id]).
    """

    def __init__(self) -> None:
        self.endpoint = gremlin_endpoint_from_env()
        self.database = os.environ.get("COSMOS_GREMLIN_DATABASE") or os.environ.get("COSMOS_DATABASE", "process_graph_builder")
        self.graph = os.environ.get("COSMOS_GREMLIN_GRAPH", "process_graph")
        self.key = os.environ.get("COSMOS_GREMLIN_KEY") or os.environ.get("COSMOS_KEY")
        self._client = None

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not self.key:
            raise RuntimeError("Set COSMOS_GREMLIN_KEY or COSMOS_KEY for Gremlin sync")
        try:
            from gremlin_python.driver import client, serializer
        except ImportError as exc:
            raise RuntimeError("Install gremlinpython to enable Cosmos Gremlin sync") from exc
        self._client = client.Client(
            url=self.endpoint,
            traversal_source="g",
            username=f"/dbs/{self.database}/colls/{self.graph}",
            password=self.key,
            message_serializer=serializer.GraphSONSerializersV2d0(),
        )
        return self._client

    def sync_property_graph(self, projection: dict[str, Any], *, dry_run: bool = False) -> dict[str, Any]:
        vertices = projection.get("vertices") if isinstance(projection.get("vertices"), list) else []
        edges = projection.get("edges") if isinstance(projection.get("edges"), list) else []
        if dry_run:
            return sync_summary(
                projection,
                writer="gremlin",
                dry_run=True,
                details={"endpoint": self.endpoint, "database": self.database, "graph": self.graph},
            )
        graph_client = self._get_client()
        vertex_statement = vertex_upsert_statement()
        for item in vertices:
            graph_client.submit(message=vertex_statement, bindings=vertex_bindings(item)).all().result()
        for item in edges:
            graph_client.submit(message=edge_upsert_statement(str(item.get("label") or "relationship")), bindings=edge_bindings(item)).all().result()
        return sync_summary(
            projection,
            writer="gremlin",
            dry_run=False,
            details={"endpoint": self.endpoint, "database": self.database, "graph": self.graph},
        )


def select_property_graph_writer_kind() -> str:
    return "gremlin" if os.environ.get("COSMOS_GREMLIN_ENDPOINT") or os.environ.get("COSMOS_GREMLIN_HOST") else "json"


def create_property_graph_writer(path: Path) -> PropertyGraphWriter:
    if select_property_graph_writer_kind() == "gremlin":
        return GremlinPropertyGraphWriter()
    return JsonFilePropertyGraphWriter(path)