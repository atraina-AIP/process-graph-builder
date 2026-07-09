from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

PROPERTY_GRAPH_SCHEMA_VERSION = "property_graph_v1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_byte_size(value: Any) -> int | None:
    try:
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError):
        return None


def normalize_artifact_ref(ref: dict[str, Any], index: int = 0) -> dict[str, Any]:
    artifact_type = str(ref.get("artifact_type") or ref.get("type") or ref.get("format") or "external_json")
    source_format = str(ref.get("source_format") or ref.get("format") or ref.get("type") or artifact_type)
    artifact_id = str(ref.get("artifact_id") or ref.get("id") or f"artifact_ref_{source_format}_{index + 1}")
    byte_count = ref.get("bytes")
    try:
        byte_count = int(byte_count) if byte_count is not None else None
    except (TypeError, ValueError):
        byte_count = None
    return {
        "id": str(ref.get("id") or artifact_id),
        "artifact_id": artifact_id,
        "artifact_type": artifact_type,
        "source_format": source_format,
        "name": str(ref.get("name") or ref.get("source_file_name") or "Imported artifact"),
        "source_file_name": str(ref.get("source_file_name") or ""),
        "hash": str(ref.get("hash") or ""),
        "bytes": byte_count,
        "created_at": str(ref.get("created_at") or ref.get("imported_at") or now()),
        "storage_location": str(ref.get("storage_location") or "artifact_ledger"),
        "round_trip_role": str(ref.get("round_trip_role") or "source"),
        "summary": deepcopy(ref.get("summary") if isinstance(ref.get("summary"), dict) else {}),
    }


def artifact_ref_from_source_artifact(artifact: dict[str, Any], index: int = 0) -> dict[str, Any]:
    ref = {
        "id": artifact.get("id"),
        "artifact_id": artifact.get("artifact_id") or artifact.get("id"),
        "artifact_type": artifact.get("type") or artifact.get("format") or "external_json",
        "source_format": artifact.get("format") or artifact.get("type") or "external_json",
        "name": artifact.get("name") or artifact.get("source_file_name") or "Imported artifact",
        "source_file_name": artifact.get("source_file_name") or "",
        "created_at": artifact.get("created_at") or artifact.get("imported_at"),
        "storage_location": artifact.get("storage_location") or "artifact_ledger",
        "round_trip_role": artifact.get("round_trip_role") or "source",
        "summary": artifact.get("summary") if isinstance(artifact.get("summary"), dict) else {},
    }
    if "bytes" in artifact:
        ref["bytes"] = artifact.get("bytes")
    elif "content" in artifact:
        ref["bytes"] = json_byte_size(artifact.get("content"))
    return normalize_artifact_ref(ref, index)


