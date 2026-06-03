# Process Graph Builder Backlog

## Status

The authoring UI is good enough for the next milestone. Recent work covered canvas editing, inspector simplification, ontology editing, notation profiles, chat review, preview/apply/discard, undo, pan/zoom/minimap, and collapsible side panels.

Progress (2026-06-01): backend persistence has substantially advanced — Pydantic v2 request
models, an Azure Cosmos DB store (with a JSON file fallback for local dev), a passing
backend test suite, and chat/log surfacing of backend errors. On the frontend, a
**local-file mode** (Export/Import JSON, fully offline) was added and `snake_case` is now
enforced on persisted and exported state.

Direction: the app now runs in **two coexisting modes** — (1) a default **local-file /
offline mode** (browser-only, localStorage + JSON file import/export, no backend required),
and (2) an optional **backend mode** for durable, multi-user, auditable persistence
(Cosmos DB). These are complementary, not either/or; remaining priorities are the graph
library, subgraph views, real LLM assist, and tenant-scoped durable records.

Propel context: this project is the Process Mapper / Graph Builder wedge of Propel. It should produce durable, auditable artifacts that can feed knowledge graph, solver, explanation, approval, and memory services. Public contracts should use `snake_case`.

Current focus (2026-06-03): **frontend-first**. Local-file/offline mode is the authoritative
near-term workflow, and public artifacts/API shapes stay `snake_case`. Backend findings from
the review are captured below as deferred hardening work, not current sprint priorities.

Review triage (2026-06-03):
- **Frontend / contract now:** keep the exported `schema_version` aligned with
  `schema/process-graph.schema.json` (currently v5) and preserve `snake_case` fields in saved
  envelopes, JSON exports, design-space exports, and import fallbacks.
- **Frontend polish now:** Import JSON should read `allow_cycles` with the existing legacy
  `allowCycles` fallback so exported settings round-trip cleanly.
- **Backend later:** authenticate/bind `tenant_id` instead of trusting only `X-Tenant-Id`,
  add optimistic concurrency or locking for mutation writes, validate mutation payloads before
  persistence, and bring backend Markdown export into parity with the frontend export contract.

## Milestone 0: UI Polish Baseline

Status: mostly complete.

- Canvas drag-to-connect edge creation
- Explicit node ports/handles
- Pan, zoom, fit, reset, and minimap
- Collapsible left menu and right inspector
- Chat transcript with user instructions and assistant replies
- Pending mutation preview in greyscale
- Apply, discard, and undo mutation batches
- Inspector and ontology tab structure
- Editable node definitions with approval into ontology
- Resources modeled as first-class canvas nodes (consumed via allocation edges)
- Free-text constraints (one plain-language statement per constraint)
- Modeling style selector
- Notation profiles for plain graph, business process, value stream, system flow, team topology, and custom
- Markdown and JSON export
- Frontend-only local-file mode: Export JSON saves full state, Import JSON restores it (round-trips, accepts bare graphs and legacy localStorage shapes), no backend required

## Milestone 1: Save, Load, and Views

Priority: P0.

### P0-0 Propel Contract Alignment

Make the current prototype envelope explicit as a Propel-compatible artifact contract.

Status: partially done (2026-06-01).

Acceptance:
- [x] Public graph, mutation, saved envelope, artifact, and API fields use `snake_case` — localStorage persistence and the export envelope now emit `snake_case` (e.g. `mutation_log`, `open_questions`, `canvas_view`, `notation_profile`).
- [x] Private JavaScript state is mapped at persistence/API boundaries when needed — camelCase internals map to `snake_case` on save/export, with a camelCase read fallback for migration.
- [x] Saved graph envelope includes future-ready fields — the export envelope now carries `artifact_id`, `schema_version`, `graph_version`, `created_at`, `updated_at`, `created_by` (plus `handoff_readiness`). `tenant_id` deferred (backend).
- [x] Exported artifacts are named with `snake_case`.
- [x] Backlog and API docs reference Propel alignment (`PROPEL_ALIGNMENT.md`).
- [ ] Keep `SCHEMA_VERSION` in the frontend export envelope synchronized with
  `schema/process-graph.schema.json` (review finding: schema is v5 while `app.js` still
  stamps v4).
- [ ] Import/export settings round-trip using `snake_case` first, with legacy camelCase
  fallback only for migration (review finding: Import JSON reads `allowCycles` but not
  `allow_cycles`).

### P0-1 Local Save/Load

Add named graph save/load using the current graph envelope.

Status: done (2026-06-01). The graph library (P0-2) provides named save/load via a shared
`serializeState`/`applyEnvelopeToState` envelope; file-based Export/Import JSON also covers
single-graph save/load (see Milestone 0).

Acceptance:
- [x] User can save the current graph under a name — Library dialog "Save current graph".
- [x] User can load a saved graph — Library "Load" restores full state, clears transient plan.
- [x] Saved state includes graph, layout, ontology, chat transcript, open questions, mutation log, pending plan (cleared on load), selected style, and viewport.
- [x] Existing localStorage prototype state migrates cleanly — `snake_case` read with camelCase fallback.

