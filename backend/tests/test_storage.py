"""Tests for the storage abstraction (backend selection + JSON file store).

The Cosmos backend requires a live account/emulator and is not exercised here;
these tests cover the selection logic and the local JSON file implementation,
which is the dev default. All store methods are tenant-scoped.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.artifacts import JsonFileArtifactStore
from backend.graph_writer import JsonFilePropertyGraphWriter, gremlin_host_from_uri, select_property_graph_writer_kind
from backend.main import JsonFileStore, _sql_table_reference, create_store, default_graph, get_sql_connection_string, select_store_kind
from backend.property_graph import graph_to_property_graph, prepare_graph_for_storage


def test_select_store_kind_defaults_to_json(monkeypatch):
    monkeypatch.delenv("COSMOS_URI", raising=False)
    assert select_store_kind() == "json"


def test_select_store_kind_cosmos_when_uri_set(monkeypatch):
    monkeypatch.setenv("COSMOS_URI", "https://example.documents.azure.com:443/")
    assert select_store_kind() == "cosmos"



def test_select_store_kind_azure_sql_when_connection_string_set(monkeypatch):
    monkeypatch.delenv("PROCESS_GRAPH_STORE_KIND", raising=False)
    monkeypatch.delenv("COSMOS_URI", raising=False)
    monkeypatch.setenv("AZURE_SQL_CONNECTION_STRING", "Driver={ODBC Driver 18 for SQL Server};")
    assert select_store_kind() == "azure_sql"


def test_select_store_kind_explicit_value_wins(monkeypatch):
    monkeypatch.setenv("PROCESS_GRAPH_STORE_KIND", "azure-sql")
    monkeypatch.setenv("COSMOS_URI", "https://example.documents.azure.com:443/")
    assert select_store_kind() == "azure_sql"


def test_select_store_kind_rejects_unknown_explicit_value(monkeypatch):
    monkeypatch.setenv("PROCESS_GRAPH_STORE_KIND", "bogus")
    with pytest.raises(ValueError):
        select_store_kind()


def test_get_sql_connection_string_supports_fallback_env_name(monkeypatch):
    monkeypatch.delenv("AZURE_SQL_CONNECTION_STRING", raising=False)
    monkeypatch.setenv("SQL_CONNECTION_STRING", "Driver={ODBC Driver 18 for SQL Server};")
    assert get_sql_connection_string().startswith("Driver=")


def test_create_store_returns_json_store_by_default(monkeypatch):
    monkeypatch.delenv("COSMOS_URI", raising=False)
    monkeypatch.delenv("AZURE_SQL_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("SQL_CONNECTION_STRING", raising=False)
    assert isinstance(create_store(), JsonFileStore)


def test_create_store_returns_sql_store_when_requested(monkeypatch):
    class FakeSqlStore:
        pass

    monkeypatch.setenv("PROCESS_GRAPH_STORE_KIND", "azure_sql")
    monkeypatch.setenv("AZURE_SQL_CONNECTION_STRING", "Driver={ODBC Driver 18 for SQL Server};")
    monkeypatch.setattr("backend.main.AzureSqlGraphStore", FakeSqlStore)
    assert isinstance(create_store(), FakeSqlStore)


def test_sql_table_reference_quotes_schema_and_table():
    reference = _sql_table_reference("audit.process_graphs")
    assert reference["object"] == "audit.process_graphs"
    assert reference["quoted"] == "[audit].[process_graphs]"


def test_sql_table_reference_rejects_unsafe_names():
    with pytest.raises(ValueError):
        _sql_table_reference("dbo.process_graphs;DROP_TABLE")

def test_json_file_store_round_trip(tmp_path: Path):
    store = JsonFileStore(tmp_path / "graphs.json")
    assert store.get_graph("default", "missing") is None

    graph = default_graph("g1", "default")
    store.upsert_graph("default", graph)
    loaded = store.get_graph("default", "g1")
    assert loaded is not None
    assert loaded["id"] == "g1"
    assert loaded["tenant_id"] == "default"

    graph["name"] = "Renamed"
    store.upsert_graph("default", graph)
    assert store.get_graph("default", "g1")["name"] == "Renamed"


def test_json_file_store_envelope_round_trip_and_summary(tmp_path: Path):
    store = JsonFileStore(tmp_path / "graphs.json")
    graph = default_graph("g-env", "wrong_tenant")
    graph["name"] = "Envelope Graph"
    graph["nodes"] = [{"id": "n1", "name": "Shape", "type": "task"}]
    envelope = {
        "graph": graph,
        "layout": {"nodes": {"n1": {"x": 10, "y": 20}}},
        "mutation_log": [{"action": "add_node", "target_id": "n1"}],
    }

    store.upsert_envelope("tenant_a", "g-env", envelope)

    loaded_graph = store.get_graph("tenant_a", "g-env")
    assert loaded_graph["tenant_id"] == "tenant_a"
    assert loaded_graph["name"] == "Envelope Graph"
    assert "frontend_envelope" not in loaded_graph
    assert "updated_at" not in loaded_graph

    loaded_envelope = store.get_envelope("tenant_a", "g-env")
    assert loaded_envelope["graph"]["tenant_id"] == "tenant_a"
    assert loaded_envelope["layout"]["nodes"]["n1"] == {"x": 10, "y": 20}
    assert loaded_envelope["updated_at"]

    summaries = store.list_graphs("tenant_a")
    assert summaries == [
        {
            "id": "g-env",
            "name": "Envelope Graph",
            "version": "0.1.0",
            "tenant_id": "tenant_a",
            "updated_at": loaded_envelope["updated_at"],
            "node_count": 1,
            "edge_count": 0,
        }
    ]
    assert store.list_graphs("tenant_b") == []

def test_json_file_store_stamps_tenant_id_on_upsert(tmp_path: Path):
    """The store stamps the partitioning tenant_id even if the graph dict lacks it."""
    store = JsonFileStore(tmp_path / "graphs.json")
    graph = default_graph("g1")
    graph.pop("tenant_id", None)
    store.upsert_graph("acme", graph)
    loaded = store.get_graph("acme", "g1")
    assert loaded["tenant_id"] == "acme"


def test_json_file_store_missing_tenant_returns_none(tmp_path: Path):
    store = JsonFileStore(tmp_path / "graphs.json")
    store.upsert_graph("tenant_a", default_graph("g1", "tenant_a"))
    # A tenant that has never written anything sees nothing.
    assert store.get_graph("tenant_b", "g1") is None


def test_json_file_store_cross_tenant_isolation(tmp_path: Path):
    """A graph saved under tenant A is invisible to tenant B (same graph_id)."""
    store = JsonFileStore(tmp_path / "graphs.json")
    graph_a = default_graph("shared-id", "tenant_a")
    graph_a["name"] = "A's graph"
    store.upsert_graph("tenant_a", graph_a)

    assert store.get_graph("tenant_b", "shared-id") is None

    # Tenant B writes its own graph under the same id; A's copy is untouched.
    graph_b = default_graph("shared-id", "tenant_b")
    graph_b["name"] = "B's graph"
    store.upsert_graph("tenant_b", graph_b)

    assert store.get_graph("tenant_a", "shared-id")["name"] == "A's graph"
    assert store.get_graph("tenant_b", "shared-id")["name"] == "B's graph"


def test_json_file_store_appends_mutation_batches_per_tenant(tmp_path: Path):
    store = JsonFileStore(tmp_path / "graphs.json")
    store.append_mutation_batch("tenant_a", {"graph_id": "g1", "mutations": []})
    store.append_mutation_batch("tenant_a", {"graph_id": "g1", "mutations": []})
    store.append_mutation_batch("tenant_b", {"graph_id": "g1", "mutations": []})
    raw = store._load()
    assert len(raw["tenants"]["tenant_a"]["mutation_batches"]) == 2
    assert len(raw["tenants"]["tenant_b"]["mutation_batches"]) == 1
    # Batches carry the tenant_id stamp.
    assert raw["tenants"]["tenant_a"]["mutation_batches"][0]["tenant_id"] == "tenant_a"


def test_prepare_graph_for_storage_derives_artifact_refs_and_detaches_content():
    graph = default_graph("g-artifacts", "tenant_a")
    graph["source_artifacts"] = [
        {
            "id": "src_plant",
            "type": "plant_json",
            "format": "plant_json",
            "name": "Plant source",
            "source_file_name": "plant.json",
            "summary": {"node_count": 1},
            "content": {"nodes": [{"id": "n1"}], "edges": []},
        }
    ]

    prepared = prepare_graph_for_storage(graph, detach_artifact_content=True)

    assert prepared["artifact_refs"][0]["id"] == "src_plant"
    assert prepared["artifact_refs"][0]["source_format"] == "plant_json"
    assert prepared["artifact_refs"][0]["bytes"]
    assert "content" not in prepared["source_artifacts"][0]
    assert prepared["source_artifacts"][0]["content_ref"] == "src_plant"


def test_graph_to_property_graph_projects_nodes_edges_constraints_and_artifacts():
    graph = default_graph("g-property", "tenant_a")
    graph["nodes"] = [
        {"id": "n1", "name": "Source", "type": "source", "inputs": [], "outputs": ["ore"], "attributes": {}},
        {"id": "n2", "name": "Mill", "type": "task", "inputs": ["ore"], "outputs": ["concentrate"], "attributes": {}},
    ]
    graph["edges"] = [
        {"id": "e1", "from_node": "n1", "to_node": "n2", "type": "flow", "condition": "", "flows": []}
    ]
    graph["constraints"] = [
        {"id": "c1", "type": "flow_balance", "expression": "Mill balances ore", "fields": {"target": "n2"}}
    ]
    graph["artifact_refs"] = [{"id": "src_plant", "artifact_type": "plant_json", "source_format": "plant_json"}]
    graph["optimization_projection"] = {
        "target_format": "plant_json",
        "constraints": [{"id": "lp1", "process_constraint_id": "c1", "status": "imported"}],
    }

    projected = graph_to_property_graph(graph, tenant_id="tenant_a")

    assert projected["schema_version"] == "property_graph_v1"
    assert projected["counts"]["process_nodes"] == 2
    assert projected["counts"]["process_edges"] == 1
    assert projected["counts"]["constraints"] == 1
    assert projected["counts"]["artifact_refs"] == 1
    assert any(vertex["label"] == "optimization_constraint" for vertex in projected["vertices"])
    assert any(edge["label"] == "projects_to" for edge in projected["edges"])


def test_json_file_artifact_store_versions_and_refs(tmp_path: Path):
    store = JsonFileArtifactStore(tmp_path / "artifacts.json")
    first = store.save_artifact(
        "tenant_a",
        "g1",
        {
            "artifact_id": "plant_src",
            "artifact_type": "plant_json",
            "source_format": "plant_json",
            "name": "Plant source",
            "source_file_name": "plant.json",
            "content": {"nodes": [{"id": "n1"}], "edges": []},
            "summary": {"node_count": 1},
        },
    )
    second = store.save_artifact(
        "tenant_a",
        "g1",
        {
            "artifact_id": "plant_src",
            "artifact_type": "plant_json",
            "source_format": "plant_json",
            "name": "Plant source",
            "source_file_name": "plant.json",
            "content": {"nodes": [{"id": "n1"}, {"id": "n2"}], "edges": []},
            "summary": {"node_count": 2},
        },
    )

    assert first["artifact_ref"]["artifact_id"] == "plant_src"
    assert first["artifact_ref"]["version_id"] != second["artifact_ref"]["version_id"]
    refs = store.list_artifacts("tenant_a", "g1")
    assert refs == [second["artifact_ref"]]
    loaded = store.get_artifact("tenant_a", "g1", "plant_src")
    assert loaded["content"]["nodes"][1]["id"] == "n2"
    assert loaded["artifact_ref"]["hash"] == second["artifact_ref"]["hash"]
    assert store.get_artifact("tenant_b", "g1", "plant_src") is None


def test_select_property_graph_writer_kind_defaults_to_json(monkeypatch):
    monkeypatch.delenv("COSMOS_GREMLIN_ENDPOINT", raising=False)
    monkeypatch.delenv("COSMOS_GREMLIN_HOST", raising=False)
    assert select_property_graph_writer_kind() == "json"


def test_select_property_graph_writer_kind_gremlin_when_endpoint_set(monkeypatch):
    monkeypatch.setenv("COSMOS_GREMLIN_ENDPOINT", "wss://example.gremlin.cosmos.azure.com:443/")
    assert select_property_graph_writer_kind() == "gremlin"


def test_gremlin_host_from_cosmos_uri_maps_documents_endpoint():
    host = gremlin_host_from_uri("https://example.documents.azure.com:443/")
    assert host == "example.gremlin.cosmos.azure.com"


def test_json_file_property_graph_writer_stores_latest_projection(tmp_path: Path):
    graph = default_graph("g-sync", "tenant_a")
    graph["nodes"] = [
        {"id": "n1", "name": "Source", "type": "source", "inputs": [], "outputs": ["ore"], "attributes": {}},
        {"id": "n2", "name": "Mill", "type": "task", "inputs": ["ore"], "outputs": ["concentrate"], "attributes": {}},
    ]
    graph["edges"] = [
        {"id": "e1", "from_node": "n1", "to_node": "n2", "type": "flow", "condition": "", "flows": []}
    ]
    projection = graph_to_property_graph(graph, tenant_id="tenant_a")
    writer = JsonFilePropertyGraphWriter(tmp_path / "property-sync.json")

    result = writer.sync_property_graph(projection)

    assert result["writer"] == "json_file"
    assert result["vertices"] == projection["counts"]["vertices"]
    raw = json.loads((tmp_path / "property-sync.json").read_text(encoding="utf-8"))
    saved = raw["tenants"]["tenant_a"]["graphs"]["g-sync"]
    assert saved["latest_sync"]["edges"] == projection["counts"]["edges"]
    assert saved["latest_projection"]["counts"]["process_nodes"] == 2
