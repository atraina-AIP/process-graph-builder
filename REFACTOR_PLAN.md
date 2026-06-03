# Refactor Plan: `app.js` Modularization

> **Status (revised 2026-06-01):** The full ES-module split is **deferred**. For a codebase
> developed primarily with an LLM, a monolith that fits in the model's context window tends
> to produce *fewer* errors, not more. The recommended near-term action is a minimal
> pure-leaf extraction (**Option A**). The full 18-module split is retained below as
> **Option B** for when it is actually warranted. See **Recommendation** first.

## Goal

Break the 4,568-line `app.js` monolith into a set of focused ES modules under `src/`,
with no bundler, no npm, and no build step. The app stays a dependency-free vanilla-JS
frontend. After the refactor it will be loaded with:

```html
<script type="module" src="./src/main.js"></script>
```

This plan is derived from a function-by-function read of the real `app.js`. All line
numbers below refer to the current `app.js` (as of the read) and will drift as edits
are made — treat them as anchors, not exact addresses. Move functions by name.

---

## Recommendation (revised): defer the full split

**Decision: do not do the full 18-module refactor now. Keep the monolith.**

The original motivation — "a big file causes more errors" — is backwards for this
codebase, which is developed primarily with an LLM. A single file that fits in the model's
context window is an asset, not a liability:

- **No cross-file reasoning errors.** The most common class of LLM coding mistake is acting
  on wrong assumptions about code it cannot see. One file means every caller, every state
  mutation, and every helper is visible at once — there is nothing to assume.
- **The refactor's risk/reward is poor.** It is ~4.5–5 days (Section 6, Effort) of pure
  churn with **zero functional benefit**, and it introduces real regressions: the `state.X`
  conversion across ~40 reassignment sites (Section 3), circular-import hazards (Section 6),
  and the `file://` breakage (Section 4). That is a large error budget spent to make the
  code merely *look* more conventional.
- **It still fits.** ~166 KB / ~4,568 lines is comfortably within a modern context window.
  There is no immediate pressure.

The real costs of the monolith are economic and ergonomic, not correctness:

1. **Token cost per edit** — targeted changes re-read large spans, and unique `Edit`
   anchors are fiddlier in a big file. A cost, not a bug.
2. **Testability** — the backend now has a passing test suite because its logic is
   importable in isolation. The frontend's deterministic core (compiler, validation,
   mutation engine) is just as testable *if separated from the DOM and globals*. This is the
   one place modularization buys correctness.
3. **Growth** — BACKLOG adds save/load, subgraph views, real LLM assist, version history.
   "Fits today" has an expiry date.

**Reconsider the full split (Option B) only when** (a) you want real unit tests on the
compiler/validation logic, or (b) the file outgrows comfortable whole-file editing.

---

## Option A — minimal pure-leaf extraction (recommended near-term)

Get most of the benefit for ~20% of the risk: extract only the pure, stable, testable
leaves and leave the entangled stateful UI as one file. This captures the testability win
without the `state.X` minefield or the `file://` regression.

Scope:

- **`src/constants.js`** — the enums and lookup tables (lines 3–211). Zero risk, zero state.
- **`src/utils.js`** — pure helpers only: `clone`, `slug`, `titleCase`, `truncate`,
  `dedupe`, `clamp`, `escapeHtml`, `escapeAttribute`, `splitCsv`, `uniqueId`, `countBy`.
  No `state`/DOM imports.
- **`src/graph-logic.js`** — the deterministic core, **refactored to take the graph as an
  argument instead of reading the `graph`/`state` globals**: `compileInstruction` and its
  helpers, `validateGraph`/`hasCycle`, and the pure normalizers/factories from the mutation
  engine (`createNode`, `createEdge`, `ensureGraphShape`, the `infer*`/`normalize*`
  helpers). This is the only part with real work — the payoff is a module you can unit-test
  exactly like the backend's `apply_mutation`/`compile_assist_message`.

**The packaging decision (preserve `file://` or not):** these modules are only importable if
the consumer is also a module, which would force the `index.html` `type="module"` switch and
the `file://` regression (Section 4). Two ways to avoid that:

- *Accept ES modules* — make `app.js` a module that imports the three leaves. Cleanest code,
  but loses `file://`-open (must serve over HTTP). Choose this if you don't rely on
  double-clicking `index.html`.
- *Global-namespace shim* — load the leaves as plain `<script>` files before `app.js` that
  assign to a single global (e.g. `window.PG = { clone, slug, ... }`). Uglier, but **zero
  behavioral change** and `file://`-open keeps working.

