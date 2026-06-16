# Frontend-Only Feasibility: Load/Save Graphs as JSON Files

**Verdict: Highly feasible — this is a small change.** The app already runs with zero backend, already persists locally, and already _saves_ graphs to a `.json` file. The only missing piece for a true file-based round-trip is an **import (LOAD)** handler. Estimated effort: roughly 30–60 lines of JS plus one toolbar button.

All file/line references below are to `app.js` and `index.html` in this project unless noted otherwise.

---

## 1. Current state — the app is already effectively frontend-only

The backend is strictly optional, and the code is written to fall back to a local deterministic path whenever no API base is configured.

- **`apiBase()`** (`app.js:1191`) returns `localStorage["process-graph-builder-api-base"] || window.PROCESS_GRAPH_API_BASE || ""`. Out of the box both are unset, so `apiBase()` returns `""` (falsy).
- **`requestBackendAssist(message)`** (`app.js:1124`): first line is `const base = apiBase(); if (!base || ...) return null;` (`app.js:1125-1126`). With no base it returns `null` immediately — no network call.
- **`syncBackendMutations(mutations)`** (`app.js:1144`): same guard, `if (!base || !mutations.length) return;` (`app.js:1146`). With no base it is a no-op.
- The assist flow in **`planFromInstruction()`** (`app.js:1111`) is explicitly written as a fallback chain: `pendingPlan = (await requestBackendAssist(message)) || compileWithClarification(message);` (`app.js:1113`). When the backend returns `null`, planning falls through to the **local deterministic compiler** (`compileInstruction`, `app.js:3156`, via `compileWithClarification` at `app.js:1195`).
- Even network _failures_ degrade gracefully: `notifyBackendFailure` / `notifyBackendSyncFailure` (`app.js:1164`, `app.js:1177`) only toast/log and let the local path stay authoritative. The README confirms this design (README.md:65: "The backend assist endpoint currently uses a deterministic fallback compiler...").

**What the backend actually adds today (and would be "lost" in a pure frontend build):**

1. **Cross-device / server-side persistence.** `app/main.py` writes graphs through `JsonFileStore` or `CosmosGraphStore` and keeps `mutation_batches` + per-graph `versions` server-side. The frontend only persists to this browser's `localStorage`.
2. **A second copy of assist/mutate logic over the wire** — but note this is *not* a real LLM. `compile_assist_message` (`app/main.py`) is the same kind of deterministic split-on-arrows stub as the frontend's `compileInstruction`. So today there is **no real LLM to lose** — the backend is a placeholder for a *future* server-side model router (see PROPEL_ALIGNMENT.md:37, "Move LLM assist behind a backend service").

**Bottom line:** The full authoring experience — chat-to-mutation planning, preview/apply/discard, undo, inspector editing, resources, constraints, validation, ontology, notation profiles, Markdown/JSON export — all works with zero backend today. The backend is a forward-looking scaffold, not a runtime dependency.

---

## 2. What "load/save JSON files" requires

### SAVE — already done

- **`exportEnvelope()`** (`app.js:3598`) builds the artifact object.
- **`downloadGraphJson()`** (`app.js:3627`) serializes it with `JSON.stringify(exportEnvelope(), null, 2)`, wraps it in a `Blob`, and triggers a download via a synthetic `<a download>` click. Wired to `exportJsonButton` (`app.js:845`, button at `index.html:29`).
- `copyGraphJson()` (`app.js:3641`) and `downloadMarkdown()` (`app.js:3613`) round out export.

So writing a `.json` FILE already works with no backend.

### LOAD — the actual gap

There is **no import path today.** Searching `app.js` confirms no `<input type="file">`, no `FileReader`, no `showOpenFilePicker`, and no `importGraph`. State only enters the app via `loadState()` (from `localStorage`, `app.js:907`) or `resetGraph()` (from the bundled sample, `app.js:3651`).

**Key asymmetry to handle (export ≠ raw graph):** `exportEnvelope()` does **not** emit a bare graph. It wraps the graph in an envelope:

```js
// app.js:3598
{
  graph,                       // the actual ProcessGraph
  layout,
  selected,
  mutation_log: mutationLog,   // snake_case on the wire
  open_questions: openQuestions,
  chat_messages: chatMessages,
  ontology: graph.ontology,
  notation_profile: snakeCaseNotationProfile(...),
  validation: validateGraph().items,
  exported_at: "<iso>"
}
```