### P0-2 Graph Library

Add a lightweight saved graph list.

Status: done (2026-06-01). A `<dialog>`-based library stores entries under the
`process-graph-builder-library-v1` localStorage key (snake_case: `id`, `name`, `saved_at`,
`updated_at`, `node_count`, `edge_count`, `envelope`); verified in-browser (save, load,
duplicate, delete) with no console errors.

Acceptance:
- [x] User can see saved graphs with name, last modified time, node count, and edge count.
- [x] User can duplicate or delete a saved graph (delete is confirm-guarded).
- [x] Loading a graph does not destroy another saved graph — load never writes the library; entries are cloned on save/load.

Follow-ups (not blocking): rename in place; sort/search when the list grows; and—once the
backend opt-in exists—sync the library to Cosmos so it isn't browser-local.

### P0-3 Subgraph Views

Add saved view definitions that filter or focus the graph without changing the canonical graph.

Status: first slice done (2026-06-02) — ephemeral quick filters. A "Views" toolbar button
opens a non-modal popover (flow-kind / edge-type / node-type chips + focus-on-selection);
matching elements stay lit, others dim (`.is-dimmed`); a statusbar pill shows
`Viewing … · X of Y nodes · X of Y edges · Clear`. `resolveView()` is a pure function;
`active_filter` persists (snake_case) and restores on reload. Verified in-browser (node/edge
filters, endpoint pull-in, persistence, clear) with no console errors. **Saved views done
(2026-06-02):** `graph.saved_views[]` ({id, name, filter}) with save / apply / delete in the
Views popover, persisted with the graph and included in export; verified in-browser
(save → apply → delete → reload).

Acceptance:
- [x] User can create a view from flow kind, edge type, node type, and focus-on-selection, and **save** it as a named view. (path/resource/constraint-target/search filters still open as future filter dimensions.)
- [x] Canvas can switch between full graph and saved views (apply/clear).
- [x] Export includes saved views (`graph.saved_views` rides along in the envelope).
- [x] Subgraph view does not delete hidden graph objects — focus dims, never mutates.

#### Design

Core principle: a view is a **pure filter over the canonical graph, resolved to visible
id sets at render time** — never a mutation. The graph stays the single source of truth.
This reuses the existing render-against-a-derived-id-set mechanism already used for the
pending-plan preview in `renderCanvas` (`nodes.filter((n) => preview.nodeIds.has(n.id))`).

View data model (`saved_views[]` on the graph envelope, snake_case):

```json
{
  "id": "view_cash_flows",
  "name": "Cash flows only",
  "match": "all",
  "filters": {
    "node_ids": [],
    "node_types": [],
    "edge_types": [],
    "flow_kinds": ["cash"],
    "resource_ids": [],
    "constraint_target": "",
    "search": "",
    "neighborhood": { "seed_node_ids": [], "hops": 1 },
    "path": { "from_node": "", "to_node": "" }
  },
  "display": { "mode": "focus" }
}
```

Resolution (one pure, unit-testable function): `resolveView(graph, view)` returns
`{ node_ids: Set, edge_ids: Set }`. The node-edge relationship is bidirectional:
- Filter by **nodes** (selection, type, neighborhood, path) -> compute node set, then
  include **induced edges** (edge visible iff both endpoints visible).
- Filter by **edges** (flow_kind, edge_type) -> select matching edges first, then **pull
  in their endpoint nodes**. This is the "view a subset of edges" case (e.g. only `cash`
  flows, only `dependency` edges).
Each filter contributes a (nodes, edges) pair; combine with `match: all | any`.

Rendering — two display modes (reuse the preview filter step in `renderCanvas`):
- **hide** — render only visible ids (clean, loses context).
- **focus** (recommended default) — render everything, add a `.is-dimmed` class
  (low opacity, non-interactive) to out-of-view elements; keeps the surrounding map.

Two UX tiers:
- **Quick filters (ephemeral, not saved):** toolbar chips to toggle flow kinds / edge
  types; set an in-memory `active_filter`. Fastest path to "view a subset of edges."
- **Saved views (persistent):** `saved_views[]` + a view switcher; "Save current view"
  captures the current quick-filter/selection.

Decisions / gotchas:
- **Layout:** keep canonical node positions when a view activates (do not scramble the
  map). Optional "re-layout this view" runs `autoLayoutGraph` over only visible nodes into
  a view-scoped layout override — never the canonical `layout`.
- **Pending-plan preview composition:** a plan may add objects outside the active view;
  v1 shows new objects (union the preview with the view).
- **Selecting a hidden object** (e.g. from a constraint reference) shows a "this object is
  outside the current view -> Show full graph" affordance.
- **Contract:** add `saved_views` (optional) to `schema/process-graph.schema.json` and
  include it in export. No Cosmos schema change — views live inside the graph document.
  `active_view_id` is session/UI state (persist in localStorage like `canvas_view`), not
  part of the shared artifact.

