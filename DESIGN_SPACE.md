# Design-Space Layer

Status: **proposal to react to** (2026-06-03). Schema: [`schema/design-space.schema.json`](schema/design-space.schema.json). No app code yet — this is the data shape.

## What this is (and isn't)

This tool maps the **as-is** graph and then defines a **design space** around it — the things
that *can* vary, their allowed values, what's fixed, and the objectives. The tool's output is a
**JSON structure + knowledge graph**; an **LLM converts that graph into the search tool**, and a
**separate algorithm searches the space and scores candidates**.

- **In scope here:** declare decision variables + domains, mark uncertainty, model the change
  moves (reroute / invest-in-a-node / eliminate) with their cost+time, declare objectives and
  budgets, and **export a `design_space` artifact**. Import & diff the candidates the search
  returns (reuse the greyscale preview).
- **Out of scope (the external solver/LLM tool):** generating variants, searching, computing
  margin/feasibility scores.
- Because an LLM bridges graph → tool, the data does **not** need to be directly solver-parseable.
  It just needs to be **cleanly structured** (typed fields + labels + free-text notes alongside)
  so the conversion is easy.

## Two layers

**A. Element annotations** (additive, optional fields on existing nodes/edges/flows):

| Construct | Where | Shape |
|---|---|---|
| Quantitative parameter | a node `attributes` / edge `properties` value | string (today) **or** `{ value, unit, uncertainty?, variable? }` |
| Uncertainty | inside a parameter | `{ kind: range\|plus_minus\|confidence\|distribution, … }` — **per quantitative parameter** |
| Decision variable | inside a parameter | `variable: { kind: range\|enum\|boolean, … }` — a value the search may choose |
| Node variant | a node | `variant_of: <base node id>`, `adoption: { cost, time }` |
| Flow economics | a flow in `edge.flows[]` | `value: <parameter>`, `cost: <parameter>` (→ profitability) |
| Edge change-move | an edge | `change: { reroutable, eliminable, cost, time }` |

**B. The `design_space` export** — flattens the above into one artifact for the LLM→tool step:

```json
{
  "design_space": {
    "base_graph_id": "pg-make-to-order",
    "variables": [ /* parameter | node_variant | flow_move refs */ ],
    "objectives": [ /* margin_gain (max), feasibility (hard), uncertainty (min) */ ],
    "budgets":    [ /* change_cost, change_time limits */ ],
    "notes": "free-text guidance for the LLM"
  }
}
```

## Worked example — on the Make-to-Order Line

### A. Element annotations (excerpts)

`CNC machining` node — `cycle_time` promoted to a parameter with **uncertainty** and a **decision range**:

```json
{
  "id": "n_machining", "name": "CNC machining", "type": "task",
  "attributes": {
    "cycle_time": {
      "value": 45, "unit": "s",
      "uncertainty": { "kind": "range", "low": 40, "high": 55 },
      "variable": { "kind": "range", "min": 30, "max": 60, "step": 5, "unit": "s" }
    }
  }
}
```

A **node variant** — invest in high-speed machining (a copy of `n_machining` with a faster
cycle time and an adoption cost/time):

```json
{
  "id": "n_machining_hsm", "name": "CNC machining (HSM upgrade)", "type": "task",
  "variant_of": "n_machining",
  "adoption": { "cost": { "value": 250000, "unit": "USD" }, "time": { "value": 8, "unit": "wk" } },
  "attributes": { "cycle_time": { "value": 30, "unit": "s" } }
}
```

**Flow economics** + **change-move** on the supply edge (raw stock can be re-sourced; carries a
value/cost so profitability is assessable):

```json
{
  "id": "e_purchase_machining", "from_node": "n_purchase", "to_node": "n_machining", "type": "flow",
  "change": { "reroutable": true, "eliminable": false,
              "cost": { "value": 5000, "unit": "USD" }, "time": { "value": 2, "unit": "wk" },
              "notes": "switch to an alternate supplier node" },
  "flows": [{
    "id": "f_raw_stock", "name": "raw stock", "kind": "parts", "quantity": "100", "unit": "kg",
    "value": { "value": 12, "unit": "USD/kg" },
    "cost":  { "value": 8,  "unit": "USD/kg", "uncertainty": { "kind": "plus_minus", "plus_minus": 15, "percent": true } }
  }]
}
```