def normalize_artifact_refs(graph: dict[str, Any]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, ref in enumerate(graph.get("artifact_refs") if isinstance(graph.get("artifact_refs"), list) else []):
        if not isinstance(ref, dict):
            continue
        normalized = normalize_artifact_ref(ref, index)
        if normalized["id"] in seen:
            continue
        refs.append(normalized)
        seen.add(normalized["id"])
    for index, artifact in enumerate(graph.get("source_artifacts") if isinstance(graph.get("source_artifacts"), list) else []):
        if not isinstance(artifact, dict):
            continue
        normalized = artifact_ref_from_source_artifact(artifact, index)
        if normalized["id"] in seen:
            continue
        refs.append(normalized)
        seen.add(normalized["id"])
    return refs


def strip_source_artifact_content(graph: dict[str, Any]) -> dict[str, Any]:
    graph = deepcopy(graph)
    stripped = []
    for artifact in graph.get("source_artifacts") if isinstance(graph.get("source_artifacts"), list) else []:
        if not isinstance(artifact, dict):
            continue
        item = {key: deepcopy(value) for key, value in artifact.items() if key != "content"}
        if "content" in artifact and "content_ref" not in item:
            item["content_ref"] = artifact.get("artifact_id") or artifact.get("id")
        stripped.append(item)
    graph["source_artifacts"] = stripped
    return graph


def prepare_graph_for_storage(graph: dict[str, Any], *, detach_artifact_content: bool = False) -> dict[str, Any]:
    prepared = deepcopy(graph)
    prepared["artifact_refs"] = normalize_artifact_refs(prepared)
    if detach_artifact_content:
        prepared = strip_source_artifact_content(prepared)
    return prepared


def prepare_envelope_for_storage(envelope: dict[str, Any], *, detach_artifact_content: bool = False) -> dict[str, Any]:
    prepared = deepcopy(envelope)
    graph = prepared.get("graph") if isinstance(prepared.get("graph"), dict) else None
    if graph is not None:
        prepared["graph"] = prepare_graph_for_storage(graph, detach_artifact_content=detach_artifact_content)
    return prepared


def record_id(graph_id: str, kind: str, value: str) -> str:
    return f"{graph_id}::{kind}::{value}"


def safe_properties(value: Any) -> Any:
    try:
        json.dumps(value)
        return deepcopy(value)
    except (TypeError, ValueError):
        return str(value)


def vertex(tenant_id: str, graph_id: str, kind: str, source_id: str, label: str, properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record_id(graph_id, kind, source_id),
        "label": label,
        "record_kind": kind,
        "tenant_id": tenant_id,
        "graph_id": graph_id,
        "source_id": source_id,
        "properties": safe_properties(properties),
    }


def edge(
    tenant_id: str,
    graph_id: str,
    kind: str,
    source_id: str,
    label: str,
    out_v: str,
    in_v: str,
    properties: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": record_id(graph_id, kind, source_id),
        "label": label,
        "record_kind": kind,
        "tenant_id": tenant_id,
        "graph_id": graph_id,
        "out_v": out_v,
        "in_v": in_v,
        "source_id": source_id,
        "properties": safe_properties(properties or {}),
    }


def graph_to_property_graph(graph: dict[str, Any], tenant_id: str | None = None) -> dict[str, Any]:
    graph = prepare_graph_for_storage(graph, detach_artifact_content=True)
    graph_id = str(graph.get("id") or "graph")
    tenant = str(tenant_id or graph.get("tenant_id") or "default")
    vertices: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    node_vertex_ids: dict[str, str] = {}
    constraint_vertex_ids: dict[str, str] = {}

    graph_vertex_id = record_id(graph_id, "graph", graph_id)
    vertices.append(
        vertex(
            tenant,
            graph_id,
            "graph",
            graph_id,
            "process_graph",
            {
                "name": graph.get("name", ""),
                "version": graph.get("version", ""),
                "description": graph.get("description", ""),
                "modeling_style": graph.get("modeling_style", "none"),
                "tags": graph.get("metadata", {}).get("tags", []) if isinstance(graph.get("metadata"), dict) else [],
            },
        )
    )

    for node in graph.get("nodes") if isinstance(graph.get("nodes"), list) else []:
        if not isinstance(node, dict) or not node.get("id"):
            continue
        node_id = str(node["id"])
        vertex_id = record_id(graph_id, "node", node_id)
        node_vertex_ids[node_id] = vertex_id
        vertices.append(
            vertex(
                tenant,
                graph_id,
                "node",
                node_id,
                "process_node",
                {
                    "name": node.get("name", node_id),
                    "node_type": node.get("type", "task"),
                    "description": node.get("description", ""),
                    "description_status": node.get("description_status", ""),
                    "inputs": node.get("inputs", []),
                    "outputs": node.get("outputs", []),
                    "attributes": node.get("attributes", {}),
                    "perspectives": node.get("perspectives", []),
                },
            )
        )
        edges.append(edge(tenant, graph_id, "contains_node", node_id, "contains_node", graph_vertex_id, vertex_id))

    for rel in graph.get("edges") if isinstance(graph.get("edges"), list) else []:
        if not isinstance(rel, dict) or not rel.get("id"):
            continue
        from_id = str(rel.get("from_node") or "")
        to_id = str(rel.get("to_node") or "")
        if from_id not in node_vertex_ids or to_id not in node_vertex_ids:
            continue
        label = str(rel.get("type") or "relationship")
        edges.append(
            edge(
                tenant,
                graph_id,
                "process_edge",
                str(rel["id"]),
                label,
                node_vertex_ids[from_id],
                node_vertex_ids[to_id],
                {
                    "condition": rel.get("condition", ""),
                    "flows": rel.get("flows", []),
                    "properties": rel.get("properties", {}),
                    "description": rel.get("description", ""),
                    "description_status": rel.get("description_status", ""),
                },
            )
        )

    for constraint in graph.get("constraints") if isinstance(graph.get("constraints"), list) else []:
        if not isinstance(constraint, dict) or not constraint.get("id"):
            continue
        constraint_id = str(constraint["id"])
        vertex_id = record_id(graph_id, "constraint", constraint_id)
        constraint_vertex_ids[constraint_id] = vertex_id
        fields = constraint.get("fields") if isinstance(constraint.get("fields"), dict) else {}
        vertices.append(
            vertex(
                tenant,
                graph_id,
                "constraint",
                constraint_id,
                "process_constraint",
                {
                    "constraint_type": constraint.get("type", "policy_rule"),
                    "expression": constraint.get("expression", ""),
                    "description": constraint.get("description", ""),
                    "description_status": constraint.get("description_status", ""),
                    "target": fields.get("target", ""),
                    "fields": fields,
                },
            )
        )
        edges.append(edge(tenant, graph_id, "contains_constraint", constraint_id, "contains_constraint", graph_vertex_id, vertex_id))
        target_id = str(fields.get("target") or "")
        if target_id in node_vertex_ids:
            edges.append(edge(tenant, graph_id, "constraint_target", constraint_id, "constrains", vertex_id, node_vertex_ids[target_id]))

    projection = graph.get("optimization_projection") if isinstance(graph.get("optimization_projection"), dict) else {}
    for item in projection.get("constraints") if isinstance(projection.get("constraints"), list) else []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        projection_id = str(item["id"])
        vertex_id = record_id(graph_id, "optimization_constraint", projection_id)
        vertices.append(
            vertex(
                tenant,
                graph_id,
                "optimization_constraint",
                projection_id,
                "optimization_constraint",
                {
                    "target_format": item.get("target_format", projection.get("target_format", "plant_json")),
                    "status": item.get("status", "draft"),
                    "process_constraint_id": item.get("process_constraint_id", ""),
                    "source_constraint_id": item.get("source_constraint_id", ""),
                    "relationship_equation": item.get("relationship_equation", ""),
                    "relationship_terms": item.get("relationship_terms", []),
                    "target": item.get("target", ""),
                    "property": item.get("property", ""),
                    "enabled": item.get("enabled", True),
                },
            )
        )
        edges.append(edge(tenant, graph_id, "contains_optimization_constraint", projection_id, "contains_optimization_constraint", graph_vertex_id, vertex_id))
        process_constraint_id = str(item.get("process_constraint_id") or "")
        if process_constraint_id in constraint_vertex_ids:
            edges.append(
                edge(
                    tenant,
                    graph_id,
                    "constraint_projection",
                    projection_id,
                    "projects_to",
                    constraint_vertex_ids[process_constraint_id],
                    vertex_id,
                    {"status": item.get("status", "draft")},
                )
            )

    objective = projection.get("objective") if isinstance(projection.get("objective"), dict) else None
    if objective:
        objective_id = str(objective.get("id") or "objective")
        objective_vertex_id = record_id(graph_id, "optimization_objective", objective_id)
        vertices.append(
            vertex(
                tenant,
                graph_id,
                "optimization_objective",
                objective_id,
                "optimization_objective",
                {
                    "target_format": projection.get("target_format", "plant_json"),
                    "sense": objective.get("sense", objective.get("type", "maximize")),
                    "name": objective.get("name", ""),
                    "description": objective.get("description", ""),
                    "terms": objective.get("terms", []),
                },
            )
        )
        edges.append(edge(tenant, graph_id, "contains_optimization_objective", objective_id, "contains_optimization_objective", graph_vertex_id, objective_vertex_id))

    for ref in graph.get("artifact_refs") if isinstance(graph.get("artifact_refs"), list) else []:
        if not isinstance(ref, dict) or not ref.get("id"):
            continue
        ref_id = str(ref["id"])
        artifact_vertex_id = record_id(graph_id, "artifact_ref", ref_id)
        vertices.append(vertex(tenant, graph_id, "artifact_ref", ref_id, "artifact_ref", ref))
        edges.append(edge(tenant, graph_id, "has_artifact", ref_id, "has_artifact", graph_vertex_id, artifact_vertex_id))

    return {
        "schema_version": PROPERTY_GRAPH_SCHEMA_VERSION,
        "tenant_id": tenant,
        "graph_id": graph_id,
        "vertices": vertices,
        "edges": edges,
        "counts": {
            "vertices": len(vertices),
            "edges": len(edges),
            "process_nodes": len(node_vertex_ids),
            "process_edges": len([item for item in edges if item.get("record_kind") == "process_edge"]),
            "constraints": len(constraint_vertex_ids),
            "artifact_refs": len(graph.get("artifact_refs") if isinstance(graph.get("artifact_refs"), list) else []),
        },
    }