Suggested first slice (small, high value, no mutation-engine changes):
1. `resolveView()` pure function with `flow_kinds`, `edge_types`, `node_types`, `node_ids`.
2. Focus-mode rendering (dim others) wired into `renderCanvas`.
3. Toolbar quick-filter chips for flow kinds + edge types.
4. Statusbar "X of Y" counts.

Author `resolveView()` as a pure function so it can move into the future `graph-logic.js`
extraction (see `REFACTOR_PLAN.md` Option A) and be unit-tested alongside the backend
suite.

### P0-4 View-Aware Inspector

Make the inspector explain when the user is looking at a filtered view.

Status: done (2026-06-02).

Acceptance:
- [x] Hidden nodes/edges are counted — statusbar pill shows `X of Y nodes / X of Y edges`.
- [x] Validation can run on full graph or current view — "Validate current view only" toggle scopes `validateGraph` to the visible id sets (shows "Validating current view: X of Y nodes").
- [x] User can jump from a view object back to full graph context — selecting a hidden object shows a "This {node|edge} is outside the current view → Show full graph" notice in the inspector that clears the filter.

#### Design

- **Status/minimap:** when a view is active show `X of Y nodes / X of Y edges` in the
  statusbar; the minimap reflects visibility (dim or omit hidden objects).
- **Validation scope:** runs on the full graph by default; add a "validate current view"
  toggle. A view that hides an orphan's only edge must not report it as newly broken —
  scope `validateGraph` to the resolved id sets when in view mode.
- **Jump back:** selecting or following a reference to a hidden object surfaces a
  "outside current view -> Show full graph" control that clears `active_view_id`.

### P0-5 UI Declutter

The side panels and canvas are getting crowded as data inputs accumulate. Reduce the
always-on footprint via progressive disclosure, established by the views popover (P0-3).

Status: done (2026-06-03), browser-verified.

- [x] **Per-element editing → modal.** Node/edge editing opens in a `#elementEditorDialog` on
  **double-click** (or single-select + "Edit selected"); the existing `#inspectorContent` was
  relocated into the dialog so all render/handlers work unchanged. Delete closes it.
- [x] **Graph-level concerns home (decision made):** they **stay in the right panel** — Add
  Edge, Constraints, Validation, plus the Ontology tab. Only per-element editing moved to the
  modal. The panel shows a hint + "Edit selected" when nothing is open.
- [x] **Topbar consolidated** to `Reset`, `Clear`, **Save**, **Load**. Save dialog = name +
  Save-to-Library / Export JSON / Export Markdown / Copy JSON. Load dialog = the library list
  (load/duplicate/delete) + Import JSON file. (Reuses the dialog pattern from P0-2.)
- [x] **Views/filter** stays a toolbar button + non-modal popover (P0-3).
- [x] Behavior preserved; layout/disclosure only, no schema or data changes.

Also (2026-06-03): the canvas notation legend is now collapsible (`legend_collapsed` persisted);
the canvas toolbar was tidied (the five node-create buttons collapsed into one "+ Add node"
dropdown); the views popover is capped/scrollable so it no longer overflows the canvas frame.

Note: added a `?v=` cache-bust query on the `app.js` script tag — bump it when shipping JS
changes (the static dev server lets browsers cache `app.js`; a hard-reload also works).

Update (2026-06-03): the **right panel was fully removed**. Per-element editing opens on a
**single click** of a node/edge (drag still moves; the editor modal also opens via double-click).
Graph-level concerns moved to **topbar buttons → dialogs**: Ontology and Validation
(the Validation button carries a green/orange/red readiness dot). The **Add Edge form was
dropped** (create edges by drag-to-connect, then click the edge to set type/condition/flows).
The workspace is now two columns (left compiler panel + canvas); the canvas widened. Verified
in-browser, clean boot. Goal of eliminating the right side panel is met.

Update (2026-06-03): **constraints moved into the element editor modal** (a "Constraints" tab
alongside "Details"), not a topbar dialog. Each constraint is OWNED by the node/edge it's
authored under (`fields.target` = element id, set implicitly — no picker); the tab lists/edits
that element's constraints (free text, add/delete). The sample's constraints carry explicit
owners; legacy/targetless constraints are best-effort assigned an owner from their text on load.
The standalone Constraints topbar button/dialog were removed. Dialog bodies are now flex scroll
regions (`flex:1 1 auto; min-height:0; overflow-y:auto`) so they don't overflow the frame, and
`styles.css` is now cache-busted too (both `?v=` bumped on every JS/CSS change).

Update (2026-06-03): the baked-in sample is now a **make-to-order manufacturing line**
("Make-to-Order Line": order → plan → purchase → CNC machining → quality check → rework loop →
assemble → ship → fulfilled, with CNC/operator/energy resources). It is a deliberate **feature
tour** — exercises all 5 node types, all 6 edge types, all 8 flow kinds, all 3 resource kinds
(machine/human/cost with cost_rate + basis_unit), node + edge perspectives, node + edge
properties, an approved node definition, an edge definition, and all 5 constraint types including
one edge-owned constraint. 13 nodes / 14 edges; validates clean. (Existing users must hit **Reset**
to load it, since localStorage state is restored on load.)

