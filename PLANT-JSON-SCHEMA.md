# Canonical Plant-JSON Schema + Stage Vocabulary

**Status:** Reference/contract · **Created:** 2026-07-03 · **Scope:** the canonical JSON a "plant" is, split by the surface that owns each part, plus the recognized stage vocabulary. This is the shared target for BOTH authoring pathways — the manual UI and the LLM + mapping tool — and the contract the validator (`src/lib/models/plantSchema.js`) enforces. Companion to `PLANT-PIPELINE.md` (the flow) — this doc is the shape.

---

## 0. Two pathways, one JSON

A plant is a JSON graph. It can be produced two ways, and both MUST emit this same shape:

1. **Manual UI** — the **Designer** (`/`) authors `nodes`, `edges`, and node **parameters**; the **Process Optimizer** (`/process-optimizer`) adds **variable types**, **constraints**, and the **objective**.
2. **LLM + mapping tool** — generates the equivalent JSON directly (from plant data / a description / NOR as reference).

Run generated (or edited) JSON through `validatePlantGraph()` before the converter — it catches the dangling-reference class of error that otherwise surfaces only as an opaque backend "Solver encountered an error".

## 1. Ownership split (which surface writes what)

| JSON part | Owned by | Notes |
|---|---|---|
| `nodes[].id`, `type`, `position`, `data.label` | **Designer** | topology + identity |
| `nodes[].data.properties[*]` **values/units** | **Designer** | the physical parameters (Capacity, UnitCost, Yield, MoistureContent) |
| `nodes[].data.properties[*].variableType` | **Optimizer** | promotes a property to a `decision`/`exogenous` variable |
| `edges[]` | **Designer** | material flow topology |
| `constraints[]` | **Optimizer** | some graph-derived (flow balance / capacity / inventory), rest authored |
| `objective` | **Optimizer** | sense + revenue/cost terms |

A Designer-only graph is a valid *structure* but not yet a solvable *model* — it has no `decision` variables, no constraints, no objective. The Optimizer layer makes it solvable. (The validator flags "no decision variables" for a structure-only graph — see §5.)

## 2. Top-level shape

```jsonc
{
  "nodes": [ /* §3 */ ],
  "edges": [ /* §4 */ ],
  "constraints": [ /* §5 */ ],
  "objective": { /* §6 */ },
  "metadata": { "name": "...", "periods": 1, "objective": "maximize_profit" },
  "timeConfig": { "periods": 1, "periodLength": 730, "totalHorizon": 730 }
}
```

**`timeConfig.periodLength` (hours) is REQUIRED and load-bearing** — it's the rate→quantity coefficient in every per-period balance (inventory, throughput). The JSON loader honors it directly; if it's absent, duration falls back to `totalHorizon/periods`. NOR uses `730` (≈ a month). Getting this wrong silently corrupts all inventory coefficients (it was a real loader bug — `bdbde1ed`).

**JSON-path fidelity is parity-proven:** a plant loaded via the JSON/visual path (`convertFlowToScenarioFormat`) reproduces the code-factory path (`convertDemoToScenario`) with byte-identical constraints + objective — verified by round-tripping NOR's own graph (`nor2-json-parity.test.js`). So authoring a plant as JSON is equivalent to authoring it in code; no code stage-builders are needed.

## 3. Node

```jsonc
{
  "id": "mixer",                    // dashes allowed; MILP var normalizes [.\-] → _
  "type": "process",               // "navien" (source/storage) | "process"
  "position": { "x": 400, "y": 200 },
  "data": {
    "id": "mixer",
    "label": "Mixer",
    "properties": {                 // OBJECT-form is canonical (analyzeGraph reads it);
      "Throughput_sTPerHr": {       //   array-form [{name,...}] also accepted by the UI
        "value": 0, "type": "number", "unit": "sT/hr",
        "variableType": "decision"  // ← Optimizer layer
      }
    }
  }
}
```

**Property → MILP variable:** `<nodeId>_<propName>_P{period}` (dashes/dots → `_`). E.g. `mixer.Throughput_sTPerHr` → `mixer_Throughput_sTPerHr_P1`.

**variableType** (Optimizer layer): `decision` | `exogenous` | `endogenous` | `parameter` | `processParameter`.
- `decision` — solver chooses (Purchases, Throughput, Production, Sales).
- `exogenous` / `parameter` — adjustable input (UnitCost, SalesPrice) → surfaces editable; becomes a fixed MILP var. `parameter` is a legacy alias of `exogenous`: still emitted by the code model builders (cost-curve segments etc.) and accepted everywhere, but no longer offered in the Process Optimizer UI.
- `endogenous` — derived quantity referenced by constraints (TotalWaterContent…).
- `processParameter` — engineering constant (Yield, Capacity, MoistureContent); NOT a MILP variable — a constant folded into RHS/coefficients.

