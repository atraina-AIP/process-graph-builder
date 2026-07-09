# Plant Pipeline — Designer → JSON → Solver → Results

**Status:** Reference · **Created:** 2026-07-03 · **Scope:** how a plant is defined and how it flows end-to-end (authoring → scenario → MILP → solve → results), including where scenarios and contracts enter. Written for ITEM-080 (multi-plant onboarding); captured from a full trace of the pipeline.

---

## 1. A plant is three artifacts, not one

Onboarding a plant is not "write one file." A plant is:

| # | Artifact | Where it lives | Authored how |
|---|---|---|---|
| **1. Graph** | nodes + edges + constraints + objective | a saved **flow system** (Postgres) *or* a code factory | **visually in the Process Designer** (primary) *or* in code |
| **2. Config** | identity, product identity, display, commodities | `plantConfigRegistry` (`<plant>Config.ts`) | one small TS file, `registerPlant()` |
| **3. DB data** | cost curves, process/period params, chemistry calibration, **contracts** | Postgres, keyed by `plant_code` | seed rows / CSV import |

The graph is the topology; the config tells the platform how to resolve plant-specific identity/display; the DB data supplies the numbers. All three are needed for a plant to load, solve, and render correctly.

## 2. The graph: two authoring paths, one JSON shape

Both paths produce the **same** `{ nodes, edges, constraints, objective }` JSON — the converter downstream only sees the JSON, not how it was authored.

**Path A — Visual (Process Designer, the intended path for new plants):**
`/` route (`src/routes/+page.svelte`, `FlowCanvas.svelte`) — drag nodes, draw edges, set properties → **Save** (`apiConfig.flow.save`) → a **flow system** row in Postgres whose `flow_data` holds `{ nodes, edges, constraints, objective, contracts, timeConfig, metadata }`.

**Path B — Code factory (NOR + reference builders):**
`plants/norProd.js` (`createNORProdPlant`), or the ITEM-080 shared builders `stages/plantStages.js` composed by a thin `plants/<plant>.js` (`createSubsetPlant`). Registered via `registerPlantGraph()` / `envivaService.plants`. This is how NOR ships and how the builder machinery is proven; new plants will typically use Path A.

**The two paths are proven equivalent** — round-tripping NOR's own graph through Path A (`convertFlowToScenarioFormat`) reproduces Path B's MILP with byte-identical constraints + objective (`nor2-json-parity.test.js`). So authoring a plant as JSON (Path A) is fidelity-equivalent to authoring it in code (Path B); the code builders are a reference, not a requirement. One load-bearing field: `timeConfig.periodLength` (hours) — it's the rate→quantity coefficient in every per-period balance; a plant's graph must carry it (NOR = 730).

Node JSON shape (both paths):
```jsonc
{
  "id": "mixer",                 // dashes allowed; MILP var uses underscores
  "type": "process",             // navien | process | ...
  "position": { "x": 400, "y": 200 },
  "data": {
    "id": "mixer",
    "label": "Mixer",
    "properties": {
      "Throughput_sTPerHr": {    // → MILP var  mixer_Throughput_sTPerHr_P{period}
        "value": 0, "type": "number", "unit": "sT/hr",
        "variableType": "decision"   // decision | exogenous | endogenous | processParameter | parameter
      }
    }
  }
}
```

Constraint JSON shape (relationships form):
```jsonc
{
  "id": "mixer_balance",           // constraint name keeps dashes; only VAR names normalize
  "type": "relationships",
  "relationshipEquation": "... == 0",   // operator is read from here (<= / >= / ==)
  "value": 0,                             // numeric RHS
  "relationshipTerms": [ { "variable": "hardwood-chips.Purchases_sTPerHr", "coefficient": 1 },
                         { "variable": "mixer.Throughput_sTPerHr", "coefficient": -1 } ],
  "enabled": true
}
```

## 3. The full pipeline (shape at each hop)