### P0-6 Unified Element Editor (properties / constraints / definitions)

Status (2026-06-02): data model + most editing widgets DONE and browser-verified. Done:
single commit path (persistence), `cost` resource type + free-text `basis_unit`, edge
`resources_required`, free-form Properties editor (node `attributes` / edge `properties`,
key/value with real key-removal), `perspectives` blocks on nodes and edges, edge Definition
field, node Notes dropped + migrated to a "Notes" perspective, schema v2/v3 bump, and the
**constraint simplification**: constraints are now a single free-text `expression` per
constraint (textarea) with a help tip ("…relationship between inputs, properties, outputs,
resources, or capacity…") — multiple targets are named inline in the text. The structured
fields/target/operator/value/unit model and the derived-spec/target-picker (built earlier this
session) were REMOVED per user direction; `type` is retained in data (default `policy_rule`)
but hidden; legacy `fields` are tolerated and seeded into `expression` once on load; constraints
render as a flat list with per-item delete; validation flags an empty statement. Remaining: full
Suggest/Approve + ontology-sync for edge/resource/constraint definitions; a single shared row
component + uniform type-help; and re-hosting these editors in the P0-5 modal.

**Resources are now canvas nodes (2026-06-02), superseding the catalog + resources_required
model.** `resource` is a 5th node type (teal cylinder, "Resource" toolbar button); a resource's
kind/`cost_rate`/`basis_unit` live in its node attributes/properties. "X requires resource Y" is
now an `allocation` edge (consumer → resource node) carrying the quantity. The side-panel
Resources catalog and the per-node/edge Resources-Required editors were removed; on load, legacy
`graph.resources` migrate to resource nodes and `resources_required` to allocation edges
(idempotent). Schema v4: `resource` added to the node type enum; `resources` + `resources_required`
kept optional/deprecated (tolerated, migration-only). This removes the earlier "cost resource type
+ edge resources_required" widgets — that data now lives on resource nodes. (Minor follow-up:
orphaned `.resource-item`/`.resource-list` CSS left in `styles.css`, harmless.)

The node/edge/resource/constraint editing surfaces grew inconsistently. Rework them into
one consistent editor (build alongside the P0-5 modal inspector so the markup isn't redone
twice). Review findings that motivate this:

- **Persistence was per-field and lossy** — `applyMutation` didn't persist; handlers called
  `saveState()` ad hoc, so node-type / inputs / outputs / edge fields / flows / resource-reqs
  / resources / constraints were silently lost on reload. **Fixed 2026-06-02**: `applyMutation`
  now persists on every edit (single chokepoint). The remaining items below are the structural
  rework.
- **Three different repeatable-row patterns** for the same concept (`.list-row` inputs/outputs,
  `.resource-requirement-row`, `.flow-row`).
- **Type-help is uneven** — node/edge/constraint type selects show ontology descriptions;
  resource type and the inspector's per-flow "Kind" show none.
- **Definition semantics differ per object** — node has description + status + Suggest/Approve +
  ontology sync; edge/resource/flow have none; constraint has notes + a derived expression.
- **Constraints associate by fuzzy text match** (`constraintMatchesSelection` on a free-text
  `target`) instead of real id references like edges/resources use.

Acceptance:
- [x] One commit path: every inspector edit persists + refreshes uniformly (render-scope unification still lands cleaner with the modal editor).
- [ ] One shared repeatable-row component for inputs/outputs/flows (single class, consistent add/remove/labeling). — still open.
- [ ] Uniform type-help under every type/kind select. — still open.
- [~] **Consistent "definition" on all objects** — edges got a Definition field; resources/constraints inherit node fields as nodes/text. Full Suggest/Approve + ontology-sync for edge/resource/constraint definitions is **still open**.
- [x] Constraint rework — **superseded by the simpler free-text model** (see status above): a constraint is one plain-language `expression`; the structured fields/target-picker were removed.
- [x] **Properties** key/value editor on nodes and edges (node `attributes` / edge `properties`, with real key removal).
- [x] **Description perspectives** — `perspectives: [{ label, text }]` blocks on nodes and edges.
- [x] **Drop the node Notes field** — removed; legacy `notes` migrates to a "Notes" perspective on load.
- [x] **Cost resource + resource attachment** — **superseded by resources-as-canvas-nodes**: `cost` is a resource-node kind with `cost_rate`/`basis_unit` as properties; attachment is an `allocation` edge (nodes and edges can both point at a resource node). The catalog + `resources_required` editors were removed.

