# Propel Alignment

This app should be treated as the first Propel Process Mapper / Graph Builder wedge, not as a generic diagramming tool.

Propel context:

- Propel maps operational processes into structured models.
- The graph model is an inspectable digital-twin artifact.
- LLMs propose graph mutations and explanations.
- Humans approve meaningful changes.
- Solvers, not LLMs, eventually handle scheduling and optimization.
- Every meaningful output should be replayable, auditable, and exportable.

## Product Role

This app sits primarily across these Propel service boundaries:

- `process_mapper`: turns messy plain-language or structured input into validated process JSON.
- `graph_builder`: turns process models into graph snapshots, ontology entries, relationships, and graph projections.
- `explanation`: explains graph structure, constraints, missing information, and handoff readiness.
- `memory`: captures reusable process templates, constraint patterns, graph patterns, and playbooks.

It should not become:

- a generic chatbot-first UX
- a workflow execution engine
- a production scheduler
- an approval authority
- a direct ERP/MES/WMS writeback mechanism

## Architecture Implications

Near-term:

- Keep the current mutation model.
- Add save/load and graph envelope persistence.
- Move LLM assist behind a backend service.
- Treat all model output as proposed mutations.
- Preserve preview, apply, discard, undo, and audit log behavior.

Medium-term:

- Move schemas toward Pydantic models under a future `propel_schemas` package.
- Route all LLM calls through a model-router abstraction.
- Persist durable artifacts for graph snapshots, mutation batches, exports, and approvals.
- Add tenant context before any production or portfolio-company data enters the system.
- Add approval gates before any operational writeback or solver-driven recommendation can be treated as executable.

## Naming Convention

Use `snake_case` for all public and persisted contracts:

- API request and response fields
- graph JSON fields
- mutation JSON fields
- saved graph envelope fields
- artifact file names
- database columns
- Pydantic model fields
- exported JSON and Markdown metadata keys

Examples:

- `graph_id`
- `target_id`
- `created_at`
- `resources_required`
- `description_status`
- `handoff_readiness`
- `open_questions`
- `mutation_log`
- `saved_views`
- `tenant_id`
- `artifact_id`
- `approval_gate_id`

Private JavaScript implementation may remain idiomatic camelCase when it does not leak into saved state, API payloads, or exported artifacts. If a JavaScript variable is serialized, persisted, or sent over an API, prefer the `snake_case` public name or explicitly map it at the boundary.

## Artifact Expectations

Future save/load and backend work should make these artifacts natural:

- `raw_input_snapshot.json`
- `process_model.v1.json`
- `process_graph.v1.json`
- `graph_snapshot_manifest.json`
- `mutation_batch.json`
- `ontology_snapshot.json`
- `validation_report.json`
- `handoff_readiness.json`
- `approval_request.json`
- `audit_bundle.json`

Artifacts should include enough information to replay or audit a result:

- input data or source reference
- graph version
- mutation batch
- compiler prompt version
- assumptions
- open questions
- validation status
- actor/source
- timestamp

## Domain Vocabulary

Prefer Propel domain terms where they fit:

- `tenant`
- `facility`
- `line`
- `work_center`
- `machine`
- `labor_role`
- `shift`
- `calendar`
- `sku`
- `route`
- `operation`
- `operation_step`
- `queue`
- `constraint`
- `changeover`
- `cycle_time`
- `yield_rate`
- `work_order`
- `schedule`
- `scenario`
- `proposal`
- `approval_gate`
- `decision`
- `outcome`
- `artifact`
- `audit_event`
- `template`
- `skill`
- `playbook`

The current app vocabulary can remain broad enough for cash, energy, parts, information, work, approval, and custom flows, but Propel-specific templates should increasingly map user language into these canonical concepts.

## Knowledge Graph Direction

Future graph projection should support relationships such as:

- `ROUTE_HAS_OPERATION`
- `OPERATION_PRECEDES_OPERATION`
- `OPERATION_RUNS_ON_MACHINE`
- `OPERATION_REQUIRES_LABOR_ROLE`
- `CONSTRAINT_LIMITS_RESOURCE`
- `SCHEDULE_ALLOCATES_WORK_ORDER`
- `DECISION_BASED_ON_OPTIMIZATION_RUN`
- `OUTCOME_MEASURES_DECISION`
- `TEMPLATE_DERIVED_FROM_DEPLOYMENT`

The UI graph does not need to expose these relationship names to users. The chat and inspector should stay high-school-readable while the export/projection layer can emit stricter Propel relationships.

## Guardrails

- Agents recommend. Humans decide.
- No direct operational writeback without approval gates.
- No direct model-provider calls from business logic.
- No model-generated schedule without solver validation.
- No hidden prompts that cannot be inspected.
- No unversioned schema changes.
- No tenant-less production records.
- No one-off solution that cannot become reusable memory.