**Effort:** ~1–1.5 days, dominated by parameterizing `graph-logic.js` and adding a small
test runner (Node's built-in `node:test` if a `package.json` is acceptable, or a single
vendored runner). Pairs naturally with the existing `backend/tests/` suite. This delivers
the only correctness benefit modularization offers (unit-testable core logic) while leaving
the high-risk UI/state tangle untouched.

---

## Option B — full 18-module split (deferred)

Everything from Section 1 onward is the complete plan for the full modularization, retained
as a reference for when trigger (a) or (b) above is hit. It is **not** the recommended
near-term action. Read it as "how to do the big split safely if/when we commit to it,"
not as a backlog item to schedule now.

---

## 1. Current shape (what we are splitting)

`app.js` has four regions:

| Region | Lines (approx) | Contents |
|---|---|---|
| Constants | 1–211 | `STORAGE_KEY`, `API_BASE_STORAGE_KEY`, enums (`MODELING_STYLES`, `NODE_TYPES`, `EDGE_TYPES`, `FLOW_KINDS`, `RESOURCE_TYPES`, `CONSTRAINT_TYPES`, `CONSTRAINT_OPERATORS`, `MUTATION_ACTIONS`, `GRAPH_MUTATION_ACTIONS`), `CONSTRAINT_TEMPLATES`, `OFFICIAL_REFERENCES`, `NOTATION_PROFILES` |
| Ontology + prompt + sample data | 213–644 | `DEFAULT_ONTOLOGY` (213), `COMPILER_PROMPT` (377), `sampleGraph` (456), `sampleLayout` (637) |
| Mutable module state | 646–669 | 22 `let` globals (646–667) + `const els = {}` (669) |
| Init + ~150 functions | 671–4568 | `DOMContentLoaded` bootstrap (671), then everything else |

The hard part is that those 22 `let` globals are read AND **reassigned** from all over
the file (see Section 3). `els` is a single mutable object shared by nearly every render
function.

---

## 2. Module breakdown

Proposed layout under `src/`. Each module lists its responsibility, the **actual
functions/constants** that move into it, and its imports/exports. Every module that
touches shared state imports the single `state` object from `state.js` (see Section 3),
and DOM-touching modules import `els` from `dom.js`.

### `src/constants.js`
**Responsibility:** Pure, immutable constants and lookup tables. No state, no DOM, no imports (except `OFFICIAL_REFERENCES` is referenced by `NOTATION_PROFILES`/`DEFAULT_ONTOLOGY`, so keep those together or split ontology out — see below).
**Moves:** lines 3–211 — `STORAGE_KEY`, `API_BASE_STORAGE_KEY`, `MODELING_STYLES`, `NODE_TYPES`, `NODE_DESCRIPTION_STATUSES`, `EDGE_TYPES`, `FLOW_KINDS`, `RESOURCE_TYPES`, `CONSTRAINT_TYPES`, `CONSTRAINT_OPERATORS`, `MUTATION_ACTIONS`, `GRAPH_MUTATION_ACTIONS`, `CONSTRAINT_TEMPLATES`, `OFFICIAL_REFERENCES`, `NOTATION_PROFILES`.
**Exports:** all of the above (named).
**Imports:** none.

### `src/ontology.js`
**Responsibility:** The ontology vocabulary + ontology-related logic. Holds the default ontology data and the functions that read/merge/infer it.
**Moves:**
- Data: `DEFAULT_ONTOLOGY` (213–376).
- Logic: `mergeOntology` (997), `inferOntologyFromGraph` (1008), `addOntologyEntry` (1072), `inferTeamShape` (4003), `ontologyLabel` (4076), `ontologyDescription` (4080), `nodeDefinitionOntologyId` (3747), `syncNodeDefinitionToOntology` (3751), `removeNodeDefinitionFromOntology` (3765).
**Exports:** `DEFAULT_ONTOLOGY`, the listed functions.
**Imports:** `constants.js` (for `OFFICIAL_REFERENCES`), `state.js` (functions read `state.graph.ontology`), `utils.js` (`clone`, `slug`, `titleCase`).

> Note: `DEFAULT_ONTOLOGY` references `OFFICIAL_REFERENCES`, and `sampleGraph` references `DEFAULT_ONTOLOGY` via `clone(DEFAULT_ONTOLOGY)` (line 634). This forces the dependency order `constants -> ontology -> sample data`. Keep that direction; do not let `constants.js` import from `ontology.js`.