Data model / schema changes (version `schema/process-graph.schema.json`; Propel guardrail:
no unversioned schema changes):
- Edge: add `properties` (object), `perspectives` (array of `{label, text}`), `description` + `description_status` (definition pattern extended to edges), and `resources_required` (same item shape as node `resources_required`).
- Node: add `perspectives` (array of `{label, text}`); keep `attributes` as the Properties store; deprecate `notes` (tolerated, not edited).
- Resource: add `cost` to the `type` enum; allow free-text `basis_unit` in resource `attributes` (shown alongside `cost_rate` when type = cost); add `description` + `description_status`.
- Constraint: add `description` + `description_status`; `target` reference shape + simplified field model.
- Touches `suggestNodeDescription`, ontology-sync helpers, `createNode`/`createEdge`/`createResource`/`createConstraint` factories, `applyEnvelopeToState` migration, and Markdown/JSON export.

## Milestone 2: Backend Persistence

Priority: P3 / deferred while the current goal is frontend authoring and local-file export.

### P1-1 FastAPI Service Hardening

Move from scaffold to a hardened service that the frontend can opt into.

Status: substantially done (2026-06-01).

Acceptance:
- [changed] ~~Frontend calls backend by default in dev.~~ Superseded: the default is now
  **local-file/offline mode** (see Status, Direction). The frontend instead *opts into* the
  backend via the `process-graph-builder-api-base` setting; backend mode must remain optional.
- [x] `GET /graph/{id}`, `POST /graph/mutate`, `POST /graph/assist`, and Markdown export are stable (covered by the backend test suite).
- [x] API errors appear in the chat/log without losing local graph state — assist failures post a chat warning; sync failures post a mutation-log entry; both toast. Local state stays authoritative.
- [x] Backend contracts use Pydantic v2 request models (`Mutation`, `MutateRequest`, `AssistRequest`), ready to move into a future `propel_schemas` package.
- [ ] Low-priority hardening: bind `tenant_id` to authenticated identity before production
  use; the current `X-Tenant-Id` header is tenant scoping, not authorization.
- [ ] Low-priority hardening: prevent lost updates on concurrent `POST /graph/mutate`
  calls (JSON-file locking and/or Cosmos ETag/optimistic concurrency).
- [ ] Low-priority hardening: validate and normalize mutation payloads against the graph
  schema before persistence; reject missing required node/edge fields and missing update
  targets instead of upserting invalid objects.
- [ ] Low-priority contract cleanup: return Markdown with an appropriate response type and
  keep backend Markdown export aligned with the richer frontend Markdown/JSON export
  contract.

Routes are intentionally sync `def` (blocking JSON/Cosmos-sync I/O runs in FastAPI's
threadpool); switch to `async def` only when the store offers async I/O (`azure.cosmos.aio`).

### P1-2 Durable Graph Storage

Persist graph envelopes durably. Target is **Azure Cosmos DB**, with a local JSON file
store as the dev-compatible substitute (selected by the `COSMOS_URI` env var).

Status: partially done (2026-06-01). A storage abstraction (`GraphStore`) ships with two
backends — `JsonFileStore` (dev default) and `CosmosGraphStore` (graphs partitioned by
`/id`, mutation batches by `/graph_id`; Cosmos system fields stripped at the adapter layer).

Acceptance:
- [~] Reload restores graph state across server restarts — backend persists graphs and
  mutation batches; the frontend does not yet rehydrate from the backend on load (local
  mode is authoritative). Cross-session restore via the backend is pending the opt-in flow.
- [~] Storage includes graph JSON, ontology, chat transcript, open questions, mutation log,
  and graph versions (all inside the graph document). Layout, viewport, selected object,
  pending plan, and saved subgraph views are frontend envelope concerns not yet sent to the
  backend.
- [ ] Production-ready records include `tenant_id` before real portfolio-company data is
  used — **not yet** (Propel guardrail: no tenant-less production records). See P1-2a.
- [ ] Saved graph migration from localStorage is tested — not yet.

### P1-2a Tenant Scoping

Add tenant context to durable records before any real portfolio-company data is used
(Propel guardrail: no tenant-less production records). Promoted from a buried acceptance
line in P0-0/P1-2 because it gates production use.

Status: backend done (2026-06-02), 30 tests pass. Tenant resolved via `X-Tenant-Id` header
→ `PROCESS_GRAPH_DEFAULT_TENANT` env → `"default"`; `GraphStore` is tenant-scoped
(`JsonFileStore` namespaces by tenant, `CosmosGraphStore` partitions by `/tenant_id`); graphs
+ mutation batches stamped with `tenant_id`; cross-tenant isolation proven over HTTP; schema v3
adds optional `tenant_id`. **Remaining: frontend wiring** — send `X-Tenant-Id` and surface
tenant in the saved envelope (deferred; pairs with the backend opt-in flow).

Acceptance:
- [x] Graph envelope and Cosmos documents carry `tenant_id`.
- [x] Cosmos partition strategy is tenant-aware (partitioned by `/tenant_id`).
- [x] Reads/writes are scoped to a tenant; cross-tenant access is not possible by default.
- [ ] Frontend sends a tenant and shows it (pending backend opt-in flow).

### P1-3 Version History

Track applied mutation batches as graph versions.

Status: partially done (2026-06-01). The backend records version snapshots and mutation
batches on each `POST /graph/mutate` (capped history); no UI to inspect or restore yet.

