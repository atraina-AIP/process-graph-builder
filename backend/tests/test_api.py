"""Backend tests for the Process Graph Builder API.

Covers the mutation engine, the deterministic assist compiler, the markdown
export, and the HTTP endpoints (including Pydantic request validation).
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import backend.main as main_module
from backend.main import (
    apply_mutation,
    app,
    build_compiler_prompt,
    compile_assist_message,
    default_graph,
    markdown_export,
    resolve_tenant_id,
)

client = TestClient(app)


def _easy_auth_header(principal):
    payload = json.dumps(principal).encode("utf-8")
    return base64.b64encode(payload).decode("ascii").rstrip("=")

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


def test_compile_infers_distribution_flow_payload():
    graph = default_graph()
    response = compile_assist_message(graph, "Supplier ships pallets then Regional DC")
    edges = [mutation["payload"] for mutation in response["mutations"] if mutation["action"] == "add_edge"]
    assert edges
    assert edges[0]["flows"][0]["kind"] == "parts"


def test_compiler_prompt_includes_plant_structured_milp_guidance():
    prompt = build_compiler_prompt()
    assert "plant_structured_milp" in prompt
    assert "timeConfig" in prompt
    assert "variableType" in prompt
    assert "node roles" in prompt
    assert "Stage labels" in prompt
    assert "Relationship constraints over node.property references" in prompt
    assert "Contracts and scenarios layer on later" in prompt


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
    assert response.json()["storage"] == "json"


def test_session_defaults_to_default_tenant():
    response = client.get("/session")
    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"] == "default"
    assert body["source"] == "default"


def test_session_resolves_easy_auth_tenant_claim():
    principal = {
        "userDetails": "maker@example.com",
        "userId": "user-1",
        "claims": [
            {"typ": "http://schemas.microsoft.com/identity/claims/tenantid", "val": "Tenant 123"},
        ],
    }
    response = client.get(
        "/session",
        headers={
            "X-MS-CLIENT-PRINCIPAL": _easy_auth_header(principal),
            "X-Tenant-Id": "dev_tenant",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"] == "tenant_123"
    assert body["user_id"] == "user-1"
    assert body["user_name"] == "maker@example.com"
    assert body["source"] == "auth_claim"

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


def test_graph_envelope_save_list_and_load_round_trip():
    graph = default_graph("g-envelope", "wrong_tenant")
    graph["name"] = "Cloud Envelope"
    graph["nodes"] = [{"id": "n1", "name": "Cut", "type": "task"}]
    envelope = {
        "graph": graph,
        "layout": {"nodes": {"n1": {"x": 120, "y": 80}}},
        "selected": {"type": "node", "id": "n1"},
        "mutation_log": [{"action": "add_node", "target_id": "n1"}],
        "open_questions": ["What is the cycle time?"],
        "canvas_view": {"x": 1, "y": 2, "zoom": 0.9},
    }

    save_response = client.put(
        "/graph/g-envelope/envelope",
        headers={"X-Tenant-Id": "tenant_cloud"},
        json={"envelope": envelope},
    )
    assert save_response.status_code == 200
    save_body = save_response.json()
    assert save_body["graph"]["id"] == "g-envelope"
    assert save_body["graph"]["tenant_id"] == "tenant_cloud"
    assert "frontend_envelope" not in save_body["graph"]
    assert "updated_at" not in save_body["graph"]
    assert save_body["envelope"]["layout"]["nodes"]["n1"] == {"x": 120, "y": 80}

    list_response = client.get("/graphs", headers={"X-Tenant-Id": "tenant_cloud"})
    assert list_response.status_code == 200
    summary = list_response.json()["graphs"][0]
    assert summary["id"] == "g-envelope"
    assert summary["name"] == "Cloud Envelope"
    assert summary["node_count"] == 1
    assert summary["edge_count"] == 0
    assert summary["updated_at"]

    load_response = client.get("/graph/g-envelope/envelope", headers={"X-Tenant-Id": "tenant_cloud"})
    assert load_response.status_code == 200
    loaded = load_response.json()
    assert loaded["graph"]["tenant_id"] == "tenant_cloud"
    assert loaded["mutation_log"] == [{"action": "add_node", "target_id": "n1"}]

    graph_response = client.get("/graph/g-envelope", headers={"X-Tenant-Id": "tenant_cloud"})
    assert graph_response.status_code == 200
    graph_body = graph_response.json()
    assert "frontend_envelope" not in graph_body
    assert "updated_at" not in graph_body


def test_graph_envelope_requires_graph():
    response = client.put("/graph/g-missing-envelope/envelope", json={"envelope": {"layout": {}}})
    assert response.status_code == 422

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


def test_assist_uses_request_graph_context():
    graph = default_graph("g-request-context")
    graph["nodes"].append({"id": "n_start", "name": "Start", "type": "source", "inputs": [], "outputs": ["order"]})
    payload = {
        "graph_id": "g-request-context",
        "user_message": "Start then Pack order",
        "graph": graph,
    }
    response = client.post("/graph/assist", json=payload)
    assert response.status_code == 200
    add_node_ids = [
        mutation["payload"].get("id")
        for mutation in response.json()["mutations"]
        if mutation["action"] == "add_node"
    ]
    assert "n_start" not in add_node_ids


def test_assist_llm_requested_with_server_flag_off_falls_back(monkeypatch):
    monkeypatch.delenv("PROCESS_GRAPH_LLM_ASSIST_ENABLED", raising=False)
    payload = {"graph_id": "g-llm-off", "user_message": "Start then End", "use_llm": True}
    response = client.post("/graph/assist", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["compiler"]["mode"] == "deterministic"
    assert body["compiler"]["llm_requested"] is True
    assert body["warnings"]


def test_assist_llm_path_uses_mock_client(monkeypatch):
    def fake_llm(graph, user_message, chat_messages):
        assert graph["id"] == "g-llm-on"
        assert user_message == "Use the model"
        assert chat_messages == [{"role": "user", "detail": "prior"}]
        return {
            "summary": "LLM compiled plan",
            "mutations": [
                _mutation("add_node", {"id": "n_model", "name": "Model node", "type": "task"}),
            ],
            "questions": [],
            "warnings": [],
            "handoff_readiness": {
                "structure_complete": True,
                "missing_values": [],
                "missing_constraints": [],
                "open_questions": [],
            },
        }

    monkeypatch.setenv("PROCESS_GRAPH_LLM_ASSIST_ENABLED", "true")
    monkeypatch.setattr(main_module, "LLM_ASSIST_CLIENT", fake_llm)
    payload = {
        "graph_id": "g-llm-on",
        "user_message": "Use the model",
        "graph": default_graph("g-llm-on"),
        "chat_messages": [{"role": "user", "detail": "prior"}],
        "use_llm": True,
    }
    response = client.post("/graph/assist", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "LLM compiled plan"
    assert body["compiler"]["mode"] == "llm"
    assert body["mutations"][0]["payload"]["id"] == "n_model"


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


def test_property_graph_projection_endpoint_returns_vertices_and_edges():
    graph = default_graph("g-property-api", "wrong_tenant")
    graph["name"] = "Property API"
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
    graph["source_artifacts"] = [
        {"id": "src_plant", "type": "plant_json", "format": "plant_json", "content": {"nodes": [], "edges": []}}
    ]

    save_response = client.put(
        "/graph/g-property-api/envelope",
        headers={"X-Tenant-Id": "tenant_graph"},
        json={"envelope": {"graph": graph, "layout": {}}},
    )
    assert save_response.status_code == 200

    response = client.get("/graph/g-property-api/property-graph", headers={"X-Tenant-Id": "tenant_graph"})
    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"] == "tenant_graph"
    assert body["counts"]["process_nodes"] == 2
    assert body["counts"]["process_edges"] == 1
    assert body["counts"]["constraints"] == 1
    assert body["counts"]["artifact_refs"] == 1
    assert any(vertex["label"] == "artifact_ref" for vertex in body["vertices"])


def test_property_graph_sync_endpoint_writes_local_sync_store():
    graph = default_graph("g-property-sync", "wrong_tenant")
    graph["name"] = "Property Sync"
    graph["nodes"] = [
        {"id": "n1", "name": "Source", "type": "source", "inputs": [], "outputs": ["ore"], "attributes": {}},
        {"id": "n2", "name": "Mill", "type": "task", "inputs": ["ore"], "outputs": ["concentrate"], "attributes": {}},
    ]
    graph["edges"] = [
        {"id": "e1", "from_node": "n1", "to_node": "n2", "type": "flow", "condition": "", "flows": []}
    ]

    save_response = client.put(
        "/graph/g-property-sync/envelope",
        headers={"X-Tenant-Id": "tenant_graph"},
        json={"envelope": {"graph": graph, "layout": {}}},
    )
    assert save_response.status_code == 200

    response = client.post(
        "/graph/g-property-sync/property-graph/sync",
        headers={"X-Tenant-Id": "tenant_graph"},
        json={"dry_run": False},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["sync"]["writer"] == "json_file"
    assert body["sync"]["vertices"] == body["projection"]["counts"]["vertices"]
    assert body["projection"]["counts"]["process_nodes"] == 2

    raw = json.loads(Path(main_module.PROPERTY_GRAPH_SYNC_PATH).read_text(encoding="utf-8"))
    saved = raw["tenants"]["tenant_graph"]["graphs"]["g-property-sync"]
    assert saved["latest_projection"]["counts"]["process_edges"] == 1


def test_artifact_ledger_endpoints_round_trip():
    payload = {
        "artifact_id": "plant_src",
        "artifact_type": "plant_json",
        "source_format": "plant_json",
        "name": "Plant source",
        "source_file_name": "plant.json",
        "round_trip_role": "source",
        "content": {"nodes": [{"id": "n1"}], "edges": []},
        "summary": {"node_count": 1},
        "validation": {"valid": True, "errors": [], "warnings": []},
    }
    save_response = client.post(
        "/graph/g-artifacts/artifacts",
        headers={"X-Tenant-Id": "tenant_artifacts"},
        json=payload,
    )
    assert save_response.status_code == 200
    saved = save_response.json()
    assert saved["artifact_ref"]["artifact_id"] == "plant_src"
    assert saved["artifact_ref"]["source_format"] == "plant_json"
    assert saved["artifact_ref"]["hash"]

    list_response = client.get("/graph/g-artifacts/artifacts", headers={"X-Tenant-Id": "tenant_artifacts"})
    assert list_response.status_code == 200
    assert list_response.json()["artifacts"] == [saved["artifact_ref"]]

    load_response = client.get(
        "/graph/g-artifacts/artifacts/plant_src",
        headers={"X-Tenant-Id": "tenant_artifacts"},
    )
    assert load_response.status_code == 200
    loaded = load_response.json()
    assert loaded["content"]["nodes"][0]["id"] == "n1"
    assert loaded["artifact_ref"] == saved["artifact_ref"]

    missing_response = client.get(
        "/graph/g-artifacts/artifacts/plant_src",
        headers={"X-Tenant-Id": "tenant_other"},
    )
    assert missing_response.status_code == 404
