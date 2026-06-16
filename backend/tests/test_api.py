"""Backend tests for the Process Graph Builder API.

Covers the mutation engine, the deterministic assist compiler, the markdown
export, and the HTTP endpoints (including Pydantic request validation).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import (
    apply_mutation,
    app,
    compile_assist_message,
    default_graph,
    markdown_export,
    resolve_tenant_id,
)

client = TestClient(app)


def _mutation(action, payload=None, target_id=None):
    return {
        "action": action,
        "target_id": target_id,
        "payload": payload or {},
        "reason": "test",
        "confidence": "high",
    }


# --- apply_mutation ---------------------------------------------------------


def test_add_node():
    graph = default_graph()
    apply_mutation(graph, _mutation("add_node", {"id": "n1", "name": "A", "type": "task"}))
    assert [node["id"] for node in graph["nodes"]] == ["n1"]


def test_update_node_upserts_without_duplicating():
    graph = default_graph()
    apply_mutation(graph, _mutation("add_node", {"id": "n1", "name": "A", "type": "task"}))
    apply_mutation(graph, _mutation("update_node", {"name": "B"}, target_id="n1"))
    assert len(graph["nodes"]) == 1
    assert graph["nodes"][0]["name"] == "B"


def test_delete_node_removes_connected_edges():
    graph = default_graph()
    apply_mutation(graph, _mutation("add_node", {"id": "n1"}))
    apply_mutation(graph, _mutation("add_node", {"id": "n2"}))
    apply_mutation(graph, _mutation("add_edge", {"id": "e1", "from_node": "n1", "to_node": "n2"}))
    apply_mutation(graph, _mutation("delete_node", target_id="n1"))
    assert [node["id"] for node in graph["nodes"]] == ["n2"]
    assert graph["edges"] == []


def test_add_and_delete_edge():
    graph = default_graph()
    apply_mutation(graph, _mutation("add_edge", {"id": "e1", "from_node": "a", "to_node": "b"}))
    assert len(graph["edges"]) == 1
    apply_mutation(graph, _mutation("delete_edge", target_id="e1"))
    assert graph["edges"] == []


def test_add_constraint_and_assumption_and_question():
    graph = default_graph()
    apply_mutation(graph, _mutation("add_constraint", {"id": "c1", "type": "timing", "expression": "x"}))
    apply_mutation(graph, _mutation("add_assumption", {"id": "a1", "text": "assume"}))
    apply_mutation(graph, _mutation("add_question", {"text": "what?"}))
    assert graph["constraints"][0]["id"] == "c1"
    assert graph["assumptions"][0]["text"] == "assume"
    assert graph["open_questions"] == ["what?"]


def test_unsupported_action_raises_400():
    graph = default_graph()
    with pytest.raises(HTTPException) as excinfo:
        apply_mutation(graph, _mutation("frobnicate"))
    assert excinfo.value.status_code == 400


# --- compile_assist_message -------------------------------------------------


def test_compile_multistep_instruction():
    graph = default_graph()
    response = compile_assist_message(
        graph, "Add source Customer request then Validate request then sink Closed"
    )
    actions = [mutation["action"] for mutation in response["mutations"]]
    assert "add_node" in actions
    assert "add_edge" in actions


def test_compile_empty_message_returns_question():
    graph = default_graph()
    response = compile_assist_message(graph, "")
    assert response["questions"]
    assert response["mutations"] == []


# --- markdown export --------------------------------------------------------


def test_markdown_export_includes_nodes_and_edges():
    graph = default_graph()
    graph["name"] = "Intake to Close"
    apply_mutation(graph, _mutation("add_node", {"id": "n1", "name": "A", "type": "task"}))
    apply_mutation(graph, _mutation("add_node", {"id": "n2", "name": "B", "type": "sink"}))
    apply_mutation(graph, _mutation("add_edge", {"id": "e1", "from_node": "n1", "to_node": "n2"}))
    markdown = markdown_export(graph)
    assert "Intake to Close" in markdown
    assert "## Nodes" in markdown
    assert "## Edges" in markdown
    assert "n1" in markdown and "n2" in markdown


# --- HTTP endpoints ---------------------------------------------------------


def test_healthz_endpoint():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_static_frontend_served():
    response = client.get("/")
    assert response.status_code == 200
    assert "Process Graph" in response.text


def test_get_graph_creates_default():
    response = client.get("/graph/g-get")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "g-get"
    assert body["nodes"] == []
    # Durable records are tenant-scoped; the default tenant is stamped.
    assert body["tenant_id"] == "default"


def test_mutate_endpoint_applies_and_returns_graph():
    payload = {
        "graph_id": "g-mutate",
        "mutations": [_mutation("add_node", {"id": "n1", "name": "A", "type": "task"})],
    }
    response = client.post("/graph/mutate", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["applied"] == 1
    assert any(node["id"] == "n1" for node in body["graph"]["nodes"])


def test_mutate_missing_graph_id_returns_422():
    response = client.post("/graph/mutate", json={"mutations": []})
    assert response.status_code == 422


def test_mutate_invalid_action_returns_422():
    payload = {"graph_id": "g-bad", "mutations": [_mutation("frobnicate")]}
    response = client.post("/graph/mutate", json=payload)
    assert response.status_code == 422


def test_assist_endpoint_round_trip():
    payload = {"graph_id": "g-assist", "user_message": "Add source Start then sink End"}
    response = client.post("/graph/assist", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert "mutations" in body
    assert "handoff_readiness" in body


def test_export_md_endpoint():
    client.post(
        "/graph/mutate",
        json={
            "graph_id": "g-export",
            "mutations": [_mutation("add_node", {"id": "n1", "name": "A", "type": "task"})],
        },
    )
    response = client.get("/graph/g-export/export/md")
    assert response.status_code == 200
    assert "Process Graph" in response.json()


# --- tenant scoping ---------------------------------------------------------


def test_resolve_tenant_id_defaults_to_default(monkeypatch):
    monkeypatch.delenv("PROCESS_GRAPH_DEFAULT_TENANT", raising=False)
    assert resolve_tenant_id(None) == "default"
    assert resolve_tenant_id("") == "default"
    assert resolve_tenant_id("   ") == "default"


def test_resolve_tenant_id_uses_header():
    assert resolve_tenant_id("acme") == "acme"
    assert resolve_tenant_id("  acme  ") == "acme"


def test_resolve_tenant_id_falls_back_to_env(monkeypatch):
    monkeypatch.setenv("PROCESS_GRAPH_DEFAULT_TENANT", "env_tenant")
    assert resolve_tenant_id(None) == "env_tenant"
    # An explicit header still wins over the env fallback.
    assert resolve_tenant_id("header_tenant") == "header_tenant"


def test_header_drives_tenant_on_get():
    response = client.get("/graph/g-hdr", headers={"X-Tenant-Id": "tenant_x"})
    assert response.status_code == 200
    assert response.json()["tenant_id"] == "tenant_x"


def test_default_tenant_when_no_header():
    response = client.get("/graph/g-nohdr")
    assert response.status_code == 200
    assert response.json()["tenant_id"] == "default"


def test_cross_tenant_isolation_over_http():
    """A graph saved under tenant A is invisible to tenant B; B gets a fresh
    default graph under the same graph_id instead of A's data."""
    graph_id = "g-shared"
    # Tenant A creates and mutates the graph.
    a_resp = client.post(
        "/graph/mutate",
        headers={"X-Tenant-Id": "tenant_a"},
        json={
            "graph_id": graph_id,
            "mutations": [_mutation("add_node", {"id": "n_a", "name": "A node", "type": "task"})],
        },
    )
    assert a_resp.status_code == 200
    assert any(node["id"] == "n_a" for node in a_resp.json()["graph"]["nodes"])

    # Tenant B reads the same graph_id and must NOT see tenant A's node.
    b_resp = client.get(f"/graph/{graph_id}", headers={"X-Tenant-Id": "tenant_b"})
    assert b_resp.status_code == 200
    b_body = b_resp.json()
    assert b_body["tenant_id"] == "tenant_b"
    assert b_body["nodes"] == []

    # Tenant A still sees its own data afterwards (B's read created its own graph).
    a_again = client.get(f"/graph/{graph_id}", headers={"X-Tenant-Id": "tenant_a"})
    assert any(node["id"] == "n_a" for node in a_again.json()["nodes"])


def test_cross_tenant_mutation_does_not_leak():
    """Tenant B mutating the shared graph_id never alters tenant A's graph."""
    graph_id = "g-iso-mutate"
    client.post(
        "/graph/mutate",
        headers={"X-Tenant-Id": "tenant_a"},
        json={
            "graph_id": graph_id,
            "mutations": [_mutation("add_node", {"id": "only_a", "name": "A", "type": "task"})],
        },
    )
    client.post(
        "/graph/mutate",
        headers={"X-Tenant-Id": "tenant_b"},
        json={
            "graph_id": graph_id,
            "mutations": [_mutation("add_node", {"id": "only_b", "name": "B", "type": "task"})],
        },
    )
    a_nodes = {n["id"] for n in client.get(f"/graph/{graph_id}", headers={"X-Tenant-Id": "tenant_a"}).json()["nodes"]}
    b_nodes = {n["id"] for n in client.get(f"/graph/{graph_id}", headers={"X-Tenant-Id": "tenant_b"}).json()["nodes"]}
    assert a_nodes == {"only_a"}
    assert b_nodes == {"only_b"}