Acceptance:
- [ ] User can inspect previous versions — data is recorded; no UI.
- [ ] User can restore a previous version — not yet.
- [~] Version metadata includes timestamp and mutation batch; mutation summary, author/source, and confidence are not yet captured per version.

## Milestone 3: Real LLM Assist

Priority: P1.

### Auth + provider decision (2026-06-01)

Identity is **Microsoft Entra ID** (org SSO); the model provider is the **OpenAI API
(platform)**. Note: a user's ChatGPT-product SSO session does NOT grant API access — ChatGPT
and the OpenAI API are separate, and a browser session cannot be borrowed to call the API.
So the pattern is: **Entra ID secures the app and the backend; the OpenAI key lives behind
the backend.** The LLM call stays server-side (model-router guardrail); SSO ties each call to
a verified user for audit, cost attribution, and access control.

Architecture:

```
Browser (static frontend, MSAL.js)
  1. user signs in with Entra ID -> access token (aud = backend API)
  2. POST /graph/assist  with  Authorization: Bearer <entra token>
       v
FastAPI backend (model-router)
  3. validate Entra JWT (issuer = tenant, audience, signature via JWKS)
  4. authorize (tenant/group) + per-user rate limit / usage cap
  5. read OpenAI key from Azure Key Vault via the backend managed identity
  6. call OpenAI, return strict {summary, mutations, questions, warnings, handoff_readiness}
       v
Browser previews mutations -> user approves -> apply (existing flow)
```

Key handling: store the OpenAI key in **Azure Key Vault**, fetched by the backend's
**managed identity** — so key *storage* stays keyless/Entra-secured even though the final
hop to OpenAI uses a static key.

Distribution implication: this path requires **https hosting + backend** and a registered
SPA redirect URI in the Entra app registration. SSO/OAuth redirects and server-side model
calls cannot run from a `file://` page, so the offline single-file HTML keeps the
deterministic stub only; a real LLM means static-frontend + backend. The stub remains the
offline / unauthenticated fallback.

### P1-4 LLM Mutation Compiler

Replace the browser stub with the backend assist endpoint, backed by OpenAI.

Acceptance:
- Assist endpoint returns strict JSON with `summary`, `mutations`, `questions`, `warnings`, and `handoff_readiness`.
- The prompt preserves IDs, avoids invented numeric values, creates assumptions for uncertain implied facts, and asks questions when structure is ambiguous.
- Frontend can preview returned mutations before applying them.
- All LLM calls go through a model-router abstraction; business logic does not call provider SDKs directly.
- Model output is treated as a proposal, not a fact.
- Structured output is keyed to `schema/mutation.schema.json` (OpenAI tool/JSON-schema response) so the wire stays strict `snake_case`.
- Port the existing `COMPILER_PROMPT` (currently in `app.js`) server-side.
- `/graph/assist` is `async def` using `AsyncOpenAI` (real network latency justifies async here, unlike the sync storage routes).
- The deterministic stub remains the fallback when unauthenticated or the backend/LLM is unreachable.

Suggested build order:
1. Backend: Entra JWT-validation dependency (see P1-4a) + a feature-flagged OpenAI-backed `/graph/assist` (key from Key Vault/env), stub stays default; tests use a mocked OpenAI client.
2. Frontend: MSAL login, attach the bearer token to `requestBackendAssist`, graceful fallback to the local stub.
3. Add `tenant_id` + actor to mutation-batch records (ties into P1-2a).

### P1-4a Entra ID Authentication

Authenticate users with Microsoft Entra ID and protect backend routes.

Acceptance:
- Frontend signs users in via MSAL and sends an `Authorization: Bearer` token.
- Backend validates the Entra JWT (issuer/tenant, audience, signature via JWKS) on protected routes; rejects invalid/expired tokens with 401.
- Authorization restricts access by tenant and/or Entra group.
- Per-user rate limiting / usage caps guard the shared OpenAI key (any signed-in user can spend on it otherwise).
- CORS is restricted to the real frontend origin (not `*`).
- Validated user identity flows into audit records (actor/source on mutation batches).

### P1-5 Clarification Loop

Persist assistant questions and user answers as structured context.

Acceptance:
- Follow-up answers resolve prior ambiguity.
- Clarification does not create disconnected graph fragments.
- Questions remain visible until resolved or dismissed.

### P1-6 LLM Node Definitions

Use the LLM to suggest node definitions based on node name, type, graph context, connected flows, and ontology.

Acceptance:
- New nodes receive suggested definitions.
- User can approve, edit, or regenerate definitions.
- Approved definitions sync into ontology.

### P1-7 LLM Authoring Assist (free-text guidance)

Direction (2026-06-03): all free-text fields stay free-text with **hint/example placeholders for
good structure** (the constraint help-tip is the first instance). An integrated LLM should later
**guide the user's writing** of these fields toward well-structured values — objectives,
design-space constraints, constraints, perspectives, and quantitative-parameter notes.

