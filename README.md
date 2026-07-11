# Process Graph GPT + Canvas

Decision-grade process structure builder MVP.

## What It Includes

- Canonical `ProcessGraph` state as the source of truth
- Mutation commands for graph edits
- Chat-style deterministic mutation compiler with optional server-side LLM assist behind a feature switch
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

The backend selects its storage layer from the environment. Set `PROCESS_GRAPH_STORE_KIND` to force a backend:

- `json` - local JSON file
- `cosmos` - Azure Cosmos DB for NoSQL
- `azure_sql` - Azure SQL Database

If `PROCESS_GRAPH_STORE_KIND` is unset, the app keeps the existing auto-detect behavior: `COSMOS_URI` selects Cosmos, then an Azure SQL connection string selects Azure SQL, otherwise local JSON is used.

- **Local JSON file (default):** graphs, saved frontend envelopes, and mutation batches persist to the path in `PROCESS_GRAPH_STORE` (defaults to `backend/data/graphs.json`). Good for single-user dev; no Azure dependency needed at runtime.
- **Azure Cosmos DB for NoSQL:** the current backend compatibility store keeps graphs and mutation batches in tenant-partitioned NoSQL containers and detaches embedded `source_artifacts.content` before Cosmos writes, leaving lightweight `artifact_refs` on the graph. The property-graph projection is exposed separately through `GET /graph/{id}/property-graph` and can be synced to Cosmos DB for Apache Gremlin with `POST /graph/{id}/property-graph/sync`.
- **Azure SQL Database:** graphs and saved frontend envelopes are stored as canonical JSON documents in `process_graphs`; mutation batches are appended to `process_graph_mutation_batches`. Both tables are keyed by `tenant_id`, and the API contract stays the same document-shaped JSON used by Cosmos.
- **Artifact ledger:** full imported/exported JSON artifacts, Plant JSON snapshots, and LLM-edited artifact versions are stored outside the live graph. Local dev uses `PROCESS_GRAPH_ARTIFACT_STORE` (defaults to `backend/data/artifacts.json`); the Azure SQL target schema lives in `schema/artifact-ledger.sql`. Graph records point to these rows/files with `artifact_refs` rather than embedding multi-megabyte JSON in Cosmos.

`GET /healthz` returns the selected storage backend in its `storage` field.

Cosmos and artifact environment variables:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `COSMOS_URI` | yes (to enable Cosmos NoSQL store) | N/A | Account endpoint URL for the compatibility graph-document store |
| `COSMOS_KEY` | no | N/A | Account key; if omitted, `DefaultAzureCredential` (managed identity / `az login`) is used for the NoSQL store |
| `COSMOS_DATABASE` | no | `process_graph_builder` | Database name for the NoSQL store and default Gremlin database name |
| `COSMOS_GRAPHS_CONTAINER` | no | `graphs` | Tenant-partitioned graph document container |
| `COSMOS_MUTATION_BATCHES_CONTAINER` | no | `mutation_batches` | Tenant-partitioned audit log of applied mutation batches |
| `COSMOS_CREATE_IF_MISSING` | no | `true` | Create NoSQL database/containers on startup; set `false` if the app identity lacks control-plane rights |
| `PROCESS_GRAPH_ARTIFACT_STORE` | no | `backend/data/artifacts.json` | Local artifact ledger fallback for full JSON artifacts |
| `PROCESS_GRAPH_PROPERTY_GRAPH_SYNC_STORE` | no | `backend/data/property-graph-sync.json` | Local fallback receipt/projection store for property-graph syncs |
| `COSMOS_GREMLIN_ENDPOINT` | yes (to enable Gremlin sync) | N/A | Full WebSocket endpoint, for example `wss://<account>.gremlin.cosmos.azure.com:443/` |
| `COSMOS_GREMLIN_HOST` | yes (alternative) | N/A | Gremlin host used when the full endpoint is not set |
| `COSMOS_GREMLIN_DATABASE` | no | `COSMOS_DATABASE` or `process_graph_builder` | Gremlin database name |
| `COSMOS_GREMLIN_GRAPH` | no | `process_graph` | Gremlin graph collection name |
| `COSMOS_GREMLIN_KEY` | yes (for live Gremlin writes) | `COSMOS_KEY` | Gremlin account key; dry runs can report target config without a key |

