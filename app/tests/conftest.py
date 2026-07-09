"""Test configuration: isolate the store and make `main` importable.

Runs before any test module imports the app, so the env var is set before
`main` computes STORE_PATH at import time.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TEST_DATA_DIR = ROOT / ".test-data"
TEST_DATA_DIR.mkdir(exist_ok=True)
os.environ["PROCESS_GRAPH_STORE"] = str(TEST_DATA_DIR / "graphs-test.json")
for key in (
    "PROCESS_GRAPH_STORE_KIND",
    "COSMOS_URI",
    "AZURE_SQL_CONNECTION_STRING",
    "SQL_CONNECTION_STRING",
):
    os.environ.pop(key, None)

import pytest  # noqa: E402

import main as main_module  # noqa: E402


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
    store.parent.mkdir(parents=True, exist_ok=True)
    store.write_text('{"tenants": {}}', encoding="utf-8")
    yield
    store.write_text('{"tenants": {}}', encoding="utf-8")