Acceptance:
- Free-text fields show example/hint placeholders (no enforced enums).
- LLM offers inline suggestions/rewrites for the active field; user accepts/edits.
- Treated as a proposal (human approves); no hidden prompts (inspectable).

## Milestone 4: Decision-Grade Modeling

Priority: P2.

### P2-1 Profile-Aware Validation

Expand validation by modeling style.

Status: done (2026-06-02). `profileValidationItems` emits per-style plain-language hints
(business_process: start/end + decision branches; value_stream: label flow kinds; system_flow:
node ports; team_topology: team/interaction presence; none/custom: none). All warn/info, never
error; read-only (style never mutates the graph). Verified in-browser.

Acceptance:
- [x] Business process, value stream, system flow, team topology, and custom profiles produce different guidance.
- [x] Validation hints stay plain-language.
- [x] Selected style never destructively changes the graph.

### P2-2 Constraint Templates — RETIRED (2026-06-02)

Superseded by the free-text constraint model (P0-6): a constraint is now a single
plain-language statement, authored directly, with a help tip suggesting how to phrase it as a
relationship between inputs, properties, outputs, resources, or capacity. The structured
template/operator/value approach was explicitly removed. If solver/optimization readiness later
needs more structure, revisit as a NEW item rather than reinstating templates.

### P2-3 Solver and Agent Handoff Export

Expand export for downstream tools.

Status: done for the frontend export (2026-06-02). The JSON envelope now carries graph, ontology,
assumptions, open questions, mutation history, versions, saved views, validation, notation
profile, artifact metadata, and a derived `handoff_readiness`. Markdown gained Assumptions /
Open Questions / Validation / Handoff Readiness / Saved Views sections. Verified in-browser.

Acceptance:
- [x] JSON and Markdown include graph, ontology, validation status, assumptions, open questions, mutation history, versions, saved views, and handoff readiness.
- [x] Exported JSON can recreate the graph state (full envelope + Import JSON round-trip).
- [~] Export structure is friendly to simulation/optimization/GNN workflows — present in JSON; deeper solver-specific shaping is a future refinement.

## Milestone 5: Design-Space Definition

Priority: P1 — the immediate follow-up to as-is mapping (direction set 2026-06-03).

Status (2026-06-03): **built + browser-verified.** DS-1 (parameter promotion with uncertainty +
decision domain on node/edge properties), DS-5 (node variants + adoption cost/time + "create
variant"), DS-6 (flow value/cost economics), DS-7 (edge change-moves: reroutable/eliminable +
cost/time), DS-2 (objectives/budgets/notes authoring dialog + derived-variables view), and DS-3
(`buildDesignSpace` + `design_space` in the export envelope + "Export design space" download) are
done. Schema bumped to **v5** to accept the annotations. **DS-4 (import/diff returned candidates)
is deferred** — no external search producing candidates yet. LLM authoring assist (P1-7) held.

