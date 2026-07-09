# API Specification

## Naming

Public API payloads, graph JSON, mutation JSON, saved graph envelopes, persisted records, and exported artifacts use `snake_case`.

Private frontend implementation details may use idiomatic JavaScript names, but anything sent over the API or written to an artifact should be mapped to the public `snake_case` contract.


## Tenant Context

Durable backend routes are tenant-scoped. In cloud deployments, `tenant_id` is derived from Azure App Service Easy Auth's `X-MS-CLIENT-PRINCIPAL` header. Local development can still pass `X-Tenant-Id`; otherwise the backend falls back to `PROCESS_GRAPH_DEFAULT_TENANT` and then `default`.

## GET /session

Returns the resolved backend identity context used by the frontend to confirm backend availability.

```json
{
  "tenant_id": "default",
  "user_id": "",
  "user_name": "",
  "source": "default"
}
```

## GET /graphs

Returns saved graph summaries for the resolved tenant. The frontend Library dialog uses this endpoint when the backend is available.

```json
{
  "graphs": [
    {
      "id": "pg-make-to-order",
      "name": "Make to Order",
      "version": "0.1.0",
      "tenant_id": "default",
      "updated_at": "2026-07-07T12:00:00+00:00",
      "node_count": 12,
      "edge_count": 11
    }
  ]
}
```

## GET /graph/{id}/envelope

Returns the full frontend state envelope for a graph, including graph JSON, layout, selected item, mutation log, open questions, chat history, filters, and viewport state. If only a canonical graph exists, the backend returns `{ "graph": ... }`.

## PUT /graph/{id}/envelope

Saves the full frontend state envelope for the resolved tenant. The request body uses a single `envelope` key and the envelope keeps the same `snake_case` shape as the JSON export/localStorage contract.

```json
{
  "envelope": {
    "graph": {
      "id": "pg-make-to-order",
      "tenant_id": "default",
      "name": "Make to Order",
      "nodes": [],
      "edges": []
    },
    "layout": {},
    "mutation_log": [],
    "open_questions": [],
    "canvas_view": { "x": 0, "y": 0, "zoom": 1 }
  }
}
```

## GET /graph/{id}/artifacts

Lists artifact refs for full JSON artifacts associated with the graph. The frontend uses these refs in `graph.artifact_refs` and keeps large content out of Cosmos graph records.

```json
{
  "artifacts": [
    {
      "id": "src_plant",
      "artifact_id": "src_plant",
      "artifact_type": "plant_json",
      "source_format": "plant_json",
      "name": "NOR production",
      "hash": "...sha256...",
      "bytes": 7350000,
      "storage_location": "artifact_ledger",
      "round_trip_role": "source",
      "version_id": "artv_..."
    }
  ]
}
```

## POST /graph/{id}/artifacts

Stores a full JSON artifact version and returns a lightweight ref. Local dev writes to `PROCESS_GRAPH_ARTIFACT_STORE`; the Azure SQL target schema is `schema/artifact-ledger.sql`.

```json
{
  "artifact_id": "src_plant",
  "artifact_type": "plant_json",
  "source_format": "plant_json",
  "name": "NOR production",
  "source_file_name": "norProd.json",
  "round_trip_role": "source",
  "content": { "nodes": [], "edges": [] },
  "summary": { "node_count": 37 },
  "validation": { "valid": true, "errors": [], "warnings": [] }
}
```

## GET /graph/{id}/artifacts/{artifact_id}

Returns one artifact version including its full `content`. Optional query: `version_id`.

## GET /graph/{id}/property-graph

Returns a read-only property-graph projection of the stored ProcessGraph for Cosmos-as-graph writers and diagnostics. The projection has stable vertex/edge records; full JSON artifacts are represented as `artifact_ref` vertices, not embedded payloads.

```json
{
  "schema_version": "property_graph_v1",
  "tenant_id": "default",
  "graph_id": "pg-make-to-order",
  "vertices": [
    {
      "id": "pg-make-to-order::node::n1",
      "label": "process_node",
      "record_kind": "node",
      "tenant_id": "default",
      "graph_id": "pg-make-to-order",
      "source_id": "n1",
      "properties": { "name": "Cut", "node_type": "task" }
    }
  ],
  "edges": [
    {
      "id": "pg-make-to-order::process_edge::e1",
      "label": "flow",
      "record_kind": "process_edge",
      "out_v": "pg-make-to-order::node::n1",
      "in_v": "pg-make-to-order::node::n2",
      "properties": { "flows": [] }
    }
  ],
  "counts": {
    "vertices": 1,
    "edges": 1,
    "process_nodes": 1,
    "process_edges": 1,
    "constraints": 0,
    "artifact_refs": 0
  }
}
```

## POST /graph/{id}/property-graph/sync

Projects the stored ProcessGraph and syncs it through the configured property-graph writer. Local dev writes a sync receipt and latest projection to `PROCESS_GRAPH_PROPERTY_GRAPH_SYNC_STORE`. When `COSMOS_GREMLIN_ENDPOINT` or `COSMOS_GREMLIN_HOST` is set, the backend writes vertices and edges to Cosmos DB for Apache Gremlin.