### `src/sample-data.js`
**Responsibility:** Seed graph + layout used for first load and reset.
**Moves:** `COMPILER_PROMPT` (377–455), `sampleGraph` (456–635), `sampleLayout` (637–644).
**Exports:** `COMPILER_PROMPT`, `sampleGraph`, `sampleLayout`.
**Imports:** `ontology.js` (`DEFAULT_ONTOLOGY`), `utils.js` (`clone`).

> `COMPILER_PROMPT` is grouped here because it is pure data shown in the UI and logically belongs with seed/reference content; it could also live in `constants.js`. Either is fine — pick one and keep it.

### `src/state.js`
**Responsibility:** The single source of mutable runtime state. THE central piece (Section 3).
**Moves:** the 22 `let` globals (646–667), converted into properties of one exported object.
**Exports:** `state` (one mutable object) and a `resetState()` helper used by `resetGraph`.
**Imports:** `sample-data.js` (`sampleGraph`, `sampleLayout`), `utils.js` (`clone`).

### `src/dom.js`
**Responsibility:** Element cache and tab/panel chrome that is purely about DOM wiring.
**Moves:** `els` (669), `bindElements` (678), `switchTab` (884), `switchInspectorTab` (895), `renderPanelCollapse` (1363), `toggleRightPanel` (1382).
**Exports:** `els`, `bindElements`, `switchTab`, `switchInspectorTab`, `renderPanelCollapse`, `toggleRightPanel`.
**Imports:** `state.js` (`switchInspectorTab`/panel toggles mutate `state.activeInspectorTab`, `state.leftPanelCollapsed`, `state.rightPanelCollapsed`), `sample-data.js` (`COMPILER_PROMPT`, set into `els.promptTemplate`), `render.js` (panel toggles call `render`).

### `src/utils.js`
**Responsibility:** Pure leaf helpers with NO state and NO DOM dependency. Extract first.
**Moves:** `countBy` (4476), `findNodeByName` (4483 — reads `state.graph`, see note), `splitCsv` (4488), `uniqueId` (4495), `slug` (4511), `titleCase` (4519), `truncate` (4527), `dedupe` (4532), `clamp` (4542), `clone` (4546), `escapeHtml` (4550), `escapeAttribute` (4559), `option` (4350), `nodeOptions` (4346 — reads `state.graph`), plus small geometry/format helpers that are pure: `nodeSize` (4294), `nodeColor` (4298), `flowKindColor` (3994).
**Exports:** the listed helpers.
**Imports:** mostly none. `findNodeByName` and `nodeOptions` read graph data — move those to `utils.js` only if they take the graph as an argument; otherwise leave them in a module that imports `state.js`. **Recommendation:** keep `utils.js` 100% pure (no `state` import) so it is a safe leaf with zero circular-import risk, and relocate `findNodeByName`/`nodeOptions` to `graph-helpers.js` or `compiler.js`.

### `src/geometry.js`
**Responsibility:** Coordinate math, layout bounds, viewport transforms. Mostly pure but several read `state.layout`/`state.canvasView`.
**Moves:** `normalizeLayout` (4164), `autoLayoutGraph` (4175), `layoutBounds` (4216), `graphWorldBounds` (4230), `paddedWorldBounds` (4254), `visibleGraphRect` (4265), `mergeBounds` (4276), `nextLayoutPoint` (4286), `connectionPoint` (4305), `nodePortCount` (4317), `localPortPoint` (4328), `svgPoint` (4354), `canvasPoint` (4362), `screenPointToGraph` (4367), `graphPointToScreen` (4375), `canvasViewportSize` (4383), `canvasViewportCenter` (4390), `normalizeCanvasView` (4395), `connectionDraftStartPoint` (2318), `targetNodeFromPointer` (2310).
**Exports:** the listed functions.
**Imports:** `state.js` (`state.graph`, `state.layout`, `state.canvasView`), `dom.js` (`els.graphCanvas`), `utils.js` (`clamp`, `nodeSize`).

### `src/mutations.js`
**Responsibility:** The mutation engine, factory functions, normalizers, undo. The graph-data write layer.
**Moves:**
- Apply/undo: `applyMutations` (3012), `pushUndoSnapshot` (3022), `undoLastMutationBatch` (3036), `applyMutation` (3053).
- Factories: `createNode` (3672), `createEdge` (3771), `createFlow` (3785), `createResource` (3797), `createConstraint` (3806).
- Normalizers/derivers: `normalizeNodeDescriptionStatus` (3693), `definitionStatusLabel` (3698), `suggestNodeDescription` (3707), `normalizeResourceRequirements` (3820), `resourceName` (3828), `findResourceIdByName` (3832), `normalizeEdgeType` (3837), `normalizeConstraintType` (3846), `normalizeFlows` (3858), `inferEdgeFlowsFromNodes` (3865), `inferFlowsFromText` (3876), `inferFlowKind` (3900), `edgeFlowLabel` (3911), `migrateConstraintFields` (4011), `createConstraintFields` (4017), `constraintExpression` (4029), `inferConstraintTarget` (4044), `operatorLabel` (4059), `ensureGraphShape` (958).
**Exports:** the listed functions.
**Imports:** `state.js`, `constants.js`, `ontology.js` (description sync), `utils.js`, `geometry.js` (`nextLayoutPoint`, `normalizeLayout` after add), `sample-data.js`. **Does NOT import render modules** (see circular-import note). Callers re-render after mutating.

