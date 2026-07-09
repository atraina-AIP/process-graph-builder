"""Test configuration: isolate the store and make `backend` importable.

Runs before any test module imports the app, so the env var is set before
`backend.main` computes STORE_PATH at import time.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TEST_DATA_DIR = ROOT / ".test-data"
TEST_DATA_DIR.mkdir(exist_ok=True)
os.environ["PROCESS_GRAPH_STORE"] = str(TEST_DATA_DIR / "graphs-test.json")
os.environ["PROCESS_GRAPH_ARTIFACT_STORE"] = str(TEST_DATA_DIR / "artifacts-test.json")
os.environ["PROCESS_GRAPH_PROPERTY_GRAPH_SYNC_STORE"] = str(TEST_DATA_DIR / "property-graph-sync-test.json")
os.environ.pop("COSMOS_GREMLIN_ENDPOINT", None)
os.environ.pop("COSMOS_GREMLIN_HOST", None)

import pytest  # noqa: E402

from backend import main as main_module  # noqa: E402


@pytest.fixture
def tmp_path(request):
    """Repo-local tmp_path replacement for delete-restricted environments."""
    safe_name = "".join(
        char if char.isalnum() or char in "-_" else "_" for char in request.node.name
    )
    path = TEST_DATA_DIR / safe_name
    path.mkdir(parents=True, exist_ok=True)
    (path / "graphs.json").write_text('{"tenants": {}}', encoding="utf-8")
    return path


@pytest.fixture(autouse=True)
def clean_store():
    """Start every test from an empty store."""
    store = Path(main_module.STORE_PATH)
    artifact_store = Path(main_module.ARTIFACT_STORE_PATH)
    property_graph_sync_store = Path(main_module.PROPERTY_GRAPH_SYNC_PATH)
    store.parent.mkdir(parents=True, exist_ok=True)
    artifact_store.parent.mkdir(parents=True, exist_ok=True)
    property_graph_sync_store.parent.mkdir(parents=True, exist_ok=True)
    store.write_text('{"tenants": {}}', encoding="utf-8")
    artifact_store.write_text('{"schema_version": "artifact_ledger_v1", "tenants": {}}', encoding="utf-8")
    property_graph_sync_store.write_text('{"schema_version": "property_graph_sync_v1", "tenants": {}}', encoding="utf-8")
    yield
    store.write_text('{"tenants": {}}', encoding="utf-8")
    artifact_store.write_text('{"schema_version": "artifact_ledger_v1", "tenants": {}}', encoding="utf-8")
    property_graph_sync_store.write_text('{"schema_version": "property_graph_sync_v1", "tenants": {}}', encoding="utf-8")