An importer must therefore **unwrap** the envelope and map the snake_case envelope keys back to the in-memory state variables. Note this is the *same* envelope shape (mostly) that `loadState()` already reconstructs from `localStorage` — except `loadState` reads camelCase keys (`saved.mutationLog`, `saved.openQuestions`, `saved.chatMessages` at `app.js:914-923`), whereas the export envelope uses snake_case (`mutation_log`, `open_questions`, `chat_messages`). The importer must bridge that naming difference.

### Smallest implementation

Add a hidden file input + button and an `importGraphFromFile` handler that reuses the existing load/normalize path:

```html
<!-- index.html, in .topbar-actions near exportJsonButton (~line 29) -->
<button class="button secondary" id="importJsonButton" type="button">Import JSON</button>
<input id="importFileInput" type="file" accept="application/json,.json" hidden />
```

```js
// app.js — register ids in bindElements() (add to list ~app.js:679)
// "importJsonButton", "importFileInput",

// wire in bindEvents() (near app.js:845)
els.importJsonButton.addEventListener("click", () => els.importFileInput.click());
els.importFileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    loadFromEnvelope(parsed);   // see below
    render();                    // render() calls ensureGraphShape() + saveState()
    toast("Graph imported");
  } catch (err) {
    toast("Import failed: invalid JSON");
    console.warn(err);
  } finally {
    e.target.value = "";         // allow re-importing the same file
  }
});

function loadFromEnvelope(data) {
  // Accept either an export envelope ({graph, layout, ...}) or a bare graph.
  const env = data && data.graph ? data : { graph: data };
  if (!env.graph || typeof env.graph !== "object") throw new Error("No graph in file");
  graph = env.graph;
  layout = env.layout || {};
  selected = env.selected || selected;
  // bridge snake_case (export) AND camelCase (localStorage-style) keys
  mutationLog   = env.mutation_log   || env.mutationLog   || [];
  openQuestions = env.open_questions || env.openQuestions || [];
  chatMessages  = Array.isArray(env.chat_messages || env.chatMessages)
                    ? (env.chat_messages || env.chatMessages) : [];
  pendingPlan = null;
  clarificationContext = null;
  ensureGraphShape();   // app.js:958 — the existing normalizer does the heavy lifting
  normalizeLayout();
}
```

The reuse win is **`ensureGraphShape()`** (`app.js:958`): it already defensively coerces every array, backfills `metadata`, validates `modeling_style`, merges the ontology against `DEFAULT_ONTOLOGY`, normalizes nodes/edges/constraints, and re-infers ontology. So an importer does **not** need its own deep validation — feeding the parsed `graph` through `ensureGraphShape()` (which `render()` calls anyway, `app.js:1081`) is enough to harden against partial or hand-edited files. The only validation the importer must add is the outer "is this JSON, and does it contain a `graph` object?" check shown above.

---

## 3. Browser API options & trade-offs

| Option | Pros | Cons |
|---|---|---|
| **Classic `<input type=file>` + `<a download>`** (current save approach) | Works **everywhere**, including `file://` (double-click `index.html`); zero new permissions; trivial; matches existing `downloadGraphJson` style | No persistent file handle — "Save" always re-prompts a new download; can't silently overwrite the originally opened file |
| **File System Access API** (`showOpenFilePicker` / `showSaveFilePicker`) | Real Open/Save UX with a retained `FileHandle`; can overwrite the same file in place; cleaner "working file" model | **Chromium-only** (no Firefox/Safari); requires **secure context** (https or `localhost`) — does **not** work from `file://`; more code (handle lifecycle, permission re-prompts) |

**Recommendation: classic `<input type=file>` for LOAD, keep the existing `<a download>` for SAVE.**

Rationale for this app's "decision-grade, auditable artifact" goal:
- The artifact model is **immutable export**, not in-place editing. Each export already stamps `exported_at` (`app.js:3609`) and bundles `validation`, `mutation_log`, and `ontology`. Producing a fresh, separately-named file per export (rather than silently overwriting) is actually *better* for auditability — it preserves a trail of versioned artifacts.
- It must run from `file://` and any browser. The README explicitly supports opening `index.html` directly (README.md:37); the File System Access API would break that.
- It keeps the change dependency-free and tiny, consistent with the codebase.

The File System Access API can be added later as a progressive enhancement (feature-detect `window.showSaveFilePicker`) for a future "open working file" mode, but it should not be the baseline.

---

## 4. Propel-alignment implications

PROPEL_ALIGNMENT.md and the backlog push toward durable **backend** persistence, `tenant_id`, audit bundles, and server-side LLM (PROPEL_ALIGNMENT.md:37-47, 79-105). A frontend-only file mode should be framed as **complementary, not a replacement**:

- **It is the honest "local file / offline / single-user authoring" mode.** Good for demos, air-gapped review sessions, sharing a graph as an email attachment, and quick iteration without standing up a server. It is explicitly *not* multi-tenant, *not* cross-device, and carries no server-side audit trail.
- **It already speaks the right contract.** The export envelope uses `snake_case` wire keys (`mutation_log`, `open_questions`, `notation_profile`, `exported_at`), per the naming guardrail (PROPEL_ALIGNMENT.md:51-77). So a file written in local mode is forward-compatible with the planned artifacts (`process_graph.v1.json`, `graph_snapshot_manifest.json`, etc., PROPEL_ALIGNMENT.md:82-92) — though the current envelope is *not yet* a versioned, named artifact (no `graph_version`, `artifact_id`, `compiler_prompt_version`; see Risks).
- **Coexistence as a "Local file mode" toggle.** The cleanest framing is a persistence-mode switch alongside the existing optional `apiBase()`:
  - *No `apiBase` set* → **Local file mode**: localStorage + Import/Export JSON files (this proposal).
  - *`apiBase` set* → **Backend mode**: assist/mutate sync to the server, durable artifacts, tenant context, eventual server-side LLM.

  These are not mutually exclusive — file import/export is useful even in backend mode (seed a server graph from a file, export an audit copy). So the recommended posture is: **add file Import/Export unconditionally; let backend persistence remain an additive, optional layer on top.**

---

## 5. Effort estimate, risks & recommendation

### Effort
**Small — roughly half a day including testing.** Concretely:
- ~5 lines HTML (button + hidden file input), `index.html` ~line 29.
- ~2 ids added to the `bindElements()` list (`app.js:679`).
- ~30–40 lines JS: one `change` listener (`bindEvents`, near `app.js:845`) + `loadFromEnvelope` + `importGraphFromFile`.
- Optional polish: confirm-before-overwrite prompt; drag-and-drop a `.json` onto the canvas; relabel "Export JSON" → "Save" / add "Open".

No new dependencies; reuses `ensureGraphShape()`, `normalizeLayout()`, `render()`, `saveState()`.

### Risks
1. **Schema drift between exporter and importer (highest risk).** `exportEnvelope()` emits snake_case (`mutation_log`, `open_questions`, `chat_messages`) while `loadState()` reads camelCase (`saved.mutationLog`, etc., `app.js:914-923`). An importer that only handled camelCase would silently drop the log/questions/chat on a file produced by `downloadGraphJson()`. **Mitigation:** the importer must accept both key styles (shown in §2), and ideally a shared mapping function should be the single source of truth so future schema changes can't desync export vs. import.
2. **`snake_case` contract.** Per global + Propel conventions, anything serialized must be snake_case. The importer is a boundary: read snake_case from the file, assign to camelCase internals — do the mapping in **one** place (PROPEL_ALIGNMENT.md:77, user CLAUDE.md "transform at the API boundary only").
3. **Source-of-truth ambiguity (localStorage vs. file).** After import, `render()` calls `saveState()` (`app.js:1101`) which overwrites `localStorage`. That is the desired behavior (imported file wins), but it silently discards whatever graph was previously in localStorage. **Mitigation:** confirm dialog when the current graph is non-empty/dirty before importing.
4. **Trusting hand-edited files.** Users will edit JSON by hand. `ensureGraphShape()` is robust to missing arrays/fields, but malformed edges/constraints referencing non-existent nodes will surface in the existing validation panel rather than crash — acceptable, and arguably a feature for an auditable tool. Keep the top-level `JSON.parse` in a try/catch (shown).
5. **Not yet a versioned artifact.** The export envelope lacks `artifact_id`, `graph_version`, and `compiler_prompt_version` that PROPEL_ALIGNMENT.md:94-104 wants for replayability. Out of scope for this change, but worth a follow-up: enrich `exportEnvelope()` so local-mode files are first-class audit artifacts.

### Recommendation
**Proceed.** Implement file Import (LOAD) using a classic `<input type=file>` + `FileReader`/`Blob.text()`, feeding parsed JSON through `loadFromEnvelope` → `ensureGraphShape()` → `render()`. Keep the existing `<a download>` for SAVE. This delivers a genuinely backend-free, dependency-free, runs-from-`file://` authoring tool with almost no new surface area, while remaining fully forward-compatible with the Propel backend roadmap as an additive "local file mode." Centralize the envelope↔state key mapping to prevent export/import schema drift, and add a confirm-before-overwrite guard.