### `src/compiler.js`
**Responsibility:** The deterministic browser-side instruction compiler + backend assist plumbing.
**Moves:** `planFromInstruction` (1111), `requestBackendAssist` (1124), `syncBackendMutations` (1144), `notifyBackendFailure` (1164), `notifyBackendSyncFailure` (1177), `apiBase` (1191), `compileWithClarification` (1195), `compileClarificationAnswer` (1203), `extractConnectionTargets` (1224), `normalizeNodeReference` (1236), `createEdgeMutation` (1241), `dedupeMutations` (1258), `compileInstruction` (3156), `buildCompilerResponse` (3260), `extractSegments` (4084), `cleanNodeName` (4099), `inferNodeType` (4109), `inferEdgeType` (4135), `inferCondition` (4143), `findMissingValues` (4152), `findNodeByName` (4483), `nodeOptions`/`option` (if not in utils).
**Exports:** `planFromInstruction`, `compileInstruction`, plus helpers needed by chat.
**Imports:** `state.js`, `constants.js`, `utils.js`, `mutations.js`, `chat.js` (appends messages) — see circular note (compiler should call back via injected callbacks or import chat carefully).

### `src/validation.js`
**Responsibility:** Graph validation and cycle detection.
**Moves:** `validateGraph` (3296), `profileValidationItems` (3370), `hasCycle` (3416), `currentNotationProfile` (1531), `snakeCaseNotationProfile` (3585).
**Exports:** `validateGraph`, `hasCycle`, `currentNotationProfile`, `profileValidationItems`, `snakeCaseNotationProfile`.
**Imports:** `state.js`, `constants.js` (`NOTATION_PROFILES`), `utils.js`.

> `currentNotationProfile` (1531) is read by canvas, validation, and export. Putting it in `validation.js` creates a wide fan-in. **Alternative:** put `currentNotationProfile` and `snakeCaseNotationProfile` in a tiny `src/notation.js` (matches the originally suggested file) that only imports `constants` + `state`, and have canvas/validation/export import from it. Recommended to reduce coupling.

### `src/notation.js` (recommended)
**Responsibility:** Notation-profile selection + legend rendering.
**Moves:** `currentNotationProfile` (1531), `snakeCaseNotationProfile` (3585), `renderNotationLegend` (1462), `renderLegendRow` (1520), `renderModelingStyle` (1449), `handleModelingStyleChange` (2258).
**Exports:** the listed functions.
**Imports:** `constants.js` (`NOTATION_PROFILES`, `MODELING_STYLES`), `state.js`, `dom.js`, `mutations.js`/`render.js` (style change re-renders).

### `src/canvas.js`
**Responsibility:** SVG canvas rendering + all pointer/drag/connect/pan/zoom/minimap interaction.
**Moves:**
- Render: `renderCanvas` (1535), `renderPreviewMarkup` (1608), `renderNode` (1630), `renderNodeShape` (1653), `renderNodePorts` (1705), `renderPort` (1720), `renderDraftConnection` (1735), `renderEdge` (1749), `renderMinimap` (1485), `updateCanvasControls` (1515), `edgeVisual` (3918), `edgeFlowLabel` (3911 — or keep in mutations and import).
- Interaction: `handleCanvasPointerDown` (2326), `handleCanvasPointerMove` (2377), `handleCanvasPointerUp` (2435), `handleCanvasWheel` (4403), `zoomCanvasBy` (4409), `setCanvasZoom` (4413), `fitCanvasToGraph` (4427), `resetCanvasView` (4441), `handleMinimapPointerDown` (4448).
- Preview: `buildPendingCanvasPreview` (1392), `canvasPreviewMutationCount` (1442).
**Exports:** `renderCanvas`, `renderMinimap`, `updateCanvasControls`, the pointer handlers, zoom/fit/reset helpers, `buildPendingCanvasPreview`.
**Imports:** `state.js`, `dom.js`, `constants.js`, `geometry.js`, `notation.js`, `mutations.js`, `utils.js`, `render.js` (handlers call `render` after edits).

