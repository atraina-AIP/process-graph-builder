"""Tests for the storage abstraction (backend selection + JSON file store).

The Cosmos backend requires a live account/emulator and is not exercised here;
these tests cover the selection logic and the local JSON file implementation,
which is the dev default. All store methods are tenant-scoped.
"""
from __future__ import annotations

from pathlib import Path

from backend.main import JsonFileStore, create_store, default_graph, select_store_kind


def test_select_store_kind_defaults_to_json(monkeypatch):
    monkeypatch.delenv("COSMOS_URI", raising=False)
    assert select_store_kind() == "json"


def test_select_store_kind_cosmos_when_uri_set(monkeypatch):
    monkeypatch.setenv("COSMOS_URI", "https://example.documents.azure.com:443/")
    assert select_store_kind() == "cosmos"


def test_create_store_returns_json_store_by_default(monkeypatch):
    monkeypatch.delenv("COSMOS_URI", raising=False)
    assert isinstance(create_store(), JsonFileStore)


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