```
   ┌─ GRAPH ──────────────┐   ┌─ CONFIG ──────┐   ┌─ DB DATA ─────────────────┐
   │ nodes/edges/         │   │ registry:     │   │ cost curves, params,       │
   │ constraints/objective│   │ identity,     │   │ chemistry, CONTRACTS        │
   │ (Designer flow OR     │   │ product id,   │   │ (per plant_code)            │
   │  code factory)        │   │ display       │   │                             │
   └──────────┬───────────┘   └──────┬────────┘   └────────────┬────────────────┘
              └──────────────────────┼─────────────────────────┘
                                     ▼
    Visual:  loadFlowSystem(id) → convertFlowToScenarioFormat(flow_data)   ("Load My Model")
    Code:    convertDemoToScenario(modelId)                                 ("Load Model")
              • wraps graph → scenario.baseGraph { nodes, edges }
              • classifies vars → scenario.variables { decision, exogenous, endogenous }
              • fetches contracts by plant_code → scenario.contractDetails
                                     ▼
   ┌─────────────────────  SCENARIO  (the object the USER edits)  ─────────────┐
   │ baseGraph + parameters(timePeriods) + constraints + objective +           │
   │ contractDetails + periodOverrides + variableOverrides                     │
   └───────────────────────┬───────────────────────────────────────────────────┘
        Scenario Config UI (`/scenario`): time window, per-period params, which
        contracts, variable overrides. ScenarioRunner adds contractDemandLookup,
        resolvedParameters, and stamps flags (e.g. useContractExpander).
                                     ▼
              convertScenarioToMILP(scenario)          (scenarioToMILPConverter.js)
              • lowers nodes' decision props → variables[]
              • lowers constraints (period fan-out) → constraints[]
              • lowers objective → objective.terms[]
              • lowers contracts → Fulfill / tier-bonus vars + SalesAllocation
                                     ▼
   ┌────────  MILP JSON  (the "JSON to the solver")  ────────┐
   │ { variables[], constraints[], objective{terms},         │
   │   contracts, network, solver_config, time_periods }     │
   └──────────────┬──────────────────────────────────────────┘
                  ▼  POST /api/process-optimizer/optimize/structured-milp
        BACKEND SOLVER  (backend/.../structured_milp_optimizer.py → SCIP/OR-Tools)
                  ▼
   ┌──── RESULT JSON ────────────────────────────────┐
   │ { result: { status, objective_value,            │  ← saved into the flow system's
   │   variables:[{name,value}], constraints,        │    flow_data.optimization_results
   │   contract_revenues } }                         │    (or sessionStorage for compares)
   └──────────┬──────────────────────────────────────┘
              ▼
        RESULTS BUILDER  (`/optimization-results`)
        components: TechnicalAnalysis, EconomicAnalysis, CompareResults,
                    BuyingAnalysis, ContractFulfillmentReport
        read result.variables + objective.terms + contract_revenues → render tabs
```

## 4. Where scenarios and contracts fit (easy to miss)

**Contracts and scenarios are NOT part of the plant graph.** They layer on at scenario-assembly time:

- **Contracts** live in Postgres keyed by `plant_code`. `convertDemoToScenario` / the scenario flow fetches them (`fetchContractsForModel` → `getContractsWithAshTiers(plantCode)`) → `scenario.contractDetails`. The user selects which in the Scenario UI. They only become MILP variables (`Fulfill_*` / tier-bonus `z_*`, or the ITEM-081 `contract_*_Fulfillment_*`) inside `convertScenarioToMILP`. **The same plant graph solves differently depending on which contracts are selected.**
- **A "scenario"** = the plant graph + a specific parameter set (time window, per-period overrides, selected contracts, variable overrides). **One plant → many scenarios.** It is the editable wrapper around the graph, not a separate artifact of the plant.

## 5. What downstream is plant-agnostic (the platform guarantee)