### `src/inspector.js`
**Responsibility:** The right-hand inspector: node/edge/resource/constraint editing UI and all its input/click handlers + edge builder + resources/constraints panels.
**Moves:** `renderInspector` (1787), `renderEmptyInspector` (1927), `renderStringListEditor` (1962), `renderResourceRequirementEditor` (1982), `renderEdgeFlowEditor` (2007), `renderEdgeBuilder` (2040), `renderEdgeTypeHelp` (2052), `renderEdgeFlowKindHelp` (2058), `renderResources` (2093), `renderConstraints` (2123), `renderOntology` (2186), `renderOntologyGroup` (2207), `handleOntologyInput` (2243), `handleInspectorInput` (2491), `handleInspectorClick` (2642), `handleResourceInput` (2844), `handleConstraintInput` (2863), `selectedTargetCandidates` (2898), `constraintMatchesSelection` (2913), `constraintTargetOptions` (2919), `normalizeConstraintTarget` (2928), `addNodeFromToolbar` (2937), `addEdgeFromInspector` (2954), `addResource` (2981), `addConstraint` (2994).
**Exports:** `renderInspector`, `renderResources`, `renderConstraints`, `renderOntology`, the handlers, the `addX` actions.
**Imports:** `state.js`, `dom.js`, `constants.js`, `mutations.js`, `ontology.js`, `geometry.js`, `utils.js`, `render.js`.

### `src/chat.js`
**Responsibility:** Chat transcript + pending plan preview/apply/discard + undo button.
**Moves:** `renderPlan` (1104), `discardPendingPlan` (1268), `renderUndoState` (1280), `buildAssistantReply` (1285), `appendChatMessage` (1304), `renderChatMessages` (1313), `renderChatMessage` (1333), plus the `applyPlanButton` apply-handler logic currently inline in `bindEvents` (771+) — extract it into an exported `applyPendingPlan()`.
**Exports:** `appendChatMessage`, `renderChatMessages`, `renderPlan`, `discardPendingPlan`, `applyPendingPlan`, `renderUndoState`, `buildAssistantReply`.
**Imports:** `state.js`, `dom.js`, `mutations.js`, `compiler.js`, `utils.js`, `render.js`.

### `src/export.js`
**Responsibility:** Markdown/JSON generation, download, clipboard, reset.
**Moves:** `generateMarkdown` (3441), `exportEnvelope` (3598), `downloadMarkdown` (3613), `downloadGraphJson` (3627), `copyGraphJson` (3641), `resetGraph` (3651), `updateStatus` (2289), `renderLog` (2272).
**Exports:** `downloadMarkdown`, `downloadGraphJson`, `copyGraphJson`, `resetGraph`, `generateMarkdown`, `exportEnvelope`, `updateStatus`, `renderLog`.
**Imports:** `state.js`, `dom.js`, `constants.js`, `validation.js` (`snakeCaseNotationProfile`/readiness), `mutations.js`/`sample-data.js` (reset seeds), `utils.js`, `render.js` (reset re-renders).

### `src/persistence.js`
**Responsibility:** localStorage load/save.
**Moves:** `loadState` (907), `saveState` (934).
**Exports:** `loadState`, `saveState`.
**Imports:** `state.js`, `constants.js` (`STORAGE_KEY`), `mutations.js` (`ensureGraphShape`), `geometry.js` (`normalizeLayout`, `normalizeCanvasView`).

### `src/render.js`
**Responsibility:** The top-level orchestrator that re-renders everything. Pulled out of `app.js` `render()` (1080).
**Moves:** `render` (1080).
**Exports:** `render`.
**Imports:** canvas, inspector, chat, notation, validation, export (`updateStatus`/`renderLog`), dom (`renderPanelCollapse`). Because nearly every UI module needs to call `render` after a change, `render.js` is the natural hub. To avoid cycles, UI modules import `render` from here and `render.js` imports their render functions — that is a one-directional fan-out from `render.js`, which is acceptable for ES modules as long as no module top-level-executes `render` during import.

### `src/main.js`
**Responsibility:** Entry point. Holds `bindEvents` and the `DOMContentLoaded` bootstrap.
**Moves:** the bootstrap (671–676) and `bindEvents` (749–882).
**Exports:** none (side-effecting entry).
**Imports:** everything it wires — `dom.js` (`bindElements`, `switchTab`, toggles), `persistence.js` (`loadState`), `render.js` (`render`), `compiler.js` (`planFromInstruction`), `chat.js` (`applyPendingPlan`, `discardPendingPlan`), `inspector.js` (handlers + add actions), `canvas.js` (pointer/zoom handlers), `export.js` (download/reset), `notation.js` (style change), plus `state.js` for `state.allowCycles` toggle at line 849.