Scope clarification (2026-06-03): this tool's job for alternatives is to **define the design
space** — declare which things can vary, their allowed values, what's fixed, the constraints on
valid combinations, and the objectives. A **separate algorithm/tool searches/optimizes** over
that space and returns candidate graphs. **This tool does NOT generate or score variants itself**
(that's the solver — Propel guardrail: solvers handle optimization). Here we author the parametric
space and export it; we can import and visualize what the search returns.

### Concept: the as-is graph becomes parametric where you choose
- **Decision variables** — mark things that may vary:
  - a node/edge **property** holds *either* a fixed value *or* a **variable with a domain** —
    a discrete option set (`{steel, aluminum}`), a numeric **range** (`[40, 60] s`, optional
    step), or continuous. Layers on the existing free-form Properties.
  - **structural** variability — an element optional (include/exclude), or a one-of-N choice
    among alternative subpaths/edges/resources.
  - **resource allocation** choices (which resource, how many).
- **Fixed vs free** — everything is fixed (the as-is) unless declared a variable.
- **Space constraints** — relationships that limit valid combinations (e.g. "if material =
  aluminum then machine = B"). Reuse the free-text, element-owned constraint model, tagged as
  design-space constraints.
- **Objectives / budgets** — the dimensions the external search optimizes: **feasibility**,
  **uncertainty**, **margin gain**, against **change cost/time** budgets. Declared here, not
  computed here.

### Items
- DS-1 Variable model: a property/element can carry a `variable` spec (domain: enum / range /
  optional / choice) instead of a fixed value; `snake_case` on the wire.
- DS-2 Design-space constraints + objectives: author space-level constraints and the objective/
  budget set (feasibility, uncertainty, margin_gain, change_cost, change_time).
- DS-3 **Export the `design_space` artifact** — the structured handoff (variables, domains,
  fixed set, constraints, objectives) for the external search/optimization tool. This is the
  primary deliverable of this milestone. Proposed shape drafted: `schema/design-space.schema.json`
  + worked example in `DESIGN_SPACE.md` (awaiting review).
- DS-4 Import & compare returned candidates: load the candidate graphs the search returns and
  diff/compare them against the base — **reuse the greyscale pending-preview rendering** for
  base-vs-candidate highlighting (the one piece of the old V-2 that stays here).
- Out of scope (external solver/tool): generating variants, searching the space, computing
  margin/feasibility scores.

### Model clarifications (2026-06-03)
- **Output = a JSON structure + knowledge graph; an LLM converts the graph into the search
  tool.** The design space need NOT be directly solver-parseable — but the data must be cleanly
  **structured (typed fields + labels + free-text alongside) so the LLM conversion is easy.**
- **Uncertainty is per quantitative parameter.** Each quantitative property value can carry an
  uncertainty (low/high band, ±, or confidence). Distinguish a *decision-variable range* (a value
  we choose) from an *uncertain value* (one we don't control); a parameter may be both.
- **Change cost/time is defined by the design move.** The moves that carry a change cost + time:
  - **Reroute a flow** — point an edge from/to a different node.
  - **Invest in a node** to change its properties — often modeled as **a new variant node** (a
    copy of the original with different properties) + a **new flow to it**; adopting the variant
    carries an investment cost + time.
  - **Eliminate a flow** — remove an edge that isn't profitable for the network.
- New modeling needs this implies:
  - DS-5 **Node variants** — mark a node as a variant of another (`variant_of`), each variant
    carrying its differing properties + an adoption `cost`/`time`. The design space chooses which
    variant is active.
  - DS-6 **Flow economics** — value/cost per flow (and per node) so the search can assess
    profitability and "keep vs eliminate." Captured as quantitative parameters (with uncertainty).
  - DS-7 **Change-move annotations** — flows/edges flagged reroutable / eliminable with their
    change `cost`/`time`, so the move set + its budget are explicit in the export.

### Decision: quantitative fields live in the free-form Properties (2026-06-03)
- The **node/edge Properties** key/value editor is the home for quantitative fields — cost,
  time, quantity, throughput, etc. live there.
- **Do NOT over-define units/types up front.** Exact units aren't known until a system is
  mapped, so properties stay flexible "fields to fill": the value carries the number + unit as
  discovered (e.g. `cycle_time: 45 s`, `throughput: 100 kg/h`, `cost: 4.50 USD/unit`). No
  enforced schema, no rigid typing.
- **The external search parses property values loosely** (extract number + unit) when scoring
  cost/margin — this tool just captures them flexibly; it does not score.
- A variable property's domain (enum/range) is authored against the same property key the as-is
  fixed value uses, so a base graph upgrades to parametric in place.
- Resource `cost_rate`+`basis_unit` already follow this pattern. Keep ids stable (done) and
  treat mutation batches as the delta unit (done).
- DS-4 reuses the existing greyscale pending-preview rendering for base-vs-candidate diff.

## Public Interfaces

- Preserve current mutation actions and graph schema shape.
- Use `snake_case` for public JSON, API payloads, saved envelopes, artifact names, and future database/Pydantic fields.
- Keep edge `flows[]` first-class for cash, energy, parts, information, data, work, approval, or custom movement.
- Constraints are free-text statements (one per constraint); `type` is retained in data (default, hidden) for back-compat. Resources are canvas nodes (`type: resource`) consumed via `allocation` edges, not a separate catalog.
- Treat notation profiles as visual overlays, not schema forks.
- Treat subgraph views as saved filters/focus sets, not graph mutations.
- Treat all LLM and solver outputs as proposals requiring human approval before operational use.

## Test Plan

- Browser smoke tests for chat send, clarification loop, pending preview, apply/discard, undo, panel collapse, inspector edits, pan/zoom/minimap, notation profile switching, save/load (incl. JSON import/export round trip), and subgraph views.
- Schema tests for graph JSON, mutation JSON, saved graph envelope, saved views, and LLM assist response shape.
- [x] Backend tests for mutate/get/assist/export — done (`backend/tests/`, includes the storage-selection + JSON store tests). Cosmos backend needs a live account/emulator and is not yet covered.
- Persistence tests for graph reload, graph version restore, and localStorage migration.
- Export regression tests for Markdown and JSON round trip.

Note: a JS test runner is not yet set up, so frontend logic (compiler, validation,
`resolveView`) is currently verified manually; see `REFACTOR_PLAN.md` Option A for making
the deterministic core unit-testable.

## Assumptions

- ~~UI polish gates backend work, and the UI is now good enough to proceed.~~ Superseded:
  backend work has proceeded in parallel (Pydantic, Cosmos, tests).
- Backend is **FastAPI**; durable persistence target is **Azure Cosmos DB**, with a local
  JSON file store as the dev substitute (was "JSON graph persistence" / Postgres).
- The app supports two coexisting modes — local-file/offline (default) and optional backend
  — rather than backend-by-default.
- Current browser compiler (deterministic stub) remains until a real LLM is wired behind
  `POST /graph/assist`; the backend `assist` endpoint is also a stub today, not an LLM.
- Save/load started local (file Export/Import) and extends to backend persistence without
  changing the graph envelope.
