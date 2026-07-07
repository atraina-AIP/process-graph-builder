# Process Graph GPT + Canvas

Decision-grade process structure builder MVP.

## What It Includes

- Canonical `ProcessGraph` state as the source of truth
- Mutation commands for graph edits
- Chat-style mutation compiler stub that returns strict JSON
- SVG canvas with draggable nodes and edge selection
- Explicit input/output ports on node edges, with multiple ports inferred from node inputs, outputs, and connected edges
- Collapsed modeling style selector for none, business process, value stream, system flow, team topology, or custom guidance
- Inspector-based node, edge, resource, and constraint editing
- Editable node definitions with assistant-suggested wording, approval status, and ontology sync
- Edges with typed flow payloads for parts, cash, energy, information, data, work, approval, or custom flows
- Notation profiles behind modeling styles, with style-specific node shapes, edge styles, ports, and a standards-grounded legend
- Editable ontology tab with inferred/searchable definitions for modeling styles, node types, edge types, flow types, constraint types, resource types, and properties
- Extendable node resource requirements with resource name and quantity
- Structured constraints for flow balance, capability limits, timing, routing rules, and policy rules
- Validation for orphan nodes, decision branches, edge references, conditions, incomplete constraints, and cycles
- Markdown export containing graph spec, assumptions, questions, and JSON
- Fully frontend-only file workflow: Export JSON saves the full graph state to a `.json` file, and Import JSON loads it back, with no backend required

## Run

From this folder:

```powershell
python -m http.server 4173
```

Then open:

```text
http://localhost:4173/
```

The app is dependency-free and can also be opened directly from `index.html`.

To run the full app through FastAPI:

```powershell
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

Docker Compose is also available:

```powershell
docker compose up --build
```

### Frontend-only save and load (no backend)

The app runs fully in the browser with no backend. State persists to `localStorage`
automatically, and you can move a graph between machines or share it as a file:

- **Export JSON** writes the complete state (graph, layout, mutation log, open
  questions, chat history, ontology, notation profile, and validation) to a
  `.json` file using `snake_case` wire keys.
- **Import JSON** reads such a file back and restores the full state, round-tripping
  what Export produced. It also accepts a bare graph object (just `nodes`/`edges`)
  and older `localStorage`-shaped files. Invalid files are rejected with a toast
  rather than breaking the app.

This uses a classic file download/upload, so it works even when `index.html` is
opened directly from `file://`. The backend is additive, not required for local
file authoring.

When the frontend is served by FastAPI or the Docker container, it calls the same-origin backend automatically. If you host the static files separately during local development, point the browser at the API:

```js
localStorage.setItem("process-graph-builder-api-base", "http://127.0.0.1:8000")
```

### Cloud save and load

For cloud deployment, serve the static frontend and FastAPI backend from the same origin. The app will:

- hydrate the current graph from `GET /graph/{graph_id}/envelope` on load
- save the full frontend envelope with `PUT /graph/{graph_id}/envelope`
- populate the Library dialog from `GET /graphs`
- derive `tenant_id` from Azure App Service Easy Auth headers, with `X-Tenant-Id` and `PROCESS_GRAPH_DEFAULT_TENANT` as local/dev fallbacks

Enable App Service Authentication with a Microsoft identity provider when deploying behind Azure App Service. The frontend does not need a secret; the backend reads the signed-in user context from `X-MS-CLIENT-PRINCIPAL`.

### Backend storage

The backend selects its storage layer from the environment:

- **Local JSON file (default):** used when `COSMOS_URI` is unset. Graphs, saved frontend envelopes, and mutation batches persist to the path in `PROCESS_GRAPH_STORE` (defaults to `backend/data/graphs.json`). Good for single-user dev; no Azure dependency needed at runtime.
- **Azure Cosmos DB:** used when `COSMOS_URI` is set. Graphs and mutation batches are stored in separate containers, both partitioned by `/tenant_id`. Full frontend state is stored privately on graph documents as `frontend_envelope`; Cosmos-managed fields and private envelope fields are stripped before graphs are returned, so the public contract stays clean `snake_case`.

Cosmos environment variables:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `COSMOS_URI` | yes (to enable Cosmos) | — | Account endpoint URL |
| `COSMOS_KEY` | no | — | Account key; if omitted, `DefaultAzureCredential` (managed identity / `az login`) is used |
| `COSMOS_DATABASE` | no | `process_graph_builder` | Database name |
| `COSMOS_GRAPHS_CONTAINER` | no | `graphs` | Graph documents |
| `COSMOS_MUTATION_BATCHES_CONTAINER` | no | `mutation_batches` | Audit log of applied batches |
| `COSMOS_CREATE_IF_MISSING` | no | `true` | Create database/containers on startup; set `false` if the app identity lacks control-plane rights |

Run the backend tests with:

```powershell
cd process-graph-builder
pip install -r backend/requirements-dev.txt
python -m pytest backend/tests -q
```

## Files

- `index.html` - application shell
- `styles.css` - product UI and canvas styling
- `app.js` - graph state, mutation engine, compiler stub, validation, and export
- `BACKLOG.md` - milestone backlog and test plan
- `PROPEL_ALIGNMENT.md` - Propel product, architecture, artifact, and naming guardrails
- `backend/main.py` - FastAPI scaffold for graph get/mutate/assist/Markdown export
- `Dockerfile` / `docker-compose.yml` - containerized full-app runtime
- `.github/workflows/build.yml` - GitHub Actions image build and ACR push workflow
- `assets/process-graph-concept.png` - generated visual concept used for implementation direction

## MVP Notes

The local compiler is a deterministic browser-side stub. A FastAPI-compatible backend exists under `backend/` with `GET /graph/{id}`, `GET /graph/{id}/envelope`, `PUT /graph/{id}/envelope`, `GET /graphs`, `GET /session`, `POST /graph/mutate`, `POST /graph/assist`, and `GET /graph/{id}/export/md`. The backend also serves the static frontend when run as the full app. The backend assist endpoint currently uses a deterministic fallback compiler so the wire shape is ready before an external LLM provider is configured.

Ontology is stored inside the graph and can be inferred from current graph contents. Directed edges imply precedence, while edge flow payloads describe what moves. Constraint `expression` is kept for export compatibility, but the UI now edits structured fields and regenerates the expression.

Notation profiles are visual overlays on the same graph schema. Business process uses BPMN-inspired events, tasks, gateways, and flows; value stream uses Lean VSM-inspired process boxes and material/information flow; system flow uses SysML/UML-inspired blocks, ports, and connectors; team topology uses Team Topologies-inspired team and interaction shapes.

Public graph/API/artifact contracts use `snake_case`. Private JavaScript internals may stay idiomatic, but persisted or exported fields should map to the public `snake_case` contract.