### Resulting file list

```
src/constants.js
src/ontology.js
src/sample-data.js
src/state.js
src/dom.js
src/utils.js
src/geometry.js
src/mutations.js
src/compiler.js
src/validation.js
src/notation.js
src/canvas.js
src/inspector.js
src/chat.js
src/export.js
src/persistence.js
src/render.js
src/main.js
```

This is 18 files vs the suggested 15 — `geometry.js`, `sample-data.js`, and `render.js`
were split out because the real seams call for them (canvas math is large and reused;
sample data is bulky; a dedicated render hub is the cleanest way to avoid circular
imports). `notation.js` was kept as suggested rather than folded into validation.

---

## 3. The shared-state problem (the central obstacle)

### Why a naive split fails

The 22 globals at lines 646–667 are not just mutated in place — many are **reassigned**.
Confirmed reassignment sites (non-exhaustive, from a grep of the file):

- `graph = clone(sampleGraph)` (646, 3652), `graph = saved.graph` (911), `graph = clone(originalGraph)` (1410)
- `layout = clone(sampleLayout)` (647, 3653), `layout = saved.layout || {}` (912)
- `selected = { ... }` reassigned at ~25 sites (648, 913, 1614, 1797, 1852, 2333, 2347, 2362, 2416, 2478, 2682, 2737, 2749, 2950, 2975, 3041, 3066, 3089, 3269, 3278, …)
- `pendingPlan = (await requestBackendAssist(...)) || compileWithClarification(...)` (1113), `pendingPlan = null` (774, 1270, 3045, 3655)
- `mutationLog = []` / `= saved.mutationLog` / `= clone(mutationLog)` (650, 914, 3042, 3271, 3656)
- `chatMessages = chatMessages.slice(-24)` (1310), `chatMessages = [...]` (923)
- `undoStack = undoStack.slice(-12)` (3033), `undoStack = [...]` (924)
- `allowCycles = els.allowCyclesInput.checked` (849), and `= saved.allowCycles…` (916)
- `canvasView = normalizeCanvasView(...)` (926, 1543, 2398), and others
- the boolean panel/form flags reassigned in `loadState` (917–922)

**ES module imports are read-only live bindings.** This means:

```js
import { graph } from "./state.js";
graph = clone(sampleGraph); // SyntaxError / TypeError: Assignment to constant variable
```

You cannot `import { graph }` and then reassign `graph`. A getter/setter accessor per
global would work but means rewriting ~150 reassignment sites into setter calls
(`setSelected(...)`, `setGraph(...)`), which is invasive and noisy for 22 variables.

### Recommended approach: one mutable `state` object

Export a single object and mutate its **properties**. Property assignment on an imported
object is always legal — the binding (`state`) never changes, only its fields do.

`src/state.js`:

```js
import { clone } from "./utils.js";
import { sampleGraph, sampleLayout } from "./sample-data.js";

export const state = {
  graph: clone(sampleGraph),
  layout: clone(sampleLayout),
  selected: { kind: "node", id: "n_request_complete" },
  pendingPlan: null,
  mutationLog: [],
  openQuestions: [],
  allowCycles: true,
  dragState: null,
  connectState: null,
  panState: null,
  toastTimer: null,
  activeInspectorTab: "inspect",
  addNodeFormOpen: false,
  addEdgeFormOpen: false,
  resourcesOpen: false,
  constraintsOpen: false,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  chatMessages: [],
  undoStack: [],
  clarificationContext: null,
  canvasView: { x: 0, y: 0, zoom: 1 },
};

export function resetState() {
  state.graph = clone(sampleGraph);
  state.layout = clone(sampleLayout);
  state.selected = { kind: "node", id: "n_request_complete" };
  state.pendingPlan = null;
  state.mutationLog = [];
  // ...reset the rest as resetGraph currently does (3651+)
}
```

Every reassignment becomes a property write — **legal across modules**:

```js
import { state } from "./state.js";
state.graph = clone(sampleGraph);          // was: graph = clone(sampleGraph)
state.chatMessages = state.chatMessages.slice(-24);
state.pendingPlan = (await requestBackendAssist(message)) || compileWithClarification(message);
state.selected = { kind: "node", id };
```

Every read becomes `state.graph`, `state.selected`, etc.

### Why this over the alternatives