An **eliminable** flow (a low-value path the network may drop) — e.g. the metered-energy custom edge:

```json
{ "id": "e_energy_machining_custom", "from_node": "r_energy_budget", "to_node": "n_machining",
  "type": "custom",
  "change": { "eliminable": true, "notes": "drop if off-peak scheduling removes the metered draw" } }
```

### B. The exported `design_space`

```json
{
  "design_space": {
    "id": "ds-mto-2026q3",
    "name": "Make-to-Order throughput/margin study",
    "base_graph_id": "pg-make-to-order",
    "variables": [
      { "kind": "parameter", "target": "n_machining.cycle_time",
        "domain": { "kind": "range", "min": 30, "max": 60, "step": 5, "unit": "s" },
        "uncertainty": { "kind": "range", "low": 40, "high": 55 } },
      { "kind": "node_variant", "base": "n_machining",
        "options": ["n_machining", "n_machining_hsm"],
        "adoption": { "cost": { "value": 250000, "unit": "USD" }, "time": { "value": 8, "unit": "wk" } } },
      { "kind": "flow_move", "target": "e_purchase_machining", "moves": ["reroute"],
        "change": { "cost": { "value": 5000, "unit": "USD" }, "time": { "value": 2, "unit": "wk" } } },
      { "kind": "flow_move", "target": "e_energy_machining_custom", "moves": ["eliminate"] }
    ],
    "objectives": [
      { "metric": "margin_gain",  "direction": "max", "kind": "objective" },
      { "metric": "feasibility",  "kind": "hard_constraint",
        "notes": "respect the element-owned constraints (e.g. CNC runs one job at a time)" },
      { "metric": "uncertainty",  "direction": "min", "kind": "soft_constraint" }
    ],
    "budgets": [
      { "metric": "change_cost", "limit": { "value": 300000, "unit": "USD" } },
      { "metric": "change_time", "limit": { "value": 12, "unit": "wk" } }
    ],
    "notes": "Explore throughput vs margin: faster cycle time (range or HSM variant), alternate raw-stock supplier, and dropping the metered-energy edge — within a $300k / 12-week change budget."
  }
}
```

The search tool reads this + the graph, enumerates/optimizes combinations (cycle time × machine
variant × supplier × keep/drop energy edge), respects feasibility + the change budget, and returns
candidate graphs; this tool imports and diffs them against the base.

## How it integrates with the existing model

- **Additive + back-compat.** Every field above is optional; a graph without them is unchanged.
- **`snake_case`** throughout (matches the wire contract).
- **Properties stay "fields to fill."** A value is a plain string by default and is *promoted in
  place* to a `quantitative_parameter` on the same key only where a number matters.
- **Reuses what exists:** element ids (anchors), the constraint model (feasibility), mutation
  deltas + greyscale preview (importing/diffing returned candidates).
- **Schema integration TODO when adopted:** `schema/process-graph.schema.json` sets
  `additionalProperties: false` on `node`/`edge`/`flow`, so adopting these annotations means
  adding the optional props there (or relaxing it), and adding `design_space` to the export
  envelope. Versioned bump per the Propel guardrail.

## Decisions (2026-06-03)

1. **Uncertainty representation** — KEEP the flexible `{ kind: range | plus_minus | confidence |
   distribution }` union.
2. **Variant modeling** — a variant is a **separate node** tagged `variant_of: <base id>` (visible
   and routable on the canvas), not an inline list.
3. **Flow economics** — `value`/`cost` live **on the flow** (supports multi-flow edges), not the edge.
4. **Objectives vocabulary** — `metric` is **free text** (no enforced enum). The editor shows
   **hints/examples of good structure** as placeholders (`margin_gain`, `feasibility`,
   `uncertainty`, `throughput`, `change_cost`, `change_time`). The schema keeps these only as
   non-binding `examples`. Eventually an **integrated LLM in this tool will guide the user's
   writing** of objectives — and other free-text fields (constraints, perspectives, parameter
   notes) — toward well-structured values. Same pattern as the constraint help-tip already shipped.
5. **Change budget** — **global outcomes + per-move breakdown.** Each move carries its own
   `cost`/`time` (`edge.change.*`, variant `adoption.*`); the space declares **global** objectives
   and budgets; the external search reports the global outcome **broken down by move**.
