"""Test configuration: isolate the store and make `backend` importable.

Runs before any test module imports the app, so the env var is set before
`backend.main` computes STORE_PATH at import time.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["PROCESS_GRAPH_STORE"] = str(Path(tempfile.mkdtemp()) / "graphs.json")

import pytest  # noqa: E402

from backend import main as main_module  # noqa: E402


@pytest.fixture(autouse=True)
def clean_store():
    """Start every test from an empty store."""
    store = Path(main_module.STORE_PATH)
    if store.exists():
        store.unlink()
    yield
    if store.exists():
        store.unlink()