- **Per-variable getter/setter accessors:** correct, but you must convert every one of
  the ~150 read sites and ~40 write sites into function calls and invent a setter for
  all 22 globals. Much larger diff, no real benefit for a single-threaded, single-author
  vanilla app.
- **Pub/sub store (observable):** overkill. The app already re-renders explicitly via a
  central `render()` after every change; there are no reactive subscribers to wire up.
  Adding a store would introduce indirection the no-build constraint asks us to avoid.
- **Single mutable object:** smallest conceptual change (a global object instead of
  globals), zero new runtime machinery, and it directly solves the live-binding problem.
  This is the recommended choice.

### Mechanical conversion

The bulk of the migration is a find/replace of bare global identifiers to `state.X`.
Do this carefully and per-module (not a blind global replace — e.g. `selected` appears
as a local variable name in some functions, and `graph` is used as a parameter name like
`targetGraph`). Convert one module at a time as it is extracted (Section 4), keeping the
old `let` global in `app.js` until that module's symbol is fully migrated, then delete it.

`els` follows the same model: export it as a single mutable object from `dom.js`
(`export const els = {}`), and `bindElements` fills it. Importers read `els.foo`.

---

## 4. No-build constraint (how to ship modules without a bundler)

ES modules run natively in every current browser. No bundler is required. Steps:

1. Change `index.html` line 278 from
   `<script src="./app.js" defer></script>`
   to
   `<script type="module" src="./src/main.js"></script>`
   (`type="module"` is deferred by default; the `defer` attribute is redundant.)
2. Use relative specifiers **with the `.js` extension** in every import
   (`import { state } from "./state.js";`) — browsers do not resolve extensionless or
   bare specifiers without an import map.
3. Keep `"use strict";` — module code is strict by default, so the directive becomes
   redundant but harmless; it can be dropped from each module.

### REGRESSION to flag: `file://` will stop working

This is the key behavioral change to communicate. Today `README.md:37` advertises:

> "The app is dependency-free and can also be opened directly from `index.html`."

ES modules are fetched over HTTP and are subject to CORS. Under the `file://` protocol,
browsers refuse module fetches (origin is `null`), so **double-clicking `index.html`
will no longer work** — the page will load but the script will fail with a CORS / module
load error and the app will be blank.

**Mitigation / messaging:**
- The app **must** be served over HTTP. The README already documents
  `python -m http.server 4173` (README.md:23–35) as the primary path — that keeps working.
- Update `README.md:37` to remove the "can also be opened directly from `index.html`"
  sentence and replace it with an explicit note: "The app now uses ES modules and must be
  served over HTTP (see the Run section); opening `index.html` from the filesystem will
  not work due to browser module/CORS restrictions."
- Consider a one-line console-friendly hint, but the README note is the main deliverable.

No other tooling, npm, or package.json is introduced. Still zero dependencies.

---

## 5. Incremental migration sequence

Extract leaves first; convert each module's globals to `state.X` as it moves; keep
`app.js` working as the shrinking remainder until `main.js` takes over. After each step,
run the smoke test (Section 6). Suggested order:

1. **Stand up the skeleton.** Create `src/` and an empty `src/main.js` that does
   `import "./<old shim>"`. Easiest path: temporarily have `main.js` re-export nothing and
   keep loading `app.js` classically, OR (cleaner) do the index.html switch only at the
   very end (step 12). Until then, develop modules and `import` them back into `app.js` is
   NOT possible (app.js is a classic script). So: do the index.html switch EARLY (step 2)
   and make `app.js` itself the first module.
2. **Switch index.html to `type="module"` pointing at `app.js` (renamed conceptually to a
   module).** Verify the app still runs as a single module over `http.server`. This proves
   the no-build module path before any splitting. (Confirm `file://` regression here.)
3. **`constants.js`** — pure, no deps. Move lines 3–211, export, `import * from` into the
   main module. No state changes. Smoke test.
4. **`utils.js`** — pure leaf helpers (`clone`, `slug`, `escapeHtml`, `clamp`, `dedupe`,
   `truncate`, `titleCase`, `splitCsv`, `uniqueId`, `countBy`, …). Keep it state-free.
   Many later modules depend on `clone`, so it must exist early.
5. **`ontology.js`** then **`sample-data.js`** — data + ontology logic. Depends on
   constants + utils. `sample-data` depends on `ontology`.
6. **`state.js`** — create the `state` object seeded from `sample-data`. At this step,
   begin the global→`state.X` conversion. Do it module-by-module from here on: when you
   extract a module, rewrite its references to `state.X` and `els.X`.