## 4. Edge

```jsonc
{ "id": "mixer-to-dryer", "source": "mixer", "target": "dryer",
  "type": "custom", "data": { "material": "mixer", "flowType": "material" } }
```
`source`/`target` MUST be existing node ids (validator errors otherwise).

## 5. Constraint (relationships form)

```jsonc
{
  "id": "mixer_balance",                     // constraint names keep dashes; only VAR names normalize
  "type": "relationships",
  "relationshipEquation": "... == 0",        // operator read from here: <= | >= | ==
  "value": 0,                                 // numeric RHS
  "relationshipTerms": [                       // { variable: "node.prop" } OR { target, property }
    { "variable": "hardwood-chips.Purchases_sTPerHr", "coefficient": 1 },
    { "variable": "mixer.Throughput_sTPerHr", "coefficient": -1 }
  ],
  "enabled": true
}
```

**Referential integrity (the load-bearing rule):** every `relationshipTerms[*]` (and objective term) MUST reference a `node.property` that exists. A dangling reference → the backend fails with "Solver encountered an error … references undefined variable". `validatePlantGraph()` is the pre-flight check.

Graph-derived constraint kinds (Process Optimizer, from topology): `flow_balance` (in = out), `capacity` (Σ inputs ≤ node.capacity), `inventory_balance` (storage). Authored kinds: yields, quality (NCV/ash), plant-specific.

## 6. Objective

```jsonc
{ "sense": "maximize",                        // "maximize" | "minimize"
  "terms": [ { "variable": "pellets.Sales_sTPerHr", "coefficient": 180 },
             { "variable": "hardwood-chips.Purchases_sTPerHr", "coefficient": -22 } ] }
```

## 7. Stage vocabulary

The recognized building-block stages. Each has a **Designer part** (node + parameters) and an **Optimizer part** (variable types + constraints + objective contribution). The code builders in `stages/plantStages.js` are the reference implementation; the Designer palette templates (`stages/nodeTemplates.js`) are the manual-path convenience.

| Stage | Node `type` | Designer parameters | Optimizer: decision vars | Optimizer: constraints | Objective |
|---|---|---|---|---|---|
| **Commodity** | navien | UnitCost, Capacity | `Purchases_sTPerHr` | capacity (`Purchases ≤ Capacity`) | − UnitCost·Purchases (cost) |
| **Mixer** | process | Capacity | `Throughput_sTPerHr` | flow balance (Σ inputs − Throughput = 0), capacity | — |
| **Dryer** | process | Yield (+ NOR: OutletMoisture) | `Throughput_sTPerHr` | yield balance (yield·input − Throughput = 0) | — |
| **Pellet Press** | process | Yield | `Throughput_sTPerHr` | yield balance | — |
| **Product (sink)** | process | (Price → objective) | `Production_sTPerHr`, `Sales_sTPerHr` | production balance, `Production − Sales = 0` | + Price·Sales (revenue) |
| **Chipper** *(NOR)* | process | Yield | `Throughput_sTPerHr` | 4-input merge + mixer-quality coupling (entangled — see BACKLOG ITEM-080) | — |
| **Green Hammermill** *(NOR)* | process | Yield | `Throughput_sTPerHr` | passthrough transforms | — |

Node-id reuse: reuse NOR ids (`dryer`, `mixer`, `pellet-press`, `pellets`, `dried-material`) where topology matches so converter/iteration/results logic applies. Stage-specific converter injections gate on **structure** (e.g. dryer-outlet-MC setpoint requires `dryer.OutletMoisture` + a `dried-material` node), not just the node id.

## 8. Validator

`validatePlantGraph(plant, { requireObjective = true }) → { valid, errors, warnings }` (`src/lib/models/plantSchema.js`). Checks:
- structure present (nodes, objective); no duplicate node ids;
- every `variableType` is one of the five; at least one `decision` var (the Optimizer layer exists);
- edges reference existing nodes;
- **every constraint/objective term references an existing `node.property`** (the phantom-var / dangling-reference check);
- `objective.sense ∈ {maximize, minimize}`.

`errors` block conversion/solve; `warnings` are advisories. Grounded against the working `subsetPlant`/`pilotPlant` (they pass) — see `plantSchema.test.js`. **Run any LLM- or UI-produced JSON through this before the converter.**
