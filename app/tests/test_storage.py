"""Tests for the storage abstraction (backend selection + JSON file store).

The Cosmos backend requires a live account/emulator and is not exercised here;
these tests cover the selection logic and the local JSON file implementation,
which is the dev default. All store methods are tenant-scoped.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from main import (
    JsonFileStore,
    _sql_table_reference,
    create_store,
    default_graph,
    get_sql_connection_string,
    select_store_kind,
)


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
    monkeypatch.setattr("main.AzureSqlGraphStore", FakeSqlStore)
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