7. **`dom.js`** — `els`, `bindElements`, tab/panel chrome.
8. **`geometry.js`** — coordinate/layout math (depends on state, dom, utils).
9. **`mutations.js`** — mutation engine + factories + normalizers + `ensureGraphShape`.
   This is the largest data-layer move; convert all its global writes to `state.X`.
10. **`validation.js`** + **`notation.js`** — read-mostly; depend on constants/state.
11. **`compiler.js`** — instruction compiler + backend assist.
12. **`render.js`** (the hub) and the stateful UI modules **`canvas.js`**,
    **`inspector.js`**, **`chat.js`** — extract these last; they have the most state and
    DOM coupling and the most cross-calls. Introduce `render.js` first as the import hub so
    each UI module imports `render` from it.
13. **`export.js`** + **`persistence.js`** — depend on most of the above.
14. **`main.js`** — move `bindEvents` and the `DOMContentLoaded` bootstrap; point
    index.html at `src/main.js`; delete the now-empty `app.js`.
15. **Update README.md** (Run section + remove the `file://` claim).

At every step the previous module remains imported by the shrinking root module, so the
app stays runnable. Commit after each green smoke test.

---

## 6. Risks & verification

### Circular-import risk

The main hazard is `render.js` <-> UI modules and `mutations.js`/`compiler.js`/`chat.js`
mutual references. Mitigations:

- **One-directional render hub.** UI modules (`canvas`, `inspector`, `chat`, `export`,
  `notation`) import `render` from `render.js`; `render.js` imports their *render*
  functions. Keep the data-layer modules (`mutations`, `state`, `geometry`, `validation`)
  free of any import from UI modules — they must not import `render.js`. Callers re-render
  after mutating; mutations never trigger render themselves.
- **Avoid top-level side effects.** No module should *call* `render()`, touch the DOM, or
  read `els` at import time. All such work happens inside functions invoked from
  `main.js`'s `DOMContentLoaded` handler. ES module cycles are tolerated by the spec as
  long as no cyclically-imported binding is *used* during module evaluation — keeping all
  use inside functions guarantees that.
- **`compiler.js` -> `chat.js`** (compiler appends assistant messages): if this creates a
  cycle, either move `appendChatMessage` to a lower module or have the compiler return the
  reply and let the caller append it. Prefer returning data over reaching into chat.
- **`utils.js` stays pure** (no `state` import) so it can be imported by anything without
  risk. This is why `findNodeByName`/`nodeOptions` (which read `state.graph`) should NOT
  live in `utils.js` unless refactored to take the graph as a parameter.

### Verification (no JS test runner / node available)

Per BACKLOG.md "Test Plan" (lines 190–196), verification is **manual browser smoke
testing** served via `python -m http.server 4173`. After each extraction step, run:

- Page loads with no console errors; sample graph renders.
- **Chat:** send an instruction, confirm a pending plan previews in greyscale.
- **Clarification loop:** send a follow-up answer.
- **Apply / discard / undo** a mutation batch.
- **Panel collapse** left and right.
- **Inspector edits:** rename a node, edit a definition, add/remove a resource and a
  constraint, add an edge from the inspector, toggle Allow cycles.
- **Canvas:** drag a node, drag-to-connect a new edge, select an edge, pan, zoom in/out,
  fit, reset view, minimap click.
- **Notation profile switching** across all six styles; legend updates.
- **Ontology tab:** infer from graph, search.
- **Export:** download Markdown, download JSON, copy JSON; reset graph.
- **Persistence:** make an edit, reload — state restored from localStorage; migration of
  the existing `process-graph-builder-state-v1` key still loads.

Keep DevTools console open throughout; a broken import surfaces immediately as a module
load error (the whole app goes blank), which makes per-step regressions easy to catch.

### Effort estimate

- Skeleton + index.html switch + README: ~0.5 day.
- Pure-leaf modules (constants, utils, ontology, sample-data, state object): ~0.5 day.
- Data layer (geometry, mutations, validation, notation, compiler) incl. global→`state.X`
  conversion: ~1.5 days (mutations + compiler are large and reassignment-heavy).
- UI layer (render hub, canvas, inspector, chat, export, persistence, main + bindEvents):
  ~2 days (most DOM/state coupling and cross-calls).
- Full manual smoke regression at the end + fixing cycle/order bugs: ~0.5 day.

**Total: roughly 4.5–5 focused days** for one developer, done incrementally with a smoke
test after each module. The single biggest line-count and reassignment burden is the
mechanical `graph`/`selected`/`pendingPlan`/`chatMessages`/`undoStack` → `state.*`
conversion; budget care there over cleverness.