Cosmos must be a Cosmos DB for NoSQL account endpoint such as `https://<account>.documents.azure.com:443/`. A Gremlin endpoint such as `wss://<account>.gremlin.cosmos.azure.com:443/` is not compatible with the NoSQL graph-document adapter.

The Gremlin writer follows the Azure Cosmos DB for Apache Gremlin Python connection shape: `wss://...gremlin.cosmos.azure.com:443/`, username `/dbs/{database}/colls/{graph}`, and GraphSON v2 serialization. It is intentionally lazy: local/test runs use the JSON sync writer unless `COSMOS_GREMLIN_ENDPOINT` or `COSMOS_GREMLIN_HOST` is set.

Azure SQL environment variables:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `AZURE_SQL_CONNECTION_STRING` | yes (to enable SQL) | - | ODBC connection string. `SQL_CONNECTION_STRING` is also accepted as a fallback name. |
| `AZURE_SQL_CREATE_IF_MISSING` | no | `true` | Create tables/indexes on startup; set `false` if schema is managed separately. |
| `AZURE_SQL_GRAPHS_TABLE` | no | `process_graphs` | One- or two-part table name for graph documents and saved frontend envelopes. |
| `AZURE_SQL_MUTATION_BATCHES_TABLE` | no | `process_graph_mutation_batches` | One- or two-part table name for mutation-batch audit records. |

Example Azure SQL connection string:

```text
Driver={ODBC Driver 18 for SQL Server};Server=tcp:<server>.database.windows.net,1433;Database=<database>;Authentication=ActiveDirectoryMsi;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;
```

For local Azure SQL testing, use Python 3.12 and install the optional SQL dependency set:

```powershell
cd backend
pip install -r requirements-azure-sql.txt
```

### Optional LLM assist

LLM assist is off by default. To expose it, run the FastAPI backend with:

```powershell
$env:PROCESS_GRAPH_LLM_ASSIST_ENABLED = "true"
$env:OPENAI_API_KEY = "..."
# Optional; defaults to gpt-5.5
$env:PROCESS_GRAPH_LLM_MODEL = "gpt-5.5"
```

Then turn on **LLM assist** in the left chat panel. The browser still previews returned mutations before anything is applied. If the server flag is off, the key/package is missing, or the provider call fails, `/graph/assist` returns the deterministic compiler result with a warning. The request includes the current graph snapshot and recent chat messages so the model does not plan against stale persisted state.

The server prompt includes domain examples for DTA/data-to-action, network/distribution, manufacturing, and plant/structured-MILP authoring. The plant example is intentionally informed by `PLANT-JSON-SCHEMA.md`, `PLANT-PIPELINE.md`, and `norprod.json`, but it avoids treating NOR stage names as the abstraction. It teaches the model to preserve reusable optimization structure: node roles, stable IDs, node-property names, `variableType`, units, `timeConfig`, relationship constraints, and objective hints as graph metadata for future exporters without embedding contracts into plant topology.


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

The local compiler remains the offline deterministic fallback. A FastAPI-compatible backend exists under `backend/` with `GET /graph/{id}`, `GET /graph/{id}/envelope`, `PUT /graph/{id}/envelope`, `GET /graphs`, `GET /session`, `POST /graph/mutate`, `POST /graph/assist`, `GET/POST /graph/{id}/artifacts`, `GET /graph/{id}/property-graph`, `POST /graph/{id}/property-graph/sync`, and `GET /graph/{id}/export/md`. The backend also serves the static frontend when run as the full app. The backend assist endpoint can use a server-side OpenAI-backed compiler only when `PROCESS_GRAPH_LLM_ASSIST_ENABLED=true` and the request sets `use_llm: true`; otherwise it returns the deterministic fallback compiler.

Ontology is stored inside the graph and can be inferred from current graph contents. Directed edges imply precedence, while edge flow payloads describe what moves. Constraint `expression` is kept for export compatibility, but the UI now edits structured fields and regenerates the expression.

Notation profiles are visual overlays on the same graph schema. Business process uses BPMN-inspired events, tasks, gateways, and flows; value stream uses Lean VSM-inspired process boxes and material/information flow; system flow uses SysML/UML-inspired blocks, ports, and connectors; team topology uses Team Topologies-inspired team and interaction shapes.

Public graph/API/artifact contracts use `snake_case`. Private JavaScript internals may stay idiomatic, but persisted or exported fields should map to the public `snake_case` contract.