Everything after the scenario is **one code path for all plants** — the converter, the solver, and the results components do not branch per plant. Plant-specifics are resolved from config, not hardcoded:

- **Product identity** (`pellets` / sales var / `pellet_mill` scope) → `resolveProductIdentity(modelId)` (ITEM-082). A registered plant that omits it now **warns** (ITEM-080, `421f7cbc`) instead of silently using NOR's `pellets`.
- **Backend NCV/ash chemistry** → `plant_quality_config` by `plant_code`; **hard-errors** on an unregistered plant (no silent NOR chemistry).
- **Display (tabs, commodities, capacity formulas)** → `getPlantConfig(modelId).display` with NOR fall-through.
- **Node-id conventions** — reuse NOR's ids (`dryer`, `mixer`, `pellet-press`, `pellets`, `dried-material`) where topology matches so converter/iteration/results logic applies. Stage-specific injections gate on *structure*, not just node id (e.g. the dryer-outlet-MC setpoint requires `dryer.OutletMoisture` + a `dried-material` node — ITEM-080 `6a029f75`).

## 6. Onboarding a new plant (concretely)

1. **Graph** — author visually in the Process Designer (reusing NOR node ids where topology matches), Save → flow system. *(Or compose in code from `stages/plantStages.js`.)*
2. **Config** — `plants/<plant>Config.ts`: identity + **product identity** (`productGraphNode`/`productSalesVariable`/`productNode`) + display/commodities; `registerPlant()`.
3. **DB data** — seed `cost_curves` (Seg1..10/commodity), `process_parameters`, `period_parameters`, chemistry (`PlantQualityConfig`), and load `contracts` with `plant` populated — all keyed `plant_code`.
4. **Run** — Scenario page → Load the plant → configure scenario → optimize → results render its commodities/quality (verify no NOR fallback, per-period edits round-trip to the right `plant_code`).

See `BACKLOG.md` ITEM-080 for the platform-fix status (Phase A = 7/7 done) and the shared-builder machinery (Phase 1, `6a029f75`).

**The reference template (2026-07-04):** `src/lib/models/enviva/plants/templatePlant.json` — a complete standalone plant graph (7 nodes / 6 edges / 9 constraints / profit objective) in exactly the JSON shape steps 1–2 produce, with `__tests__/template-plant-json-e2e.test.js` proving the whole pipeline with **zero plant code**: JSON → `validatePlantGraph` (the same pre-flight the Run button now applies) → `convertFlowToScenarioFormat` → `convertScenarioToMILP` → real backend solve → expected optimum. Copy the JSON + the test's registry entry as the starting point for each of the 9 plants; contracts stay DB-side (`refreshContractDetailsFromDB` re-fetches details by `plantCode` on every load — the saved JSON carries only the ID selection).

## 7. Code reference (entry points)

| Stage | File · symbol |
|---|---|
| Visual authoring | `src/routes/+page.svelte` · `FlowCanvas`; save via `apiConfig.flow.save` |
| Load saved flow → scenario | `flowToScenarioConverter.js` · `convertFlowToScenarioFormat` |
| Load code plant → scenario | `modelToScenarioConverter.js` · `convertDemoToScenario`; contracts via `fetchContractsForModel` |
| Code graph factories | `plants/norProd.js` · `createNORProdPlant`; `stages/plantStages.js` + `plants/subsetPlant.js` |
| Registry | `plantConfigRegistry.ts` (config) · `plantGraphRegistry.js` (graph loader) · `envivaService.loadPlant` |
| Scenario → MILP | `scenarioToMILPConverter.js` · `convertScenarioToMILP` |
| Solve | `backend/fastapi_app/optimization/structured_milp_optimizer.py` · `solve_structured_milp`; endpoint `/api/process-optimizer/optimize/structured-milp` |
| Results | `src/routes/optimization-results/+page.svelte`; `optimization-results/components/*` |