```json
{
  "dry_run": false
}
```

Response:

```json
{
  "projection": {
    "schema_version": "property_graph_v1",
    "tenant_id": "default",
    "graph_id": "pg-make-to-order",
    "counts": { "vertices": 6, "edges": 5, "process_nodes": 2, "process_edges": 1 }
  },
  "sync": {
    "schema_version": "property_graph_sync_v1",
    "writer": "json_file",
    "dry_run": false,
    "tenant_id": "default",
    "graph_id": "pg-make-to-order",
    "vertices": 6,
    "edges": 5,
    "details": {}
  }
}
```

## POST /graph/mutate

Applies deterministic mutations to the graph model.

```json
{
  "graph_id": "pg-intake-to-close",
  "mutations": [
    {
      "action": "add_node",
      "target_id": null,
      "payload": {
        "id": "n_validate_request",
        "name": "Validate request",
        "type": "task",
        "description": "Validate request is a process step that takes request and turns it into validated request.",
        "description_status": "suggested",
        "inputs": ["request"],
        "outputs": ["validated request"],
        "resources_required": [],
        "attributes": {},
        "notes": ""
      },
      "reason": "User described a step",
      "confidence": "high"
    }
  ]
}
```

Edges carry typed flows instead of relying on diagram-only labels:

```json
{
  "id": "e_invoice_match",
  "from_node": "n_supplier_invoice",
  "to_node": "n_match_invoice",
  "type": "flow",
  "condition": "",
  "flows": [
    {
      "id": "f_invoice",
      "name": "invoice",
      "kind": "information",
      "quantity": "",
      "unit": "",
      "properties": {}
    }
  ]
}
```

## POST /graph/assist

Compiles a user message into mutation commands. By default this uses the deterministic compiler. If the backend is started with `PROCESS_GRAPH_LLM_ASSIST_ENABLED=true` and the request sets `use_llm: true`, the endpoint attempts the server-side LLM compiler and falls back deterministically with a warning if unavailable.

```json
{
  "graph_id": "pg-intake-to-close",
  "user_message": "Add source Customer request then Validate request then sink Closed",
  "graph": { "id": "pg-intake-to-close", "nodes": [], "edges": [] },
  "chat_messages": [],
  "use_llm": false
}
```

`graph` and `chat_messages` are optional for backward compatibility, but the frontend sends them so assist planning uses the current in-browser graph rather than stale persisted state.

Response shape:

```json
{
  "summary": "Compiled user instruction into graph mutations",
  "mutations": [],
  "questions": [],
  "warnings": [],
  "compiler": {
    "mode": "deterministic",
    "prompt_version": "process_graph_compiler_v2",
    "llm_requested": false
  },
  "handoff_readiness": {
    "structure_complete": true,
    "missing_values": [],
    "missing_constraints": [],
    "open_questions": []
  }
}
```

## GET /graph/{id}

Returns the canonical `ProcessGraph` JSON, including the editable `ontology` object inferred from graph contents.

Backend-compatible persistence may also include:

- `open_questions`
- `chat_messages`
- `versions`

The graph may include `modeling_style` values:

- `none`
- `business_process`
- `value_stream`
- `system_flow`
- `team_topology`
- `custom`

The frontend maps each modeling style to a notation profile. The profile changes only visual notation: node shapes, edge strokes, port/handle shapes, legend copy, and reference metadata. The canonical graph schema does not fork by style.

Nodes may include a reviewed plain-language definition:

- `description`: editable node definition used to seed ontology entries
- `description_status`: `empty`, `suggested`, `custom`, or `approved`

Approved definitions are stored in `ontology.properties` as node-specific entries.

## GET /graph/{id}/export/md

Returns the graph as a downloadable Markdown spec.

Markdown and JSON exports include the selected notation profile and references used to ground the visual notation.

## Constraint Fields

Constraints keep a compact `expression` for export, but the preferred editing surface is structured:

```json
{
  "id": "c_request_route_rule",
  "type": "routing_rule",
  "fields": {
    "target": "Is request complete",
    "metric": "branch",
    "operator": "routes_to",
    "value": "complete request to Route work; incomplete request to Request clarification",
    "unit": "",
    "notes": "Branching is represented by conditioned outgoing edges."
  },
  "expression": "Is request complete: branch routes to complete request to Route work; incomplete request to Request clarification."
}
```

Supported constraint types:

- `flow_balance`
- `capability_limit`
- `timing`
- `routing_rule`
- `policy_rule`

Directed edges imply precedence. Timing means duration, delay, wait time, transfer time, cycle time, or lead time. Resource requirements and capacity limits are represented together as `capability_limit`.

## Ontology

The graph stores editable definitions for:

- `modeling_styles`
- `node_types`
- `edge_types`
- `flow_types`
- `constraint_types`
- `resource_types`
- `properties`
