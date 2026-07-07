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

Compiles a user message into mutation commands.

```json
{
  "graph_id": "pg-intake-to-close",
  "user_message": "Add source Customer request then Validate request then sink Closed"
}
```

Response shape:

```json
{
  "summary": "Compiled user instruction into graph mutations",
  "mutations": [],
  "questions": [],
  "warnings": [],
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
