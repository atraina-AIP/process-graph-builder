"use strict";

const STORAGE_KEY = "process-graph-builder-state-v1";
const LIBRARY_KEY = "process-graph-builder-library-v1";
const API_BASE_STORAGE_KEY = "process-graph-builder-api-base";
const TENANT_STORAGE_KEY = "process-graph-builder-tenant-id";
const LLM_ASSIST_STORAGE_KEY = "process-graph-builder-llm-assist-enabled";
const CURRENT_SAMPLE_GRAPH_ID = "pg-make-to-order";
const LEGACY_SAMPLE_GRAPH_IDS = ["pg-intake-to-close"];
const LEGACY_SAMPLE_GRAPH_NAMES = ["Intake to Close", "Supplier Invoice to Posted", "Invoice to Posted"];

// Current graph-schema version, mirroring the `$comment` version in
// schema/process-graph.schema.json. Stamped into the export envelope
// (P0-0) so downstream tools know which contract an artifact targets.
const SCHEMA_VERSION = "v5";

const MODELING_STYLES = ["none", "business_process", "value_stream", "system_flow", "team_topology", "custom"];
const NODE_TYPES = ["source", "sink", "task", "decision", "resource"];
const NODE_DESCRIPTION_STATUSES = ["empty", "suggested", "custom", "approved"];
const EDGE_TYPES = ["flow", "dependency", "trigger", "feedback", "allocation", "custom"];
const FLOW_KINDS = ["parts", "cash", "energy", "information", "data", "work", "approval", "custom"];
const RESOURCE_TYPES = ["human", "machine", "material", "cost"];
const CONSTRAINT_TYPES = ["flow_balance", "capability_limit", "timing", "routing_rule", "policy_rule"];
const MUTATION_ACTIONS = [
  "add_node",
  "update_node",
  "delete_node",
  "add_edge",
  "update_edge",
  "delete_edge",
  "add_resource",
  "update_resource",
  "add_constraint",
  "update_constraint",
  "add_assumption",
  "add_question",
];

const GRAPH_MUTATION_ACTIONS = ["add_node", "update_node", "delete_node", "add_edge", "update_edge", "delete_edge"];

const OFFICIAL_REFERENCES = {
  bpmn: {
    label: "OMG BPMN 2.0.2",
    url: "https://www.omg.org/spec/BPMN/2.0.2/",
  },
  uml: {
    label: "OMG UML 2.5.1",
    url: "https://www.omg.org/spec/UML/2.5.1/",
  },
  sysml: {
    label: "OMG SysML 2.0",
    url: "https://www.omg.org/spec/SysML/",
  },
  lei_vsm: {
    label: "Lean Enterprise Institute VSM",
    url: "https://www.lean.org/lexicon-terms/value-stream-mapping/",
  },
  team_topologies: {
    label: "Team Topologies",
    url: "https://teamtopologies.com/key-concepts",
  },
};

const NOTATION_PROFILES = {
  none: {
    label: "Plain graph",
    shortLabel: "Graph",
    summary: "Neutral process graph notation. Use it when the vocabulary is still forming.",
    references: [],
    portShape: "circle",
    nodeLegend: [
      ["Source", "Entry boundary"],
      ["Task", "Transformation step"],
      ["Decision", "Branch point"],
      ["Sink", "Terminal boundary"],
      ["Resource", "Resource definition (cylinder)"],
    ],
    edgeLegend: [
      ["Flow", "Solid arrow"],
      ["Dependency", "Dashed arrow"],
      ["Allocation", "Green arrow"],
    ],
  },
  business_process: {
    label: "Business process",
    shortLabel: "BPMN-inspired",
    summary: "BPMN-style events, activities, gateways, and sequence-style arrows in plain language.",
    references: ["bpmn"],
    portShape: "circle",
    nodeLegend: [
      ["Start / source", "Thin event circle"],
      ["Task", "Rounded activity box"],
      ["Decision", "Gateway diamond"],
      ["End / sink", "Heavy event circle"],
      ["Resource", "Resource definition (cylinder)"],
    ],
    edgeLegend: [
      ["Flow", "Solid sequence arrow"],
      ["Information / approval", "Blue or purple flow"],
      ["Dependency", "Dashed association"],
    ],
  },
  value_stream: {
    label: "Value stream",
    shortLabel: "VSM-inspired",
    summary: "Lean VSM-style supplier/customer boundaries, process boxes, and distinct material/information flow.",
    references: ["lei_vsm"],
    portShape: "triangle",
    nodeLegend: [
      ["Source / sink", "Supplier or customer boundary"],
      ["Task", "Process box with data strip"],
      ["Decision", "Control branch"],
      ["Flow", "Material or information movement"],
      ["Resource", "Resource definition (cylinder)"],
    ],
    edgeLegend: [
      ["Parts/material", "Heavy material arrow"],
      ["Information/data", "Dashed information line"],
      ["Cash/energy", "Colored value flow"],
    ],
  },
  system_flow: {
    label: "System flow",
    shortLabel: "SysML-inspired",
    summary: "SysML/UML-inspired blocks, square ports, connectors, item flows, and dependencies.",
    references: ["sysml", "uml"],
    portShape: "square",
    nodeLegend: [
      ["Block", "Compartment rectangle"],
      ["Port", "Square boundary handle"],
      ["Decision", "Control diamond"],
      ["External", "Double-boundary block"],
      ["Resource", "Resource definition (cylinder)"],
    ],
    edgeLegend: [
      ["Item flow", "Solid connector"],
      ["Dependency", "Dashed dependency"],
      ["Energy/data/material", "Typed colored flow"],
    ],
  },
  team_topology: {
    label: "Team topology",
    shortLabel: "Team Topologies",
    summary: "Team Topologies-inspired team shapes and interaction modes for ownership and resource assignment maps.",
    references: ["team_topologies"],
    portShape: "diamond",
    nodeLegend: [
      ["Stream-aligned", "Team block"],
      ["Platform", "Service platform band"],
      ["Enabling", "Dashed helper team"],
      ["Complicated subsystem", "Specialist hex block"],
      ["Resource", "Resource definition (cylinder)"],
    ],
    edgeLegend: [
      ["Allocation", "X-as-a-Service style"],
      ["Collaboration", "Dashed interaction"],
      ["Facilitation", "Dotted helper interaction"],
    ],
  },
  custom: {
    label: "Custom",
    shortLabel: "Custom",
    summary: "Custom visual vocabulary seeded from the graph notation. Edit ontology terms as the model matures.",
    references: ["uml"],
    portShape: "diamond",
    nodeLegend: [
      ["Node", "User-defined semantic element"],
      ["Port", "Explicit input/output handle"],
      ["Decision", "Branching element"],
      ["Boundary", "Graph boundary"],
      ["Resource", "Resource definition (cylinder)"],
    ],
    edgeLegend: [
      ["Flow", "Typed payload movement"],
      ["Dependency", "Constraint relationship"],
      ["Custom", "Ontology-defined relation"],
    ],
  },
};

const DEFAULT_ONTOLOGY = {
  modeling_styles: {
    none: {
      label: "None",
      description: "General graph authoring with plain-language prompts and flexible ontology.",
    },
    business_process: {
      label: "Business process",
      description: "Guidance for approvals, handoffs, responsibilities, policies, and information movement.",
      references: [OFFICIAL_REFERENCES.bpmn],
    },
    value_stream: {
      label: "Value stream",
      description: "Guidance for part flow, information flow, queues, takt, lead time, and waste.",
      references: [OFFICIAL_REFERENCES.lei_vsm],
    },
    system_flow: {
      label: "System flow",
      description: "Guidance for energy, data, material, control, and interface flows across a system.",
      references: [OFFICIAL_REFERENCES.sysml, OFFICIAL_REFERENCES.uml],
    },
    team_topology: {
      label: "Team topology",
      description: "Guidance for mapping teams, roles, handoffs, ownership, capacity, and resource assignments.",
      references: [OFFICIAL_REFERENCES.team_topologies],
    },
    custom: {
      label: "Custom",
      description: "User-defined vocabulary, flow types, properties, and validation expectations.",
      references: [OFFICIAL_REFERENCES.uml],
    },
  },
  node_types: {
    source: {
      label: "Source",
      description: "A boundary where work, material, data, or demand enters the process graph.",
    },
    task: {
      label: "Task",
      description: "A process step that transforms inputs into outputs and may require resources.",
    },
    decision: {
      label: "Decision",
      description: "A branching point. A decision should have two or more outgoing edges with conditions.",
    },
    sink: {
      label: "Sink",
      description: "A terminal boundary where the process outcome leaves the graph or is considered closed.",
    },
    resource: {
      label: "Resource",
      description: "A resource definition (human, machine, material, or cost). It feeds a task via an allocation edge (resource → task) that carries the quantity.",
    },
  },
  edge_types: {
    flow: {
      label: "Flow",
      description: "Something moves from one node to another. The arrow direction also establishes the basic precedence relationship.",
    },
    dependency: {
      label: "Dependency",
      description: "The downstream node depends on the upstream node, even if no cash, part, energy, or information moves.",
    },
    trigger: {
      label: "Trigger",
      description: "An event, signal, request, or state change starts the downstream node.",
    },
    feedback: {
      label: "Feedback",
      description: "A return, rework, correction, or learning loop back to another node.",
    },
    allocation: {
      label: "Allocation",
      description: "A resource, capacity, budget, person, or machine is assigned from one node to another.",
    },
    custom: {
      label: "Custom",
      description: "A user-defined relationship type. Define it in the ontology before relying on it downstream.",
    },
  },
  flow_types: {
    parts: {
      label: "Parts / material",
      description: "Physical parts, components, inventory, product, scrap, or material movement.",
    },
    cash: {
      label: "Cash",
      description: "Money, revenue, cost, payment, invoice, budget, or financial value movement.",
    },
    energy: {
      label: "Energy",
      description: "Electricity, heat, fuel, steam, compressed air, or other energy movement.",
    },
    information: {
      label: "Information",
      description: "Requests, orders, approvals, messages, documents, or knowledge movement.",
    },
    data: {
      label: "Data",
      description: "Records, files, measurements, model inputs, model outputs, or digital data movement.",
    },
    work: {
      label: "Work",
      description: "Cases, jobs, effort, WIP, service work, or process workload movement.",
    },
    approval: {
      label: "Approval",
      description: "Permissions, decisions, sign-offs, exceptions, or authorization movement.",
    },
    custom: {
      label: "Custom",
      description: "A user-defined flow kind. Define its meaning and units in the ontology.",
    },
  },
  constraint_types: {
    flow_balance: {
      label: "Flow balance",
      description: "What comes in must leave, transform, accumulate, or be accounted for as loss, scrap, waste, or storage.",
    },
    capability_limit: {
      label: "Capability limit",
      description: "What a node needs and what it can handle: people, machines, material, budget, capacity, or maximum throughput.",
    },
    timing: {
      label: "Timing",
      description: "How long something takes: duration, delay, wait time, transfer time, cycle time, or lead time.",
    },
    routing_rule: {
      label: "Routing rule",
      description: "When flow goes one way instead of another, usually represented as edge conditions from a decision node.",
    },
    policy_rule: {
      label: "Policy rule",
      description: "A business or operating rule that allows, blocks, requires, or governs behavior.",
    },
  },
  resource_types: {
    human: { label: "Human", description: "People, teams, roles, or skills used by process steps." },
    machine: { label: "Machine", description: "Equipment, systems, tooling, or automated capacity." },
    material: { label: "Material", description: "Physical or informational material consumed, transformed, or moved." },
    cost: { label: "Cost", description: "A monetary cost driver with a rate and a free-text basis unit (e.g. per hour, per unit, per shipment, fixed)." },
  },
  properties: {
    node_definition: {
      label: "Node definition",
      description: "A reviewed plain-language definition of what a specific node means in this graph.",
    },
    description_status: {
      label: "Definition status",
      description: "Whether a node definition is empty, suggested, user-edited, or approved into the ontology.",
    },
    inputs: { label: "Inputs", description: "Named items consumed by a node. A node can have multiple inputs." },
    outputs: { label: "Outputs", description: "Named items produced by a node. A node can have multiple outputs." },
    resources_required: {
      label: "Resources required",
      description: "Extendable requirements on a node, each with a resource name and quantity.",
    },
    condition: { label: "Condition", description: "The plain-language rule that activates this edge." },
    flows: {
      label: "Flows",
      description: "Typed payloads carried by an edge, such as cash, energy, parts, information, data, work, or approval.",
    },
    constraint_fields: {
      label: "Constraint fields",
      description: "Structured constraint parts: type, target, what is governed, rule, value, unit, and notes.",
    },
  },
};

const COMPILER_PROMPT = `You are a process-graph mutation planner.

Your job:
Convert the user's instruction into graph mutation commands.

You must:
1. Use only allowed mutation actions.
2. Preserve existing IDs unless modifying.
3. Never invent numeric values.
4. Create assumptions when information is implied but uncertain.
5. Ask clarification questions when structure is ambiguous.
6. Return strict JSON only.

The graph must remain usable for:
- data inference
- simulation
- optimization
- audit

Allowed node types:
- source
- sink
- task
- decision
- resource

Allowed edge types:
- flow
- dependency
- trigger
- feedback
- allocation
- custom

Allowed flow kinds:
- parts
- cash
- energy
- information
- data
- work
- approval
- custom

Allowed modeling styles:
- none
- business_process
- value_stream
- system_flow
- team_topology
- custom

Allowed constraint types:
- flow_balance
- capability_limit
- timing
- routing_rule
- policy_rule

Plain-language interpretation:
- Directed edges imply precedence. Do not create precedence constraints.
- Timing means how long something takes, not what comes before what.
- Resource requirements and capacity limits compile into capability_limit constraints.
- Conservation, loss, scrap, waste, storage, and transformation compile into flow_balance constraints.
- Branching compiles into decision nodes, edge conditions, and routing_rule constraints when needed.

Allowed mutations:
- add_node
- update_node
- delete_node
- add_edge
- update_edge
- delete_edge
- add_resource
- update_resource
- add_constraint
- update_constraint
- add_assumption
- add_question

Few-shot examples used by the server-side LLM prompt:
- DTA / data-to-action: telemetry or transaction data -> analytics/model scoring -> human review -> approved action system; preserve data, information, approval, and work flows separately.
- Network / distribution: supplier, DC, store/customer, and returns nodes; represent physical movement as parts/material flows and return loops as feedback.
- Manufacturing: order/MRP -> material preparation -> machine/process -> quality decision -> assembly/rework -> ship; represent pass/fail conditions, resources, material/data flows, and routing constraints.
- Plant / structured MILP: preserve reusable optimization structure: node roles, stable IDs, node.property names, variableType hints, units, timeConfig, material-flow metadata, relationship constraints, and objective hints as graph metadata/constraints for future exporters; stage names are examples only, and contracts do not belong in plant topology.`;

const sampleGraph = {
  id: CURRENT_SAMPLE_GRAPH_ID,
  name: "Make-to-Order Line",
  version: "0.1.0",
  description: "Make-to-order manufacturing line (order → machine → inspect → assemble → ship) that exercises every graph feature.",
  modeling_style: "none",
  nodes: [
    { id: "n_order", name: "Customer order", type: "source", inputs: [], outputs: ["order"], attributes: {}, perspectives: [{ label: "Commercial", text: "Orders arrive through the B2B portal with a promised 10-day lead time." }, { label: "Risk", text: "Rush orders can overload the machining cell." }] },
    { id: "n_power", name: "Power supply", type: "source", inputs: [], outputs: ["power"], attributes: {}, description: "Grid and on-site supply feeding the machining cell." },
    { id: "n_plan", name: "Plan production", type: "task", inputs: ["order"], outputs: ["work order"], attributes: { duration: "2 h", planner: "MRP" } },
    { id: "n_purchase", name: "Purchase material", type: "task", inputs: ["work order"], outputs: ["raw stock"], attributes: { lead_time: "5 d", reorder_point: "50" } },
    { id: "n_machining", name: "CNC machining", type: "task", inputs: ["raw stock", "power"], outputs: ["machined part", "measurements"], attributes: { cycle_time: "45 s" }, description: "Cuts raw stock into machined parts on the CNC cell and records inspection measurements.", description_status: "approved" },
    { id: "n_qc", name: "Quality check", type: "decision", inputs: ["machined part"], outputs: ["good part", "defective part"], attributes: {} },
    { id: "n_rework", name: "Rework", type: "task", inputs: ["defective part"], outputs: ["reworked part"], attributes: {} },
    { id: "n_assemble", name: "Assemble", type: "task", inputs: ["good part"], outputs: ["assembled unit"], attributes: {}, perspectives: [{ label: "Quality", text: "Torque specs are verified during assembly." }] },
    { id: "n_ship", name: "Ship order", type: "task", inputs: ["assembled unit"], outputs: ["shipment"], attributes: { carrier: "ground", incoterm: "FOB" } },
    { id: "n_fulfilled", name: "Order fulfilled", type: "sink", inputs: ["shipment"], outputs: [], attributes: {} },
    { id: "r_cnc", name: "CNC machine", type: "resource", inputs: [], outputs: [], attributes: { kind: "machine", cost_rate: "40", basis_unit: "hour", capacity: "1 job" }, description: "3-axis CNC machining center." },
    { id: "r_operator", name: "Machine operator", type: "resource", inputs: [], outputs: [], attributes: { kind: "human", cost_rate: "32", basis_unit: "hour" }, description: "Certified CNC operator." },
    { id: "r_energy_budget", name: "Energy budget", type: "resource", inputs: [], outputs: [], attributes: { kind: "cost", cost_rate: "0.12", basis_unit: "kWh" }, description: "Metered electricity cost pool." },
  ],
  edges: [
    { id: "e_order_plan", from_node: "n_order", to_node: "n_plan", type: "trigger", condition: "", flows: [{ id: "f_order", name: "order", kind: "information", quantity: "", unit: "", properties: {} }] },
    { id: "e_plan_purchase", from_node: "n_plan", to_node: "n_purchase", type: "flow", condition: "", flows: [{ id: "f_work_order", name: "work order", kind: "data", quantity: "", unit: "", properties: {} }] },
    { id: "e_purchase_machining", from_node: "n_purchase", to_node: "n_machining", type: "flow", condition: "", flows: [{ id: "f_raw_stock", name: "raw stock", kind: "parts", quantity: "100", unit: "kg", properties: {} }] },
    { id: "e_power_machining", from_node: "n_power", to_node: "n_machining", type: "flow", condition: "", flows: [{ id: "f_power", name: "power", kind: "energy", quantity: "15", unit: "kWh", properties: {} }] },
    { id: "e_machining_qc", from_node: "n_machining", to_node: "n_qc", type: "flow", condition: "", description: "Machined parts move to inspection with their measurement data.", properties: { takt_time: "45 s" }, flows: [{ id: "f_machined_part", name: "machined part", kind: "parts", quantity: "100", unit: "pcs", properties: {} }, { id: "f_measurements", name: "inspection measurements", kind: "data", quantity: "", unit: "", properties: {} }] },
    { id: "e_qc_assemble", from_node: "n_qc", to_node: "n_assemble", type: "flow", condition: "if pass", flows: [{ id: "f_good_part", name: "good part", kind: "parts", quantity: "", unit: "", properties: {} }] },
    { id: "e_qc_rework", from_node: "n_qc", to_node: "n_rework", type: "flow", condition: "if fail", flows: [{ id: "f_defective_part", name: "defective part", kind: "parts", quantity: "", unit: "", properties: {} }] },
    { id: "e_rework_qc", from_node: "n_rework", to_node: "n_qc", type: "feedback", condition: "", flows: [{ id: "f_reworked_part", name: "reworked part", kind: "parts", quantity: "", unit: "", properties: {} }] },
    { id: "e_assemble_ship", from_node: "n_assemble", to_node: "n_ship", type: "flow", condition: "", flows: [{ id: "f_assembled_unit", name: "assembled unit", kind: "parts", quantity: "", unit: "", properties: {} }, { id: "f_pack", name: "pack and label", kind: "work", quantity: "", unit: "", properties: {} }] },
    { id: "e_ship_fulfilled", from_node: "n_ship", to_node: "n_fulfilled", type: "flow", condition: "", perspectives: [{ label: "Finance", text: "Invoice payment is captured on shipment." }], flows: [{ id: "f_release", name: "shipping release", kind: "approval", quantity: "", unit: "", properties: {} }, { id: "f_payment", name: "invoice payment", kind: "cash", quantity: "1", unit: "invoice", properties: {} }] },
    { id: "e_purchase_assemble_dep", from_node: "n_purchase", to_node: "n_assemble", type: "dependency", condition: "", flows: [] },
    { id: "e_energy_machining_custom", from_node: "r_energy_budget", to_node: "n_machining", type: "custom", condition: "", flows: [{ id: "f_metered", name: "metered energy", kind: "custom", quantity: "", unit: "", properties: {} }] },
    { id: "e_alloc_cnc_machining", from_node: "r_cnc", to_node: "n_machining", type: "allocation", condition: "qty: 1", properties: { quantity: "1" }, flows: [] },
    { id: "e_alloc_operator_machining", from_node: "r_operator", to_node: "n_machining", type: "allocation", condition: "qty: 1", properties: { quantity: "1" }, flows: [] },
  ],
  resources: [],
  constraints: [
    { id: "c_qc_balance", type: "flow_balance", fields: { target: "n_qc" }, expression: "Every machined part leaves Quality check as either a good part (to Assemble) or a defective part (to Rework)." },
    { id: "c_qc_routing", type: "routing_rule", fields: { target: "n_qc" }, expression: "Pass parts route to Assemble; fail parts route to Rework." },
    { id: "c_cnc_capacity", type: "capability_limit", fields: { target: "n_machining" }, expression: "CNC machining runs one job at a time; extra jobs queue until the cell is free." },
    { id: "c_rework_timing", type: "timing", fields: { target: "e_rework_qc" }, expression: "Reworked parts must return to inspection within 2 hours." },
    { id: "c_ship_policy", type: "policy_rule", fields: { target: "n_ship" }, expression: "Do not ship before quality sign-off and shipping release." },
  ],
  assumptions: [
    { id: "a_lead_time", text: "Promised lead time is 10 working days from order to shipment." },
    { id: "a_single_shift", text: "The machining cell runs one shift unless rush orders require overtime." },
  ],
  metadata: {
    created_by: "Codex MVP",
    created_at: "2026-05-05T00:00:00.000Z",
    tags: ["mvp", "decision-grade", "process-graph"],
  },
  ontology: clone(DEFAULT_ONTOLOGY),
};

const sampleLayout = {
  n_order: { x: 60, y: 200 },
  n_power: { x: 300, y: 50 },
  n_plan: { x: 280, y: 200 },
  n_purchase: { x: 500, y: 200 },
  n_machining: { x: 720, y: 200 },
  n_qc: { x: 940, y: 200 },
  n_rework: { x: 940, y: 380 },
  n_assemble: { x: 1160, y: 200 },
  n_ship: { x: 1380, y: 200 },
  n_fulfilled: { x: 1580, y: 200 },
  r_cnc: { x: 680, y: 380 },
  r_operator: { x: 800, y: 380 },
  r_energy_budget: { x: 720, y: 470 },
};

let graph = clone(sampleGraph);
let layout = clone(sampleLayout);
let selected = { kind: "node", id: "n_machining" };
let pendingPlan = null;
let mutationLog = [];
let openQuestions = [];
let allowCycles = true;
let validateCurrentView = false;
let dragState = null;
let connectState = null;
let panState = null;
let toastTimer = null;
let addNodeFormOpen = false;
let leftPanelCollapsed = false;
let legendCollapsed = false;
let chatMessages = [];
let undoStack = [];
let clarificationContext = null;
let canvasView = { x: 0, y: 0, zoom: 1 };
let activeFilter = createEmptyFilter();
let currentFileHandle = null;
let currentFileName = "";
let backendAvailable = null;
let backendSession = null;
let llmAssistEnabled = false;
let cloudLibrary = { graphs: [] };
let cloudLibraryLoaded = false;
let cloudLibraryStatus = "local";
// In-memory id of the saved view whose filter is currently applied (null when
// the active filter is a custom/unsaved combination). Persisted as UI state in
// the envelope (active_view_id) but never stored on the graph.
let activeViewId = null;

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  loadState();
  bindEvents();
  render();
  hydrateFromBackendOnLoad();
});

function bindElements() {
  [
    "resetGraphButton",
    "clearGraphButton",
    "autoLayoutButton",
    "addNodeSelect",
    "importFileInput",
    "openSaveButton",
    "openLoadButton",
    "saveDialog",
    "saveGraphName",
    "saveToLibraryButton",
    "saveToOpenedFileButton",
    "saveAsFileButton",
    "saveExportJsonButton",
    "saveExportMarkdownButton",
    "saveCopyJsonButton",
    "fileSaveStatus",
    "closeSaveButton",
    "libraryDialog",
    "closeLibraryButton",
    "openFilePickerButton",
    "importFromFileButton",
    "libraryList",
    "elementEditorDialog",
    "elementEditorTitle",
    "closeElementEditorButton",
    "editorDetailsPanel",
    "editorConstraintsPanel",
    "elementConstraints",
    "openOntologyButton",
    "ontologyDialog",
    "closeOntologyButton",
    "openValidationButton",
    "validationDialog",
    "closeValidationButton",
    "validationStatusDot",
    "saveExportDesignSpaceButton",
    "openDesignSpaceButton",
    "designSpaceDialog",
    "closeDesignSpaceButton",
    "designSpaceVariables",
    "designSpaceObjectives",
    "designSpaceBudgets",
    "designSpaceNotes",
    "workspace",
    "leftPanel",
    "toggleLeftPanelButton",
    "chatInput",
    "sendInstructionButton",
    "planMutationsButton",
    "applyPlanButton",
    "discardPlanButton",
    "undoButton",
    "llmAssistToggle",
    "llmAssistStatus",
    "chatScroll",
    "planPreview",
    "planStatus",
    "mutationLog",
    "promptTemplate",
    "modelingStyleOptions",
    "graphCanvas",
    "graphSubtitle",
    "nodeCount",
    "edgeCount",
    "selectedStatus",
    "inspectorContent",
    "zoomOutButton",
    "zoomLevelLabel",
    "zoomInButton",
    "fitCanvasButton",
    "resetViewButton",
    "viewsButton",
    "viewsPopover",
    "viewsCloseButton",
    "viewFlowKindChips",
    "viewEdgeTypeChips",
    "viewNodeTypeChips",
    "viewFocusSelection",
    "viewClearButton",
    "savedViewsList",
    "savedViewNameInput",
    "saveViewButton",
    "viewStatus",
    "notationLegend",
    "legendToggleButton",
    "canvasMinimap",
    "validationList",
    "readinessBadge",
    "allowCyclesInput",
    "validateViewInput",
    "validationScopeNote",
    "ontologySearchInput",
    "inferOntologyButton",
    "ontologyContent",
    "toast",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els.promptTemplate.textContent = COMPILER_PROMPT;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  // #notationLegend (and its toggle button) is re-rendered on each render(),
  // so delegate the toggle click from the stable container element.
  if (els.notationLegend) {
    els.notationLegend.addEventListener("click", (event) => {
      if (event.target.closest("#legendToggleButton")) {
        toggleLegendCollapsed();
      }
    });
  }

  els.addNodeSelect.addEventListener("change", (event) => {
    const type = event.target.value;
    if (!type) return;
    addNodeFromToolbar(type);
    event.target.value = "";
  });

  els.planMutationsButton.addEventListener("click", planFromInstruction);
  els.sendInstructionButton.addEventListener("click", planFromInstruction);
  els.chatInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      planFromInstruction();
    }
  });

  if (els.llmAssistToggle) {
    els.llmAssistToggle.addEventListener("change", () => {
      llmAssistEnabled = Boolean(els.llmAssistToggle.checked);
      localStorage.setItem(LLM_ASSIST_STORAGE_KEY, String(llmAssistEnabled));
      renderLlmAssistToggle();
      saveState();
    });
  }

  els.applyPlanButton.addEventListener("click", () => {
    if (!pendingPlan) return;
    const plan = pendingPlan;
    pendingPlan = null;
    applyMutations(plan.mutations);
    const plannedQuestionMutations = new Set(
      plan.mutations
        .filter((mutation) => mutation.action === "add_question")
        .map((mutation) => mutation.payload?.text || mutation.payload?.question || "")
    );
    if (plan.questions.length) {
      plan.questions.forEach((question) => {
        if (plannedQuestionMutations.has(question)) return;
        applyMutation({
          action: "add_question",
          target_id: null,
          payload: { text: question },
          reason: "Clarification requested by compiler",
          confidence: "medium",
        });
      });
    }
    syncBackendMutations(plan.mutations);
    appendChatMessage("assistant", buildAssistantReply(plan, { applied: true }));
    renderPlan();
    renderChatMessages();
    renderUndoState();
    saveState();
    toast("Mutations applied");
  });

  els.discardPlanButton.addEventListener("click", discardPendingPlan);
  els.undoButton.addEventListener("click", undoLastMutationBatch);

  els.toggleLeftPanelButton.addEventListener("click", () => {
    leftPanelCollapsed = !leftPanelCollapsed;
    renderPanelCollapse();
    requestAnimationFrame(() => {
      renderCanvas();
      renderMinimap();
    });
    saveState();
  });

  els.modelingStyleOptions.addEventListener("change", handleModelingStyleChange);
  els.autoLayoutButton.addEventListener("click", () => {
    autoLayoutGraph();
    render();
    toast("Graph laid out");
  });
  els.importFileInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importGraphFromFile(file, { clearFileHandle: true });
    event.target.value = "";
  });
  els.openSaveButton.addEventListener("click", openSaveDialog);
  els.closeSaveButton.addEventListener("click", closeSaveDialog);
  els.saveToLibraryButton.addEventListener("click", () => saveCurrentToLibrary(els.saveGraphName.value));
  els.saveToOpenedFileButton.addEventListener("click", saveGraphToOpenedFile);
  els.saveAsFileButton.addEventListener("click", saveGraphAsFile);
  els.saveExportJsonButton.addEventListener("click", downloadGraphJson);
  els.saveExportMarkdownButton.addEventListener("click", downloadMarkdown);
  els.saveCopyJsonButton.addEventListener("click", copyGraphJson);
  els.openLoadButton.addEventListener("click", openLibrary);
  els.closeLibraryButton.addEventListener("click", closeLibrary);
  els.openFilePickerButton.addEventListener("click", openGraphFileWithPicker);
  els.importFromFileButton.addEventListener("click", () => els.importFileInput.click());
  els.closeElementEditorButton.addEventListener("click", closeElementEditor);
  document.querySelectorAll("[data-editor-tab]").forEach((button) => {
    button.addEventListener("click", () => switchEditorTab(button.dataset.editorTab));
  });
  els.elementConstraints.addEventListener("input", handleElementConstraintInput);
  els.elementConstraints.addEventListener("change", handleElementConstraintInput);
  els.elementConstraints.addEventListener("click", handleElementConstraintClick);
  els.openOntologyButton.addEventListener("click", openOntologyDialog);
  els.closeOntologyButton.addEventListener("click", closeOntologyDialog);
  els.openValidationButton.addEventListener("click", openValidationDialog);
  els.closeValidationButton.addEventListener("click", closeValidationDialog);
  els.openDesignSpaceButton.addEventListener("click", openDesignSpaceDialog);
  els.closeDesignSpaceButton.addEventListener("click", closeDesignSpaceDialog);
  els.saveExportDesignSpaceButton.addEventListener("click", downloadDesignSpaceJson);
  // Text inputs patch state in place (no re-render, preserves focus); add/delete
  // and select changes re-render the dialog.
  els.designSpaceObjectives.addEventListener("input", handleDesignSpaceObjectiveInput);
  els.designSpaceObjectives.addEventListener("change", handleDesignSpaceObjectiveInput);
  els.designSpaceObjectives.addEventListener("click", handleDesignSpaceObjectiveClick);
  els.designSpaceBudgets.addEventListener("input", handleDesignSpaceBudgetInput);
  els.designSpaceBudgets.addEventListener("click", handleDesignSpaceBudgetClick);
  els.designSpaceNotes.addEventListener("input", handleDesignSpaceNotesInput);
  els.libraryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-library-action]");
    if (!button) return;
    const row = button.closest("[data-entry-id]");
    if (!row) return;
    const action = button.dataset.libraryAction;
    if (action === "load") loadFromLibrary(row.dataset.entryId);
    else if (action === "duplicate") duplicateLibraryEntry(row.dataset.entryId);
    else if (action === "delete") deleteLibraryEntry(row.dataset.entryId);
  });
  els.resetGraphButton.addEventListener("click", resetGraph);
  els.clearGraphButton.addEventListener("click", clearGraph);
  els.allowCyclesInput.addEventListener("change", () => {
    allowCycles = els.allowCyclesInput.checked;
    renderValidation();
    saveState();
  });
  els.validateViewInput.addEventListener("change", () => {
    validateCurrentView = els.validateViewInput.checked;
    renderValidation();
    saveState();
  });

  els.graphCanvas.addEventListener("dblclick", handleCanvasDoubleClick);
  els.graphCanvas.addEventListener("pointerdown", handleCanvasPointerDown);
  els.graphCanvas.addEventListener("pointermove", handleCanvasPointerMove);
  els.graphCanvas.addEventListener("pointerup", handleCanvasPointerUp);
  els.graphCanvas.addEventListener("lostpointercapture", handleCanvasPointerUp);
  els.graphCanvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
  window.addEventListener("pointerup", handleCanvasPointerUp);
  window.addEventListener("pointercancel", handleCanvasPointerUp);
  els.zoomOutButton.addEventListener("click", () => zoomCanvasBy(0.82));
  els.zoomInButton.addEventListener("click", () => zoomCanvasBy(1.22));
  els.fitCanvasButton.addEventListener("click", fitCanvasToGraph);
  els.resetViewButton.addEventListener("click", resetCanvasView);
  els.viewsButton.addEventListener("click", toggleViewsPopover);
  els.viewsCloseButton.addEventListener("click", closeViewsPopover);
  els.viewsPopover.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-view-dim]");
    if (chip) toggleViewFilter(chip.dataset.viewDim, chip.dataset.viewValue);
  });
  els.viewFocusSelection.addEventListener("change", toggleFocusSelection);
  els.viewClearButton.addEventListener("click", clearViewFilter);
  els.saveViewButton.addEventListener("click", () => saveCurrentView(els.savedViewNameInput.value));
  els.savedViewNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveCurrentView(els.savedViewNameInput.value);
    }
  });
  els.savedViewsList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-action]");
    if (!button) return;
    const id = button.dataset.viewId;
    if (button.dataset.viewAction === "apply") applySavedView(id);
    else if (button.dataset.viewAction === "delete") deleteSavedView(id);
  });
  els.viewStatus.addEventListener("click", (event) => {
    if (event.target.closest(".view-clear")) clearViewFilter();
  });
  els.canvasMinimap.addEventListener("pointerdown", handleMinimapPointerDown);

  els.inspectorContent.addEventListener("input", handleInspectorInput);
  els.inspectorContent.addEventListener("change", handleInspectorInput);
  els.inspectorContent.addEventListener("click", handleInspectorClick);
  els.ontologySearchInput.addEventListener("input", renderOntology);
  els.inferOntologyButton.addEventListener("click", () => {
    inferOntologyFromGraph();
    renderOntology();
    toast("Ontology inferred from graph");
  });
  els.ontologyContent.addEventListener("input", handleOntologyInput);
  window.addEventListener("resize", () => renderCanvas());
}

function switchTab(tabName) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });

  ["chat", "log", "prompt"].forEach((name) => {
    const tab = document.getElementById(`${name}Tab`);
    tab.classList.toggle("is-active", name === tabName);
  });
}

// Restores the full working state from a snake_case envelope (the shape
// serializeState/exportEnvelope produce). camelCase fallbacks migrate state
// saved by older builds. Shared by loadState (localStorage) and the library.
function applyEnvelopeToState(env) {
  graph = env.graph;
  layout = env.layout || {};
  selected = env.selected || selected;
  mutationLog = readEnvelopeField(env, "mutation_log", "mutationLog", []) || [];
  openQuestions = readEnvelopeField(env, "open_questions", "openQuestions", []) || [];
  const savedAllowCycles = readEnvelopeField(env, "allow_cycles", "allowCycles", undefined);
  allowCycles = savedAllowCycles !== undefined ? Boolean(savedAllowCycles) : true;
  validateCurrentView = Boolean(readEnvelopeField(env, "validate_current_view", "validateCurrentView", false));
  const savedLlmAssist = readEnvelopeField(env, "llm_assist_enabled", "llmAssistEnabled", undefined);
  llmAssistEnabled = savedLlmAssist !== undefined ? Boolean(savedLlmAssist) : localStorage.getItem(LLM_ASSIST_STORAGE_KEY) === "true";
  addNodeFormOpen = Boolean(readEnvelopeField(env, "add_node_form_open", "addNodeFormOpen", false));
  leftPanelCollapsed = Boolean(readEnvelopeField(env, "left_panel_collapsed", "leftPanelCollapsed", false));
  legendCollapsed = Boolean(readEnvelopeField(env, "legend_collapsed", "legendCollapsed", false));
  const savedChat = readEnvelopeField(env, "chat_messages", "chatMessages", []);
  chatMessages = Array.isArray(savedChat) ? savedChat : [];
  const savedUndo = readEnvelopeField(env, "undo_stack", "undoStack", []);
  undoStack = Array.isArray(savedUndo) ? savedUndo : [];
  clarificationContext = readEnvelopeField(env, "clarification_context", "clarificationContext", null) || null;
  canvasView = normalizeCanvasView(readEnvelopeField(env, "canvas_view", "canvasView", canvasView));
  activeFilter = normalizeFilter(readEnvelopeField(env, "active_filter", "activeFilter", null));
  ensureGraphShape();
  const savedViewId = readEnvelopeField(env, "active_view_id", "activeViewId", null);
  activeViewId = graph.saved_views.some((view) => view.id === savedViewId) ? savedViewId : null;
  normalizeLayout();
}

function loadState() {
  llmAssistEnabled = localStorage.getItem(LLM_ASSIST_STORAGE_KEY) === "true";
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || !saved.graph) return;
    if (isLegacyUntouchedSampleEnvelope(saved)) return;
    applyEnvelopeToState(saved);
  } catch (error) {
    console.warn("Unable to load saved graph", error);
  }
}

function isLegacyUntouchedSampleEnvelope(env) {
  const savedGraph = env?.graph;
  if (!savedGraph || savedGraph.id === CURRENT_SAMPLE_GRAPH_ID) return false;

  const mutationEntries = readEnvelopeField(env, "mutation_log", "mutationLog", []);
  const chatEntries = readEnvelopeField(env, "chat_messages", "chatMessages", []);
  const openQuestionEntries = readEnvelopeField(env, "open_questions", "openQuestions", []);
  const undoEntries = readEnvelopeField(env, "undo_stack", "undoStack", []);
  const hasUserHistory = [mutationEntries, chatEntries, openQuestionEntries, undoEntries].some(
    (entries) => Array.isArray(entries) && entries.length
  );
  if (hasUserHistory) return false;

  const legacyId = LEGACY_SAMPLE_GRAPH_IDS.includes(savedGraph.id);
  const legacyName = LEGACY_SAMPLE_GRAPH_NAMES.includes(savedGraph.name);
  const nodeNames = new Set((savedGraph.nodes || []).map((node) => String(node.name || "").toLowerCase()));
  const invoiceDemo =
    nodeNames.has("supplier invoice") &&
    (nodeNames.has("match invoice") || nodeNames.has("resolve variance") || nodeNames.has("posted"));

  return legacyId || legacyName || invoiceDemo;
}

// The full working-state envelope, snake_case on the wire (public contract).
function serializeState() {
  return {
    graph,
    layout,
    selected,
    mutation_log: mutationLog,
    open_questions: openQuestions,
    allow_cycles: allowCycles,
    validate_current_view: validateCurrentView,
    llm_assist_enabled: llmAssistEnabled,
    add_node_form_open: addNodeFormOpen,
    left_panel_collapsed: leftPanelCollapsed,
    legend_collapsed: legendCollapsed,
    chat_messages: chatMessages,
    undo_stack: undoStack,
    clarification_context: clarificationContext,
    canvas_view: canvasView,
    active_filter: activeFilter,
    active_view_id: activeViewId,
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
}

// --- Graph library (named save/load) ---------------------------------------

function loadLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "null");
    if (parsed && Array.isArray(parsed.graphs)) return parsed;
  } catch (error) {
    console.warn("Unable to load graph library", error);
  }
  return { graphs: [] };
}

function saveLibrary(library) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
}

function libraryEntryId(name) {
  return `lib_${slug(name) || "graph"}_${Date.now()}`;
}

function formatTimestamp(iso) {
  if (!iso) return "unknown";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

async function saveCurrentToLibrary(name) {
  const cleanName = (name || "").trim() || graph.name || "Untitled Process Graph";
  graph.name = cleanName;

  if (await saveCurrentToCloudLibrary(cleanName)) return;

  const library = loadLibrary();
  const envelope = clone(serializeState());
  const timestamp = new Date().toISOString();
  const existing = library.graphs.find((entry) => entry.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    existing.envelope = envelope;
    existing.updated_at = timestamp;
    existing.node_count = graph.nodes.length;
    existing.edge_count = graph.edges.length;
  } else {
    library.graphs.push({
      id: libraryEntryId(cleanName),
      name: cleanName,
      saved_at: timestamp,
      updated_at: timestamp,
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      envelope,
    });
  }
  saveLibrary(library);
  saveState();
  renderLibrary();
  closeSaveDialog();
  toast(existing ? `Updated "${cleanName}" in local library` : `Saved "${cleanName}" to local library`);
}

async function saveCurrentToCloudLibrary(cleanName) {
  if (!(await isBackendAvailable())) return false;
  const base = apiBase();
  const envelope = clone(serializeState());
  envelope.graph = clone(graph);
  try {
    const response = await fetch(`${base}/graph/${encodeURIComponent(graph.id)}/envelope`, {
      method: "PUT",
      headers: backendJsonHeaders(),
      body: JSON.stringify({ envelope }),
    });
    if (!response.ok) {
      toast(`Cloud save failed (status ${response.status}); saved locally instead.`);
      return false;
    }
    await refreshCloudLibrary({ silent: true });
    saveState();
    renderLibrary();
    closeSaveDialog();
    toast(`Saved "${cleanName}" to cloud library`);
    return true;
  } catch (error) {
    console.warn("Unable to save to cloud library", error);
    toast("Cloud save unavailable; saved locally instead.");
    backendAvailable = false;
    return false;
  }
}

async function loadFromLibrary(entryId) {
  if (cloudLibraryLoaded) {
    await loadFromCloudLibrary(entryId);
    return;
  }

  const library = loadLibrary();
  const entry = library.graphs.find((item) => item.id === entryId);
  if (!entry || !entry.envelope) {
    toast("Saved graph not found");
    return;
  }
  // Clone so edits to the loaded graph never mutate the stored library entry.
  applyEnvelopeToState(clone(entry.envelope));
  clearCurrentFileHandle();
  pendingPlan = null;
  clarificationContext = null;
  renderPlan();
  render();
  closeLibrary();
  toast(`Loaded "${entry.name}"`);
}

async function loadFromCloudLibrary(entryId) {
  const base = apiBase();
  try {
    const response = await fetch(`${base}/graph/${encodeURIComponent(entryId)}/envelope`, {
      headers: backendHeaders(),
    });
    if (!response.ok) {
      toast(`Cloud graph load failed (status ${response.status})`);
      return;
    }
    const envelope = await response.json();
    if (!envelope?.graph) {
      toast("Cloud graph did not include a graph envelope");
      return;
    }
    applyEnvelopeToState(envelope);
    clearCurrentFileHandle();
    pendingPlan = null;
    clarificationContext = null;
    renderPlan();
    render();
    closeLibrary();
    toast(`Loaded "${envelope.graph.name || entryId}" from cloud`);
  } catch (error) {
    console.warn("Unable to load cloud graph", error);
    toast("Could not load cloud graph");
  }
}

function duplicateLibraryEntry(entryId) {
  if (cloudLibraryLoaded) {
    toast("Duplicate is available for local library entries only");
    return;
  }
  const library = loadLibrary();
  const entry = library.graphs.find((item) => item.id === entryId);
  if (!entry) return;
  const copyName = `${entry.name} copy`;
  const timestamp = new Date().toISOString();
  library.graphs.push({
    ...clone(entry),
    id: libraryEntryId(copyName),
    name: copyName,
    saved_at: timestamp,
    updated_at: timestamp,
  });
  saveLibrary(library);
  renderLibrary();
  toast(`Duplicated as "${copyName}"`);
}

function deleteLibraryEntry(entryId) {
  if (cloudLibraryLoaded) {
    toast("Delete is not enabled for cloud library entries yet");
    return;
  }
  const library = loadLibrary();
  const entry = library.graphs.find((item) => item.id === entryId);
  if (!entry) return;
  if (!window.confirm(`Delete "${entry.name}" from the library? This cannot be undone.`)) return;
  library.graphs = library.graphs.filter((item) => item.id !== entryId);
  saveLibrary(library);
  renderLibrary();
  toast(`Deleted "${entry.name}"`);
}

function activeLibrary() {
  return cloudLibraryLoaded ? cloudLibrary : loadLibrary();
}

function renderLibrary() {
  if (!els.libraryList) return;
  if (cloudLibraryStatus === "loading") {
    els.libraryList.innerHTML = `<div class="library-empty">Loading cloud library...</div>`;
    return;
  }
  const isCloud = cloudLibraryLoaded;
  const library = activeLibrary();
  const entries = [...library.graphs].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  if (!entries.length) {
    const target = isCloud ? "cloud library" : "local library";
    els.libraryList.innerHTML = `<div class="library-empty">No saved graphs yet. Use Save to add the current graph to the ${target}.</div>`;
    return;
  }
  els.libraryList.innerHTML = entries
    .map((entry) => {
      const nodeCount = entry.envelope?.graph?.nodes?.length ?? entry.node_count ?? 0;
      const edgeCount = entry.envelope?.graph?.edges?.length ?? entry.edge_count ?? 0;
      const updated = formatTimestamp(entry.updated_at || entry.saved_at);
      const source = isCloud ? "Cloud" : "Local";
      const localActions = isCloud
        ? ""
        : `<button class="button secondary" type="button" data-library-action="duplicate">Duplicate</button>
           <button class="button secondary danger" type="button" data-library-action="delete">Delete</button>`;
      return `
        <div class="library-row" data-entry-id="${escapeAttribute(entry.id)}">
          <div class="library-row-main">
            <strong>${escapeHtml(entry.name)}</strong>
            <span>${source} | ${nodeCount} nodes | ${edgeCount} edges | ${escapeHtml(updated)}</span>
          </div>
          <div class="library-row-actions">
            <button class="button secondary" type="button" data-library-action="load">Load</button>
            ${localActions}
          </div>
        </div>
      `;
    })
    .join("");
}

async function openLibrary() {
  cloudLibraryStatus = "loading";
  renderLibrary();
  if (typeof els.libraryDialog.showModal === "function") {
    els.libraryDialog.showModal();
  } else {
    els.libraryDialog.setAttribute("open", "");
  }
  await refreshCloudLibrary();
  renderLibrary();
}

async function refreshCloudLibrary(options = {}) {
  const settings = { silent: false, ...options };
  if (!(await isBackendAvailable())) {
    cloudLibraryLoaded = false;
    cloudLibraryStatus = "local";
    return false;
  }
  cloudLibraryStatus = "loading";
  try {
    const response = await fetch(`${apiBase()}/graphs`, { headers: backendHeaders() });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json();
    cloudLibrary = { graphs: Array.isArray(body.graphs) ? body.graphs : [] };
    cloudLibraryLoaded = true;
    cloudLibraryStatus = "cloud";
    return true;
  } catch (error) {
    console.warn("Unable to load cloud graph library", error);
    cloudLibraryLoaded = false;
    cloudLibraryStatus = "local";
    if (!settings.silent) toast("Cloud library unavailable; showing local library");
    return false;
  }
}

function closeLibrary() {
  if (typeof els.libraryDialog.close === "function") {
    els.libraryDialog.close();
  } else {
    els.libraryDialog.removeAttribute("open");
  }
}

function openSaveDialog() {
  els.saveGraphName.value = graph.name || "";
  updateFileAccessUi();
  if (typeof els.saveDialog.showModal === "function") {
    els.saveDialog.showModal();
  } else {
    els.saveDialog.setAttribute("open", "");
  }
}

function closeSaveDialog() {
  if (typeof els.saveDialog.close === "function") {
    els.saveDialog.close();
  } else {
    els.saveDialog.removeAttribute("open");
  }
}

// --- Element editor modal (P0-5) -------------------------------------------
// Per-element (node/edge) editing opens in a modal on double-click. The editor
// body physically contains #inspectorContent, so renderInspector() and the
// delegated input/click handlers keep working unchanged.

function handleCanvasDoubleClick(event) {
  const nodeId = event.target.closest(".node-group")?.dataset.nodeId;
  const edgeId = event.target.closest("[data-edge-id]")?.dataset.edgeId;
  if (nodeId) {
    selected = { kind: "node", id: nodeId };
  } else if (edgeId) {
    selected = { kind: "edge", id: edgeId };
  } else {
    return; // ignore double-click on empty canvas
  }
  render();
  openElementEditor();
}

function openElementEditor() {
  if (!selected.kind || !selected.id) return;
  let title = "Edit element";
  if (selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    title = node ? `Node — ${node.name || node.id}` : "Edit node";
  } else if (selected.kind === "edge") {
    const edge = graph.edges.find((item) => item.id === selected.id);
    title = edge ? `Edge — ${edge.id}` : "Edit edge";
  }
  els.elementEditorTitle.textContent = title;
  renderInspector();
  renderElementConstraints();
  switchEditorTab("details");
  if (typeof els.elementEditorDialog.showModal === "function") {
    els.elementEditorDialog.showModal();
  } else {
    els.elementEditorDialog.setAttribute("open", "");
  }
}

function switchEditorTab(name) {
  document.querySelectorAll("[data-editor-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.editorTab === name);
  });
  if (els.editorDetailsPanel) els.editorDetailsPanel.classList.toggle("is-active", name === "details");
  if (els.editorConstraintsPanel) els.editorConstraintsPanel.classList.toggle("is-active", name === "constraints");
  if (name === "constraints") renderElementConstraints();
}

function closeElementEditor() {
  if (typeof els.elementEditorDialog.close === "function") {
    els.elementEditorDialog.close();
  } else {
    els.elementEditorDialog.removeAttribute("open");
  }
}

// --- Relocated graph-level dialogs (P0-5) ----------------------------------
// Ontology and Validation moved off the removed right panel into topbar-opened
// modals. Each dialog body holds the same content ids the render functions
// target, so renderOntology / renderValidation keep working whether the dialog
// is open or closed. (Constraints moved into the element editor modal instead.)

function showDialog(dialog) {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function hideDialog(dialog) {
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function openOntologyDialog() {
  renderOntology();
  showDialog(els.ontologyDialog);
}

function closeOntologyDialog() {
  hideDialog(els.ontologyDialog);
}

function openValidationDialog() {
  renderValidation();
  showDialog(els.validationDialog);
}

function closeValidationDialog() {
  hideDialog(els.validationDialog);
}

// --- Subgraph views / quick filters (ephemeral) ----------------------------
// A view is a pure filter over the canonical graph, resolved to visible id sets
// at render time. Non-destructive: the graph is never mutated; out-of-view
// elements are dimmed (focus mode), not removed.

function createEmptyFilter() {
  return { flow_kinds: [], edge_types: [], node_types: [], focus_selection: false, hops: 1 };
}

function normalizeFilter(filter) {
  if (!filter || typeof filter !== "object") return createEmptyFilter();
  return {
    flow_kinds: Array.isArray(filter.flow_kinds) ? filter.flow_kinds.filter((k) => FLOW_KINDS.includes(k)) : [],
    edge_types: Array.isArray(filter.edge_types) ? filter.edge_types.filter((k) => EDGE_TYPES.includes(k)) : [],
    node_types: Array.isArray(filter.node_types) ? filter.node_types.filter((k) => NODE_TYPES.includes(k)) : [],
    focus_selection: Boolean(filter.focus_selection),
    hops: Number.isFinite(filter.hops) ? filter.hops : 1,
  };
}

function filterIsActive(filter) {
  return Boolean(
    filter.flow_kinds.length || filter.edge_types.length || filter.node_types.length || filter.focus_selection
  );
}

// BFS out from the current selection over edges (undirected) up to `hops`.
function focusNeighborhood(graphRef, selectedRef, hops) {
  const seeds = [];
  if (selectedRef?.kind === "node") {
    seeds.push(selectedRef.id);
  } else if (selectedRef?.kind === "edge") {
    const edge = graphRef.edges.find((item) => item.id === selectedRef.id);
    if (edge) seeds.push(edge.from_node, edge.to_node);
  }
  const set = new Set(seeds);
  let frontier = new Set(seeds);
  for (let hop = 0; hop < hops && frontier.size; hop += 1) {
    const next = new Set();
    graphRef.edges.forEach((edge) => {
      if (frontier.has(edge.from_node) && !set.has(edge.to_node)) next.add(edge.to_node);
      if (frontier.has(edge.to_node) && !set.has(edge.from_node)) next.add(edge.from_node);
    });
    next.forEach((id) => set.add(id));
    frontier = next;
  }
  return set;
}

// Pure: returns the visible node/edge id sets for a filter. Unit-testable and a
// future move into graph-logic.js (see REFACTOR_PLAN.md Option A).
function resolveView(graphRef, filter, selectedRef) {
  const allNodeIds = new Set(graphRef.nodes.map((node) => node.id));
  const allEdgeIds = new Set(graphRef.edges.map((edge) => edge.id));
  if (!filterIsActive(filter)) {
    return { nodeIds: allNodeIds, edgeIds: allEdgeIds, active: false };
  }

  const edgeFiltersActive = filter.flow_kinds.length > 0 || filter.edge_types.length > 0;
  let focusSet = filter.focus_selection ? focusNeighborhood(graphRef, selectedRef, filter.hops || 1) : null;
  if (focusSet && focusSet.size === 0) focusSet = null; // nothing selected -> focus inactive
  const nodeById = new Map(graphRef.nodes.map((node) => [node.id, node]));
  const nodeTypeOk = (node) => !filter.node_types.length || (node && filter.node_types.includes(node.type));
  const focusOk = (id) => !focusSet || focusSet.has(id);

  const edgeIds = new Set();
  const endpointIds = new Set();
  graphRef.edges.forEach((edge) => {
    const flowOk = !filter.flow_kinds.length || (Array.isArray(edge.flows) && edge.flows.some((flow) => filter.flow_kinds.includes(flow.kind)));
    const typeOk = !filter.edge_types.length || filter.edge_types.includes(edge.type);
    const endpointsOk = !filter.node_types.length || (nodeTypeOk(nodeById.get(edge.from_node)) && nodeTypeOk(nodeById.get(edge.to_node)));
    if (flowOk && typeOk && endpointsOk && focusOk(edge.from_node) && focusOk(edge.to_node)) {
      edgeIds.add(edge.id);
      endpointIds.add(edge.from_node);
      endpointIds.add(edge.to_node);
    }
  });

  const nodeIds = new Set();
  graphRef.nodes.forEach((node) => {
    if (!nodeTypeOk(node) || !focusOk(node.id)) return;
    // When filtering by edges, only show nodes that participate in a visible edge.
    if (edgeFiltersActive && !endpointIds.has(node.id)) return;
    nodeIds.add(node.id);
  });
  endpointIds.forEach((id) => nodeIds.add(id));

  return { nodeIds, edgeIds, active: true };
}

function describeFilter(filter) {
  const parts = [];
  if (filter.flow_kinds.length) parts.push(`${filter.flow_kinds.join("/")} flows`);
  if (filter.edge_types.length) parts.push(`${filter.edge_types.join("/")} edges`);
  if (filter.node_types.length) parts.push(`${filter.node_types.join("/")} nodes`);
  if (filter.focus_selection) parts.push("focus on selection");
  return parts.join(" + ") || "filtered";
}

// Applies dimming to the freshly-rendered canvas and refreshes the status pill.
function renderView() {
  const view = resolveView(graph, activeFilter, selected);
  const svg = els.graphCanvas;
  if (svg) {
    svg.querySelectorAll(".node-group[data-node-id]").forEach((el) => {
      el.classList.toggle("is-dimmed", view.active && !view.nodeIds.has(el.dataset.nodeId));
    });
    svg.querySelectorAll(".edge-group[data-edge-id]").forEach((el) => {
      el.classList.toggle("is-dimmed", view.active && !view.edgeIds.has(el.dataset.edgeId));
    });
  }
  renderViewStatus(view);
  return view;
}

function renderViewStatus(view) {
  if (!els.viewStatus) return;
  if (!view.active) {
    els.viewStatus.hidden = true;
    els.viewStatus.innerHTML = "";
    return;
  }
  els.viewStatus.hidden = false;
  els.viewStatus.innerHTML =
    `Viewing ${escapeHtml(describeFilter(activeFilter))} · ${view.nodeIds.size} of ${graph.nodes.length} nodes · ` +
    `${view.edgeIds.size} of ${graph.edges.length} edges <button type="button" class="view-clear">Clear</button>`;
}

function viewChip(dim, value) {
  const active = activeFilter[dim].includes(value);
  return `<button type="button" class="view-chip${active ? " is-active" : ""}" data-view-dim="${dim}" data-view-value="${escapeAttribute(value)}">${escapeHtml(titleCase(value))}</button>`;
}

function renderViewControls() {
  if (!els.viewFlowKindChips) return;
  els.viewFlowKindChips.innerHTML = FLOW_KINDS.map((kind) => viewChip("flow_kinds", kind)).join("");
  els.viewEdgeTypeChips.innerHTML = EDGE_TYPES.map((type) => viewChip("edge_types", type)).join("");
  els.viewNodeTypeChips.innerHTML = NODE_TYPES.map((type) => viewChip("node_types", type)).join("");
  els.viewFocusSelection.checked = activeFilter.focus_selection;
}

function applyFilterChange() {
  renderViewControls();
  renderView();
  renderSavedViews();
  // View scoping affects validation results; refresh so the panel + scope note track the filter.
  if (validateCurrentView) renderValidation();
  saveState();
}

function toggleViewFilter(dim, value) {
  const list = activeFilter[dim];
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else list.push(value);
  // A direct chip edit no longer matches any saved view.
  activeViewId = null;
  applyFilterChange();
}

function toggleFocusSelection() {
  activeFilter.focus_selection = !activeFilter.focus_selection;
  activeViewId = null;
  applyFilterChange();
}

function clearViewFilter() {
  activeFilter = createEmptyFilter();
  activeViewId = null;
  applyFilterChange();
}

// --- Saved views (persistent, stored on graph.saved_views) -----------------
// A saved view is { id, name, filter } where filter reuses the exact shape
// createEmptyFilter() produces, so resolveView/normalizeFilter work unchanged.

function normalizeSavedViews(views) {
  if (!Array.isArray(views)) return [];
  return views
    .filter((view) => view && typeof view === "object")
    .map((view) => ({
      id: typeof view.id === "string" && view.id ? view.id : `view_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: typeof view.name === "string" && view.name.trim() ? view.name.trim() : "Untitled view",
      filter: normalizeFilter(view.filter),
    }));
}

function renderSavedViews() {
  if (!els.savedViewsList) return;
  const views = Array.isArray(graph.saved_views) ? graph.saved_views : [];
  if (!views.length) {
    els.savedViewsList.innerHTML = `<p class="saved-views-empty">No saved views yet. Apply a filter above, then save it.</p>`;
    return;
  }
  els.savedViewsList.innerHTML = views
    .map((view) => {
      const isActive = view.id === activeViewId;
      return (
        `<div class="saved-view-row${isActive ? " is-active" : ""}" data-view-id="${escapeAttribute(view.id)}">` +
        `<span class="saved-view-name" title="${escapeAttribute(view.name)}">${escapeHtml(view.name)}</span>` +
        `<span class="saved-view-actions">` +
        `<button type="button" class="button tiny" data-view-action="apply" data-view-id="${escapeAttribute(view.id)}">Apply</button>` +
        `<button type="button" class="button tiny ghost" data-view-action="delete" data-view-id="${escapeAttribute(view.id)}">Delete</button>` +
        `</span></div>`
      );
    })
    .join("");
}

function saveCurrentView(name) {
  if (!filterIsActive(activeFilter)) {
    toast("Apply a filter first, then save it as a view");
    return;
  }
  const cleanName = (name || "").trim() || `View ${graph.saved_views.length + 1}`;
  const id = `view_${slug(cleanName) || "view"}_${Date.now()}`;
  const view = { id, name: cleanName, filter: normalizeFilter(activeFilter) };
  const existing = graph.saved_views.find((item) => item.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    existing.filter = view.filter;
    activeViewId = existing.id;
  } else {
    graph.saved_views.push(view);
    activeViewId = id;
  }
  if (els.savedViewNameInput) els.savedViewNameInput.value = "";
  saveState();
  renderSavedViews();
  toast(existing ? `Updated view "${cleanName}"` : `Saved view "${cleanName}"`);
}

function applySavedView(id) {
  const view = graph.saved_views.find((item) => item.id === id);
  if (!view) return;
  activeFilter = normalizeFilter(view.filter);
  activeViewId = id;
  renderViewControls();
  renderView();
  renderSavedViews();
  if (validateCurrentView) renderValidation();
  saveState();
}

function deleteSavedView(id) {
  const view = graph.saved_views.find((item) => item.id === id);
  if (!view) return;
  if (!window.confirm(`Delete the saved view "${view.name}"? The graph itself is not changed.`)) return;
  graph.saved_views = graph.saved_views.filter((item) => item.id !== id);
  if (activeViewId === id) activeViewId = null;
  saveState();
  renderSavedViews();
  toast(`Deleted view "${view.name}"`);
}

function openViewsPopover() {
  renderViewControls();
  renderSavedViews();
  els.viewsPopover.hidden = false;
  els.viewsButton.setAttribute("aria-expanded", "true");
}

function closeViewsPopover() {
  els.viewsPopover.hidden = true;
  els.viewsButton.setAttribute("aria-expanded", "false");
}

function toggleViewsPopover() {
  if (els.viewsPopover.hidden) openViewsPopover();
  else closeViewsPopover();
}

function ensureGraphShape() {
  graph.nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  graph.edges = Array.isArray(graph.edges) ? graph.edges : [];
  graph.resources = Array.isArray(graph.resources) ? graph.resources : [];
  graph.constraints = Array.isArray(graph.constraints) ? graph.constraints : [];
  graph.assumptions = Array.isArray(graph.assumptions) ? graph.assumptions : [];
  graph.metadata = graph.metadata || { created_by: "Unknown", created_at: new Date().toISOString(), tags: [] };
  graph.modeling_style = MODELING_STYLES.includes(graph.modeling_style) ? graph.modeling_style : "none";
  graph.ontology = mergeOntology(DEFAULT_ONTOLOGY, graph.ontology || {});
  graph.saved_views = normalizeSavedViews(graph.saved_views);
  // DS-2: authored objectives/budgets/notes (variables are derived, NOT stored).
  graph.design_space = normalizeDesignSpace(graph.design_space);

  graph.nodes.forEach((node) => {
    node.inputs = Array.isArray(node.inputs) ? node.inputs : [];
    node.outputs = Array.isArray(node.outputs) ? node.outputs : [];
    node.resources_required = normalizeResourceRequirements(node.resources_required || []);
    // DS-1: preserve object-valued (quantitative parameter) attributes on load.
    node.attributes = normalizePropertyStore(node.attributes);
    // DS-5: variant tagging is optional; default adoption when a variant is set.
    if (typeof node.variant_of === "string" && node.variant_of.trim()) {
      node.variant_of = node.variant_of.trim();
      node.adoption = normalizeAdoption(node.adoption);
    } else {
      delete node.variant_of;
      if (node.adoption && typeof node.adoption === "object") {
        node.adoption = normalizeAdoption(node.adoption);
      } else {
        delete node.adoption;
      }
    }
    node.description = typeof node.description === "string" ? node.description : "";
    node.description_status = normalizeNodeDescriptionStatus(node.description_status, node.description);
    node.perspectives = normalizePerspectives(node.perspectives);
    // Migrate the deprecated single `notes` field into a "Notes" perspective (back-compat).
    if (typeof node.notes === "string" && node.notes.trim()) {
      const hasNotesPerspective = node.perspectives.some((perspective) => perspective.label === "Notes");
      if (!hasNotesPerspective) {
        node.perspectives.push({ label: "Notes", text: node.notes });
      }
      node.notes = "";
    } else {
      node.notes = "";
    }
    if (!node.description) {
      node.description = suggestNodeDescription(node, graph);
      node.description_status = "suggested";
    }
  });

  graph.resources.forEach((resource) => {
    resource.attributes = resource.attributes || {};
    resource.description = typeof resource.description === "string" ? resource.description : "";
    resource.description_status = normalizeDefinitionStatus(resource.description_status, resource.description);
  });

  graph.edges = graph.edges.map((edge) => createEdge(edge));

  graph.constraints = graph.constraints.map((constraint) => {
    const next = createConstraint(constraint);
    if (typeof next.expression !== "string") next.expression = "";
    // Back-compat: seed the free-text expression once from legacy structured fields
    // so previously-saved/sample constraints don't render blank under the text model.
    if (!next.expression.trim()) {
      const seeded = legacyConstraintText(constraint);
      if (seeded) next.expression = seeded;
    }
    // Owner association: each constraint belongs to a node/edge (fields.target).
    // If missing or stale, best-effort resolve the owner from the expression text.
    next.fields = next.fields || { target: "" };
    const owner = next.fields.target;
    const ownerValid = owner && (graph.nodes.some((n) => n.id === owner) || graph.edges.some((e) => e.id === owner));
    if (!ownerValid) {
      next.fields.target = resolveConstraintOwnerFromText(next.expression);
    }
    return next;
  });

  migrateResourcesToNodes();

  inferOntologyFromGraph({ silent: true });
}

// One-time, idempotent migration: legacy graphs stored resources in a side
// catalog (graph.resources) plus per-node/edge resources_required lists. The new
// model makes each resource a first-class "resource" node and represents
// "X requires resource Y" as an allocation edge Y -> X (resource feeds the task)
// carrying the quantity.
//
// Idempotency: resource nodes reuse the original resource id, so a resource is
// only created when no node with that id exists. Allocation edges use a
// deterministic id (e_alloc_<consumer>_<resource>) so re-runs never duplicate.
// After migrating, graph.resources is cleared and every resources_required list
// is reset to [] (tolerated in data, never re-generated).
function migrateResourcesToNodes() {
  const legacyResources = Array.isArray(graph.resources) ? graph.resources : [];
  const hasLegacyRequirements =
    graph.nodes.some((node) => Array.isArray(node.resources_required) && node.resources_required.length) ||
    graph.edges.some((edge) => Array.isArray(edge.resources_required) && edge.resources_required.length);
  if (!legacyResources.length && !hasLegacyRequirements) return;

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  // Map old resource id -> resource-node id, and slug(name) -> resource-node id.
  const idToNodeId = new Map();
  const nameToNodeId = new Map();

  legacyResources.forEach((resource) => {
    if (!resource || typeof resource !== "object") return;
    const targetId = resource.id || uniqueId(`r_${slug(resource.name || "resource")}`);
    let resourceNode = nodeById.get(targetId);
    if (!resourceNode) {
      resourceNode = createNode({
        id: targetId,
        name: resource.name || "Resource",
        type: "resource",
        attributes: { kind: resource.type || "human", ...(resource.attributes || {}) },
      });
      graph.nodes.push(resourceNode);
      nodeById.set(resourceNode.id, resourceNode);
      if (!layout[resourceNode.id]) layout[resourceNode.id] = nextLayoutPoint();
    }
    if (resource.id) idToNodeId.set(resource.id, resourceNode.id);
    if (resource.name) nameToNodeId.set(slug(resource.name), resourceNode.id);
    nameToNodeId.set(slug(resourceNode.name), resourceNode.id);
  });

  // Resolve a requirement to a resource-node id by resource_id first, then name.
  const resolveResourceNodeId = (requirement) => {
    if (!requirement) return "";
    if (requirement.resource_id && idToNodeId.has(requirement.resource_id)) {
      return idToNodeId.get(requirement.resource_id);
    }
    // Tolerate a stale id that already points at an existing resource node.
    if (requirement.resource_id && nodeById.get(requirement.resource_id)?.type === "resource") {
      return requirement.resource_id;
    }
    const named = requirement.name ? nameToNodeId.get(slug(requirement.name)) : "";
    return named || "";
  };

  graph.nodes.forEach((node) => {
    const requirements = Array.isArray(node.resources_required) ? node.resources_required : [];
    if (!requirements.length) return;
    if (node.type === "resource") {
      node.resources_required = [];
      return;
    }
    requirements.forEach((requirement) => {
      const resourceNodeId = resolveResourceNodeId(requirement);
      if (!resourceNodeId) return; // skip unresolvable requirements
      // Resources are inputs to the task: the allocation edge runs resource -> consumer.
      const edgeId = `e_alloc_${slug(resourceNodeId)}_${slug(node.id)}`;
      if (graph.edges.some((edge) => edge.id === edgeId)) return; // idempotent
      const quantity = requirement.quantity !== undefined ? String(requirement.quantity) : "";
      graph.edges.push(
        createEdge({
          id: edgeId,
          from_node: resourceNodeId,
          to_node: node.id,
          type: "allocation",
          condition: quantity ? `qty: ${quantity}` : "",
          properties: quantity ? { quantity } : {},
        })
      );
    });
    node.resources_required = [];
  });

  // Edges cannot originate from an edge, so legacy edge-level requirements drop.
  graph.edges.forEach((edge) => {
    if (Array.isArray(edge.resources_required) && edge.resources_required.length) {
      edge.resources_required = [];
    }
  });

  // Catalog data has been migrated into resource nodes.
  graph.resources = [];
}

function mergeOntology(base, custom) {
  const next = clone(base);
  Object.entries(custom || {}).forEach(([group, entries]) => {
    next[group] = next[group] || {};
    Object.entries(entries || {}).forEach(([id, entry]) => {
      next[group][id] = { ...(next[group][id] || {}), ...(entry || {}) };
    });
  });
  return next;
}

function inferOntologyFromGraph() {
  graph.ontology = mergeOntology(DEFAULT_ONTOLOGY, graph.ontology || {});
  addOntologyEntry(
    "modeling_styles",
    graph.modeling_style || "none",
    ontologyLabel("modeling_styles", graph.modeling_style || "none"),
    ontologyDescription("modeling_styles", graph.modeling_style || "none") || "Selected modeling style."
  );

  graph.nodes.forEach((node) => {
    addOntologyEntry("node_types", node.type, titleCase(node.type), `Inferred node type used by "${node.name}".`);
    if (node.description && node.description_status === "approved") {
      syncNodeDefinitionToOntology(node, { force: false });
    }
    (node.inputs || []).forEach((input) => {
      addOntologyEntry("properties", `input_${slug(input)}`, input, `Inferred input item used by "${node.name}".`);
    });
    (node.outputs || []).forEach((output) => {
      addOntologyEntry("properties", `output_${slug(output)}`, output, `Inferred output item produced by "${node.name}".`);
    });
    normalizeResourceRequirements(node.resources_required).forEach((requirement) => {
      if (!requirement.name) return;
      addOntologyEntry(
        "properties",
        `resource_requirement_${slug(requirement.name)}`,
        requirement.name,
        `Inferred resource requirement. Quantity is stored per node requirement.`
      );
    });
  });

  graph.edges.forEach((edge) => {
    addOntologyEntry("edge_types", edge.type, titleCase(edge.type), `Inferred edge type used by "${edge.id}".`);
    normalizeFlows(edge.flows).forEach((flow) => {
      addOntologyEntry("flow_types", flow.kind, ontologyLabel("flow_types", flow.kind), `Inferred flow kind carried by "${edge.id}".`);
      if (flow.name) {
        addOntologyEntry("properties", `flow_${slug(flow.name)}`, flow.name, `Inferred flow carried by an edge.`);
      }
      if (flow.unit) {
        addOntologyEntry("properties", `unit_${slug(flow.unit)}`, flow.unit, `Inferred unit used by a flow.`);
      }
    });
    if (edge.condition) {
      addOntologyEntry("properties", `condition_${slug(edge.condition)}`, edge.condition, `Inferred edge condition.`);
    }
  });

  graph.constraints.forEach((constraint) => {
    addOntologyEntry(
      "constraint_types",
      constraint.type,
      titleCase(constraint.type),
      `Inferred constraint type used by "${constraint.id}".`
    );
    Object.keys(constraint.fields || {}).forEach((field) => {
      addOntologyEntry("properties", `constraint_${field}`, titleCase(field), `Structured constraint field.`);
    });
  });

  graph.resources.forEach((resource) => {
    addOntologyEntry("resource_types", resource.type, titleCase(resource.type), `Inferred resource type used by "${resource.name}".`);
  });
}

function addOntologyEntry(group, id, label, description) {
  if (!id) return;
  graph.ontology[group] = graph.ontology[group] || {};
  if (!graph.ontology[group][id]) {
    graph.ontology[group][id] = { label, description };
  }
}

function render() {
  ensureGraphShape();
  normalizeLayout();
  renderPanelCollapse();
  renderModelingStyle();
  renderLlmAssistToggle();
  renderChatMessages();
  renderCanvas();
  renderNotationLegend();
  renderMinimap();
  updateCanvasControls();
  renderInspector();
  renderValidation();
  renderOntology();
  renderLog();
  renderUndoState();
  updateStatus();
  updateFileAccessUi();
  saveState();
}

function renderPlan() {
  els.applyPlanButton.disabled = !pendingPlan || pendingPlan.mutations.length === 0;
  els.discardPlanButton.disabled = !pendingPlan;
  els.planStatus.textContent = pendingPlan ? `${pendingPlan.mutations.length} mutations pending` : "No pending plan";
  els.planPreview.textContent = JSON.stringify(pendingPlan || {}, null, 2);
}

function renderLlmAssistToggle() {
  if (!els.llmAssistToggle) return;
  els.llmAssistToggle.checked = Boolean(llmAssistEnabled);
  if (!els.llmAssistStatus) return;
  if (!llmAssistEnabled) {
    els.llmAssistStatus.textContent = "Off: deterministic compiler";
    return;
  }
  if (backendAvailable === false) {
    els.llmAssistStatus.textContent = "On locally; backend unavailable";
    return;
  }
  if (backendSession?.llm_assist_available === false) {
    els.llmAssistStatus.textContent = "On locally; server flag off";
    return;
  }
  els.llmAssistStatus.textContent = backendSession?.llm_model
    ? `On: ${backendSession.llm_model}`
    : "On: ask backend LLM";
}

async function planFromInstruction() {
  const message = els.chatInput.value.trim();
  pendingPlan = (await requestBackendAssist(message)) || compileWithClarification(message);
  if (message) appendChatMessage("user", { detail: message });
  appendChatMessage("assistant", buildAssistantReply(pendingPlan));
  clarificationContext = pendingPlan.questions?.length ? { plan: clone(pendingPlan), user_message: message } : null;
  renderPlan();
  renderChatMessages();
  renderCanvas();
  updateStatus();
  saveState();
}

async function hydrateFromBackendOnLoad() {
  if (!(await isBackendAvailable())) return;
  const graphId = graph?.id || CURRENT_SAMPLE_GRAPH_ID;
  try {
    const response = await fetch(`${apiBase()}/graph/${encodeURIComponent(graphId)}/envelope`, {
      headers: backendHeaders(),
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`status ${response.status}`);
    const envelope = await response.json();
    if (!envelope?.graph) return;
    applyEnvelopeToState(envelope);
    pendingPlan = null;
    clarificationContext = null;
    renderPlan();
    render();
  } catch (error) {
    console.warn("Unable to hydrate graph from backend", error);
  }
}

async function requestBackendAssist(message) {
  if (clarificationContext?.plan?.questions?.length) return null;
  if (!(await isBackendAvailable())) return null;
  const base = apiBase();
  try {
    const response = await fetch(`${base}/graph/assist`, {
      method: "POST",
      headers: backendJsonHeaders(),
      body: JSON.stringify({
        graph_id: graph.id,
        user_message: message,
        graph: clone(graph),
        chat_messages: chatMessages.slice(-12),
        use_llm: llmAssistEnabled,
      }),
    });
    if (!response.ok) {
      notifyBackendFailure(`Backend assist failed (status ${response.status}). Using the local planner instead.`);
      return null;
    }
    return await response.json();
  } catch {
    backendAvailable = false;
    notifyBackendFailure("Could not reach the backend for assist. Using the local planner instead.");
    return null;
  }
}

async function syncBackendMutations(mutations) {
  if (!mutations.length || !(await isBackendAvailable())) return;
  const base = apiBase();
  try {
    const response = await fetch(`${base}/graph/mutate`, {
      method: "POST",
      headers: backendJsonHeaders(),
      body: JSON.stringify({ graph_id: graph.id, mutations }),
    });
    if (!response.ok) {
      notifyBackendSyncFailure(`Backend sync failed (status ${response.status}). Your changes are saved locally.`);
    }
  } catch {
    backendAvailable = false;
    notifyBackendSyncFailure("Could not reach the backend to sync. Your changes are saved locally.");
  }
}

// Surfaces an assist-time backend failure without blocking: a transient toast
// plus a chat warning, since assist results land in the chat. Local planning
// stays authoritative (the caller still falls back to the local compiler).
function notifyBackendFailure(text) {
  toast(text);
  appendChatMessage("assistant", {
    summary: "Backend unavailable",
    detail: "I planned this with the local compiler instead.",
    questions: [],
    warnings: [text],
  });
}

// Surfaces a sync-time backend failure without blocking. Mutations are already
// applied locally, so we record the failure in the mutation audit log (where
// graph changes are tracked) and show a transient toast.
function notifyBackendSyncFailure(text) {
  toast(text);
  mutationLog.push({
    action: "backend_sync_failed",
    target_id: null,
    payload: {},
    reason: text,
    confidence: "n/a",
    timestamp: new Date().toISOString(),
  });
  renderLog();
  saveState();
}

function explicitApiBase() {
  return (localStorage.getItem(API_BASE_STORAGE_KEY) || window.PROCESS_GRAPH_API_BASE || "").replace(/\/+$/, "");
}

function apiBase() {
  const explicit = explicitApiBase();
  if (explicit) return explicit;
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "";
}

function backendHeaders() {
  const headers = {};
  const tenantId = (localStorage.getItem(TENANT_STORAGE_KEY) || "").trim();
  if (tenantId) headers["X-Tenant-Id"] = tenantId;
  return headers;
}

function backendJsonHeaders() {
  return { "Content-Type": "application/json", ...backendHeaders() };
}

async function isBackendAvailable() {
  if (backendAvailable !== null) return backendAvailable;
  const base = apiBase();
  if (!base) {
    backendAvailable = false;
    return false;
  }
  try {
    const response = await fetch(`${base}/healthz`, { headers: backendHeaders(), cache: "no-store" });
    backendAvailable = response.ok;
    if (backendAvailable) {
      try {
        const sessionResponse = await fetch(`${base}/session`, { headers: backendHeaders(), cache: "no-store" });
        backendSession = sessionResponse.ok ? await sessionResponse.json() : null;
        renderLlmAssistToggle();
      } catch {
        backendSession = null;
      }
    }
  } catch {
    backendAvailable = false;
  }
  return backendAvailable;
}

function compileWithClarification(message) {
  if (clarificationContext?.plan?.questions?.length) {
    const clarified = compileClarificationAnswer(message, clarificationContext.plan);
    if (clarified) return clarified;
  }
  return compileInstruction(message);
}

function compileClarificationAnswer(message, priorPlan) {
  const pendingNodeMutation = priorPlan.mutations.find((mutation) => mutation.action === "add_node");
  const pendingNode = pendingNodeMutation?.payload;
  const targets = extractConnectionTargets(message);
  if (!pendingNode || targets.length < 2) return null;
  const fromNode = targets[0];
  const toNode = targets[1];
  const nextMutations = clone(priorPlan.mutations).filter((mutation) => mutation.action !== "add_question");
  const pendingNodeExists = graph.nodes.some((node) => node.id === pendingNode.id) || nextMutations.some((mutation) => mutation.action === "add_node" && mutation.payload.id === pendingNode.id);
  const pendingId = pendingNode.id;

  if (pendingNodeExists && fromNode.id !== pendingId && toNode.id !== pendingId) {
    nextMutations.push(createEdgeMutation(fromNode.id, pendingId, "Clarification connected step from upstream node"));
    nextMutations.push(createEdgeMutation(pendingId, toNode.id, "Clarification connected step to downstream node"));
  } else {
    nextMutations.push(createEdgeMutation(fromNode.id, toNode.id, "Clarification connected existing nodes"));
  }

  return buildCompilerResponse("Updated pending plan from clarification", dedupeMutations(nextMutations), [], []);
}

function extractConnectionTargets(message) {
  const lower = message.toLowerCase();
  const mentioned = graph.nodes
    .filter((node) => lower.includes(node.name.toLowerCase()) || lower.includes(node.id.toLowerCase()))
    .sort((a, b) => lower.indexOf(a.name.toLowerCase()) - lower.indexOf(b.name.toLowerCase()));
  if (mentioned.length >= 2) return mentioned.slice(0, 2);

  const fromTo = message.match(/\bfrom\s+(.+?)\s+(?:to|into|then)\s+(.+)$/i);
  if (!fromTo) return mentioned;
  return [normalizeNodeReference(fromTo[1]), normalizeNodeReference(fromTo[2])].filter(Boolean);
}

function normalizeNodeReference(value) {
  const clean = cleanNodeName(value);
  return findNodeByName(clean) || graph.nodes.find((node) => slug(node.name).includes(slug(clean)) || slug(clean).includes(slug(node.name)));
}

function createEdgeMutation(fromNode, toNode, reason) {
  return {
    action: "add_edge",
    target_id: null,
    payload: createEdge({
      id: uniqueId(`e_${slug(fromNode)}_${slug(toNode)}`),
      from_node: fromNode,
      to_node: toNode,
      type: "flow",
      condition: "",
      flows: inferEdgeFlowsFromNodes({ from_node: fromNode, to_node: toNode }),
    }),
    reason,
    confidence: "medium",
  };
}

function dedupeMutations(mutations) {
  const seen = new Set();
  return mutations.filter((mutation) => {
    const key = `${mutation.action}:${mutation.target_id || ""}:${mutation.payload?.id || ""}:${mutation.payload?.from_node || ""}:${mutation.payload?.to_node || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function discardPendingPlan() {
  if (!pendingPlan) return;
  pendingPlan = null;
  clarificationContext = null;
  appendChatMessage("assistant", { summary: "Discarded preview", detail: "The pending mutation plan was cleared without changing the graph.", questions: [], warnings: [] });
  renderPlan();
  renderChatMessages();
  renderCanvas();
  updateStatus();
  saveState();
}

function renderUndoState() {
  if (!els.undoButton) return;
  els.undoButton.disabled = undoStack.length === 0;
}

function buildAssistantReply(plan, options = {}) {
  const graphMutations = canvasPreviewMutationCount(plan);
  const questions = plan.questions || [];
  const warnings = plan.warnings || [];
  const applied = Boolean(options.applied);
  return {
    summary: applied
      ? `Applied ${plan.mutations.length} mutation${plan.mutations.length === 1 ? "" : "s"} to the graph.`
      : plan.summary || "I reviewed the instruction.",
    detail: applied
      ? "The canvas now shows the committed graph."
      : graphMutations
        ? `I found ${graphMutations} graph change${graphMutations === 1 ? "" : "s"} to preview on the canvas.`
        : "I did not find enough graph structure to preview yet.",
    questions,
    warnings,
  };
}

function appendChatMessage(role, content) {
  chatMessages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
  chatMessages = chatMessages.slice(-24);
}

function renderChatMessages() {
  if (!els.chatScroll) return;
  const messages = chatMessages.length
    ? chatMessages
    : [
        {
          role: "assistant",
          content: {
            summary: "Ready for instructions",
            detail: "Describe a process in plain language. I will preview graph changes and ask questions when the structure is unclear.",
            questions: [],
            warnings: [],
          },
        },
      ];

  els.chatScroll.innerHTML = messages.map(renderChatMessage).join("");
  els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
}

function renderChatMessage(message) {
  const reply = message.content || {};
  const questions = reply.questions || [];
  const warnings = reply.warnings || [];
  if (message.role === "user") {
    return `
      <div class="chat-message user">
        <strong>You</strong>
        <p>${escapeHtml(reply.detail || "")}</p>
      </div>
    `;
  }
  return `
    <div class="chat-message assistant">
      <strong>${escapeHtml(reply.summary || "Assistant")}</strong>
      <p>${escapeHtml(reply.detail || "")}</p>
      ${
        questions.length
          ? `<strong>Clarifying questions</strong><ul>${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul>`
          : ""
      }
      ${
        warnings.length
          ? `<strong>Warnings</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(String(warning))}</li>`).join("")}</ul>`
          : ""
      }
    </div>
  `;
}

function renderPanelCollapse() {
  els.workspace.classList.toggle("left-collapsed", leftPanelCollapsed);
  els.leftPanel.classList.toggle("is-collapsed", leftPanelCollapsed);
  els.toggleLeftPanelButton.setAttribute("aria-expanded", String(!leftPanelCollapsed));
  els.toggleLeftPanelButton.title = leftPanelCollapsed ? "Expand left panel" : "Collapse left panel";
  els.toggleLeftPanelButton.setAttribute("aria-label", leftPanelCollapsed ? "Expand left menu" : "Collapse left menu");
  els.toggleLeftPanelButton.innerHTML = leftPanelCollapsed
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>`;
}

function buildPendingCanvasPreview() {
  if (!pendingPlan || !pendingPlan.mutations.length) return null;

  const originalGraph = graph;
  const originalLayout = layout;
  const originalSelected = selected;
  const originalQuestions = openQuestions;
  const originalLog = mutationLog;
  const baseNodeIds = new Set(originalGraph.nodes.map((node) => node.id));
  const baseEdgeIds = new Set(originalGraph.edges.map((edge) => edge.id));
  const updatedNodeIds = new Set();
  const updatedEdgeIds = new Set();

  pendingPlan.mutations.forEach((mutation) => {
    if (mutation.action === "update_node" && mutation.target_id) updatedNodeIds.add(mutation.target_id);
    if (mutation.action === "update_edge" && mutation.target_id) updatedEdgeIds.add(mutation.target_id);
  });

  graph = clone(originalGraph);
  layout = clone(originalLayout);
  selected = clone(originalSelected);
  openQuestions = clone(originalQuestions);
  mutationLog = clone(originalLog);

  pendingPlan.mutations.forEach((mutation) => applyMutation(mutation, { rerender: false, log: false }));

  const preview = {
    graph: clone(graph),
    layout: clone(layout),
    nodeIds: new Set(
      graph.nodes
        .filter((node) => !baseNodeIds.has(node.id) || updatedNodeIds.has(node.id))
        .map((node) => node.id)
    ),
    edgeIds: new Set(
      graph.edges
        .filter((edge) => !baseEdgeIds.has(edge.id) || updatedEdgeIds.has(edge.id))
        .map((edge) => edge.id)
    ),
  };

  graph = originalGraph;
  layout = originalLayout;
  selected = originalSelected;
  openQuestions = originalQuestions;
  mutationLog = originalLog;

  return preview;
}

function canvasPreviewMutationCount(plan = pendingPlan) {
  return (plan?.mutations || []).filter((mutation) =>
    ["add_node", "update_node", "delete_node", "add_edge", "update_edge", "delete_edge"].includes(mutation.action)
  ).length;
}


function renderModelingStyle() {
  if (!els.modelingStyleOptions) return;
  const current = graph.modeling_style || "none";
  els.modelingStyleOptions.innerHTML = MODELING_STYLES.map(
    (style) => `
      <label class="style-option">
        <input type="radio" name="modelingStyle" value="${escapeAttribute(style)}" ${style === current ? "checked" : ""} />
        <span>${escapeHtml(ontologyLabel("modeling_styles", style))}</span>
      </label>
    `
  ).join("");
}

function renderNotationLegend() {
  if (!els.notationLegend) return;
  const profile = currentNotationProfile();
  const references = (profile.references || [])
    .map((key) => OFFICIAL_REFERENCES[key])
    .filter(Boolean)
    .map((reference) => `<a href="${escapeAttribute(reference.url)}" target="_blank" rel="noreferrer">${escapeHtml(reference.label)}</a>`)
    .join(", ");

  els.notationLegend.classList.toggle("is-collapsed", legendCollapsed);

  const headerBar = `
    <div class="legend-bar">
      <span class="legend-bar-label">${escapeHtml("Legend")}</span>
      <button class="icon-button" id="legendToggleButton" type="button"
        title="${legendCollapsed ? "Expand legend" : "Collapse legend"}"
        aria-label="${legendCollapsed ? "Expand legend" : "Collapse legend"}"
        aria-expanded="${legendCollapsed ? "false" : "true"}">
        <svg class="legend-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
    </div>
  `;

  const body = legendCollapsed ? "" : `
    <div class="legend-body">
      <div class="legend-heading">
        <strong>${escapeHtml(profile.shortLabel || profile.label)}</strong>
        <span>${escapeHtml(profile.label)}</span>
      </div>
      <p>${escapeHtml(profile.summary)}</p>
      <div class="legend-grid">
        ${profile.nodeLegend.slice(0, 4).map(([label, detail]) => renderLegendRow("node", label, detail)).join("")}
        ${profile.edgeLegend.slice(0, 3).map(([label, detail]) => renderLegendRow("edge", label, detail)).join("")}
      </div>
      ${references ? `<div class="legend-refs">Grounded in ${references}</div>` : `<div class="legend-refs">Canonical graph notation</div>`}
    </div>
  `;

  els.notationLegend.innerHTML = headerBar + body;
  // The toggle button is re-created on each render; re-cache the current element.
  // The click is handled via delegation on #notationLegend in bindEvents().
  els.legendToggleButton = document.getElementById("legendToggleButton");
}

function toggleLegendCollapsed() {
  legendCollapsed = !legendCollapsed;
  renderNotationLegend();
  saveState();
}

function renderMinimap() {
  if (!els.canvasMinimap || !els.graphCanvas) return;
  const bounds = paddedWorldBounds(graphWorldBounds());
  const width = 180;
  const height = 120;
  const scale = Math.min(width / bounds.w, height / bounds.h);
  const offsetX = (width - bounds.w * scale) / 2;
  const offsetY = (height - bounds.h * scale) / 2;
  const viewport = visibleGraphRect();
  const nodeRects = graph.nodes
    .map((node) => {
      const pos = layout[node.id] || { x: 0, y: 0 };
      const size = nodeSize(node);
      return `<rect class="minimap-node ${escapeAttribute(node.type)}" x="${offsetX + (pos.x - bounds.minX) * scale}" y="${offsetY + (pos.y - bounds.minY) * scale}" width="${Math.max(4, size.w * scale)}" height="${Math.max(3, size.h * scale)}" rx="2" />`;
    })
    .join("");
  const vx = offsetX + (viewport.minX - bounds.minX) * scale;
  const vy = offsetY + (viewport.minY - bounds.minY) * scale;
  const vw = viewport.w * scale;
  const vh = viewport.h * scale;

  els.canvasMinimap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Graph minimap" data-minimap-min-x="${bounds.minX}" data-minimap-min-y="${bounds.minY}" data-minimap-scale="${scale}" data-minimap-offset-x="${offsetX}" data-minimap-offset-y="${offsetY}">
      <rect class="minimap-bg" width="${width}" height="${height}" rx="8" />
      <g>${nodeRects}</g>
      <rect class="minimap-viewport" x="${vx}" y="${vy}" width="${Math.max(12, vw)}" height="${Math.max(10, vh)}" rx="3" />
    </svg>
  `;
}

function updateCanvasControls() {
  if (!els.zoomLevelLabel) return;
  els.zoomLevelLabel.textContent = `${Math.round(canvasView.zoom * 100)}%`;
}

function renderLegendRow(kind, label, detail) {
  const icon = kind === "edge" ? `<span class="legend-edge-swatch"></span>` : `<span class="legend-node-swatch"></span>`;
  return `
    <div class="legend-row">
      ${icon}
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function currentNotationProfile() {
  return NOTATION_PROFILES[graph.modeling_style || "none"] || NOTATION_PROFILES.none;
}

function renderCanvas() {
  const svg = els.graphCanvas;
  const preview = buildPendingCanvasPreview();
  const width = Math.max(900, svg.clientWidth || 900);
  const height = Math.max(560, svg.clientHeight || 560);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  svg.dataset.notationProfile = graph.modeling_style || "none";
  canvasView = normalizeCanvasView(canvasView);

  const edgeMarkup = graph.edges
    .map((edge) => renderEdge(edge))
    .filter(Boolean)
    .join("");
  const nodeMarkup = graph.nodes.map((node) => renderNode(node)).join("");
  const previewMarkup = preview ? renderPreviewMarkup(preview) : "";
  const previewCount = preview ? preview.nodeIds.size + preview.edgeIds.size : 0;
  const draftConnectionMarkup = renderDraftConnection();

  svg.innerHTML = `
    <defs>
      <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
        <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#e6edf4" stroke-width="1" />
      </pattern>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#718096" />
      </marker>
      <marker id="arrowBlue" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#2166d2" />
      </marker>
      <marker id="arrowGreen" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#168a55" />
      </marker>
      <marker id="arrowOrange" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#d98021" />
      </marker>
      <marker id="arrowPurple" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#6f56b3" />
      </marker>
      <marker id="arrowBlack" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#15181d" />
      </marker>
      <marker id="arrowSelected" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#101820" />
      </marker>
      <marker id="teamService" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L10,6 L0,12 z" fill="#168a55" opacity="0.92" />
      </marker>
      <marker id="arrowPreview" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#7b8490" />
      </marker>
    </defs>
    <rect width="${width}" height="${height}" fill="#fbfcfe" />
    <rect width="${width}" height="${height}" fill="url(#grid)" />
    <g class="canvas-viewport" transform="translate(${canvasView.x} ${canvasView.y}) scale(${canvasView.zoom})">
      <g class="edges">${edgeMarkup}</g>
      ${draftConnectionMarkup}
      <g class="nodes">${nodeMarkup}</g>
      ${previewMarkup}
    </g>
    ${
      previewCount
        ? `<g class="preview-note" transform="translate(18 18)">
            <rect width="178" height="28" rx="6" />
            <text x="12" y="18">${previewCount} proposed change${previewCount === 1 ? "" : "s"}</text>
          </g>`
        : ""
    }
  `;
  renderMinimap();
  updateCanvasControls();
  renderView();
}

function renderPreviewMarkup(preview) {
  const originalGraph = graph;
  const originalLayout = layout;
  const originalSelected = selected;
  graph = preview.graph;
  layout = preview.layout;
  selected = { kind: null, id: null };
  const edgeMarkup = preview.graph.edges
    .filter((edge) => preview.edgeIds.has(edge.id))
    .map((edge) => renderEdge(edge, { preview: true }))
    .filter(Boolean)
    .join("");
  const nodeMarkup = preview.graph.nodes
    .filter((node) => preview.nodeIds.has(node.id))
    .map((node) => renderNode(node, { preview: true }))
    .join("");
  graph = originalGraph;
  layout = originalLayout;
  selected = originalSelected;
  return `<g class="preview-layer" aria-label="Proposed mutation preview"><g class="preview-edges">${edgeMarkup}</g><g class="preview-nodes">${nodeMarkup}</g></g>`;
}

function renderNode(node, options = {}) {
  const pos = layout[node.id] || { x: 80, y: 80 };
  const size = nodeSize(node);
  const profile = currentNotationProfile();
  const selectedClass = !options.preview && selected.kind === "node" && selected.id === node.id ? " is-selected" : "";
  const previewClass = options.preview ? " is-preview" : "";
  const dataAttr = options.preview ? `data-preview-node-id="${escapeAttribute(node.id)}"` : `data-node-id="${escapeAttribute(node.id)}"`;
  const label = escapeHtml(truncate(node.name, node.type === "decision" ? 22 : 24));
  const typeLabel = escapeHtml(node.type);
  const fill = nodeColor(node.type);
  const shape = renderNodeShape(node, size, fill, profile);
  const ports = renderNodePorts(node, size, profile);

  return `
    <g class="node-group node-${node.type} notation-${escapeAttribute(graph.modeling_style || "none")}${selectedClass}${previewClass}" ${dataAttr} transform="translate(${pos.x} ${pos.y})">
      ${shape}
      ${ports}
      <text class="node-type-label" x="${size.w / 2}" y="${size.h / 2 - 9}">${typeLabel}</text>
      <text class="node-label" x="${size.w / 2}" y="${size.h / 2 + 10}">${label}</text>
    </g>
  `;
}

function renderNodeShape(node, size, fill, profile) {
  const style = graph.modeling_style || "none";
  const stroke = "rgba(16,24,32,0.2)";

  // Resource definitions render as a cylinder ("database") in every notation
  // profile so they read clearly as a resource the graph allocates against.
  if (node.type === "resource") {
    const w = size.w;
    const h = size.h;
    const ry = Math.min(12, h * 0.16);
    return (
      `<path class="node-shape" d="M 0 ${ry} C 0 ${ry * 0.2}, ${w} ${ry * 0.2}, ${w} ${ry} L ${w} ${h - ry} C ${w} ${h - ry * 0.2}, 0 ${h - ry * 0.2}, 0 ${h - ry} Z" fill="${fill}" stroke="rgba(16,24,32,0.22)" />` +
      `<path class="node-shape-detail" d="M 0 ${ry} C 0 ${ry * 1.8}, ${w} ${ry * 1.8}, ${w} ${ry}" />`
    );
  }

  if (style === "business_process") {
    if (node.type === "source" || node.type === "sink") {
      const width = node.type === "sink" ? 4 : 2;
      return `<ellipse class="node-shape" cx="${size.w / 2}" cy="${size.h / 2}" rx="${size.w / 2 - 9}" ry="${size.h / 2 - 8}" fill="${fill}" stroke="rgba(16,24,32,0.28)" stroke-width="${width}" />`;
    }
    if (node.type === "decision") {
      return `<polygon class="node-shape" points="${size.w / 2},0 ${size.w},${size.h / 2} ${size.w / 2},${size.h} 0,${size.h / 2}" fill="${fill}" stroke="${stroke}" /><path class="node-shape-detail" d="M ${size.w / 2 - 12} ${size.h / 2} h24 M ${size.w / 2} ${size.h / 2 - 12} v24" />`;
    }
    return `<rect class="node-shape" width="${size.w}" height="${size.h}" rx="14" fill="${fill}" stroke="${stroke}" />`;
  }

  if (style === "value_stream") {
    if (node.type === "source" || node.type === "sink") {
      const roof = Math.min(30, size.w * 0.2);
      return `<path class="node-shape" d="M 0 ${size.h * 0.36} L ${roof} ${size.h * 0.18} L ${roof} ${size.h * 0.34} L ${size.w * 0.45} ${size.h * 0.18} L ${size.w * 0.45} ${size.h * 0.34} L ${size.w} ${size.h * 0.34} L ${size.w} ${size.h} L 0 ${size.h} Z" fill="${fill}" stroke="${stroke}" />`;
    }
    if (node.type === "task") {
      return `<rect class="node-shape" width="${size.w}" height="${size.h}" rx="2" fill="${fill}" stroke="${stroke}" /><path class="node-shape-detail" d="M 0 ${size.h - 18} H ${size.w}" />`;
    }
  }

  if (style === "system_flow") {
    const doubleStroke = node.type === "source" || node.type === "sink" ? `<rect class="node-shape-detail-box" x="6" y="6" width="${size.w - 12}" height="${size.h - 12}" rx="2" />` : "";
    if (node.type === "decision") {
      return `<polygon class="node-shape" points="${size.w / 2},0 ${size.w},${size.h / 2} ${size.w / 2},${size.h} 0,${size.h / 2}" fill="${fill}" stroke="${stroke}" />`;
    }
    return `<rect class="node-shape" width="${size.w}" height="${size.h}" rx="2" fill="${fill}" stroke="${stroke}" /><path class="node-shape-detail" d="M 0 24 H ${size.w}" />${doubleStroke}`;
  }

  if (style === "team_topology") {
    const teamKind = inferTeamShape(node);
    if (teamKind === "platform") {
      return `<rect class="node-shape" width="${size.w}" height="${size.h}" rx="10" fill="${fill}" stroke="${stroke}" /><rect class="node-shape-accent" x="0" y="${size.h - 16}" width="${size.w}" height="16" rx="0" />`;
    }
    if (teamKind === "enabling") {
      return `<rect class="node-shape" width="${size.w}" height="${size.h}" rx="18" fill="${fill}" stroke="${stroke}" stroke-dasharray="7 4" />`;
    }
    if (teamKind === "complicated") {
      const inset = 18;
      return `<polygon class="node-shape" points="${inset},0 ${size.w - inset},0 ${size.w},${size.h / 2} ${size.w - inset},${size.h} ${inset},${size.h} 0,${size.h / 2}" fill="${fill}" stroke="${stroke}" />`;
    }
  }

  if (node.type === "decision") {
    return `<polygon class="node-shape" points="${size.w / 2},0 ${size.w},${size.h / 2} ${size.w / 2},${size.h} 0,${size.h / 2}" fill="${fill}" stroke="rgba(16,24,32,0.18)" />`;
  }
  return `<rect class="node-shape" width="${size.w}" height="${size.h}" rx="8" fill="${fill}" stroke="rgba(16,24,32,0.16)" />`;
}

function renderNodePorts(node, size, profile = currentNotationProfile()) {
  const portRadius = 5;
  const inputCount = nodePortCount(node, "in");
  const outputCount = nodePortCount(node, "out");
  const inputs = Array.from({ length: inputCount }, (_, index) => {
    const point = localPortPoint(node, size, "in", index, inputCount);
    return renderPort(point, "in", node.id, profile.portShape, portRadius);
  }).join("");
  const outputs = Array.from({ length: outputCount }, (_, index) => {
    const point = localPortPoint(node, size, "out", index, outputCount);
    return renderPort(point, "out", node.id, profile.portShape, portRadius);
  }).join("");
  return `${inputs}${outputs}`;
}

function renderPort(point, direction, nodeId, shape, radius) {
  const attrs = `class="node-port ${direction} ${escapeAttribute(shape)}" data-port-direction="${direction}" data-port-node="${escapeAttribute(nodeId)}"`;
  if (shape === "square") {
    return `<rect ${attrs} x="${point.x - radius}" y="${point.y - radius}" width="${radius * 2}" height="${radius * 2}" rx="1.5" />`;
  }
  if (shape === "diamond") {
    return `<polygon ${attrs} points="${point.x},${point.y - radius} ${point.x + radius},${point.y} ${point.x},${point.y + radius} ${point.x - radius},${point.y}" />`;
  }
  if (shape === "triangle") {
    const sign = direction === "out" ? 1 : -1;
    return `<polygon ${attrs} points="${point.x + sign * radius},${point.y} ${point.x - sign * radius},${point.y - radius} ${point.x - sign * radius},${point.y + radius}" />`;
  }
  return `<circle ${attrs} cx="${point.x}" cy="${point.y}" r="${radius}" />`;
}

function renderDraftConnection() {
  if (!connectState) return "";
  const source = graph.nodes.find((node) => node.id === connectState.fromNode);
  if (!source || !connectState.pointer) return "";
  const from = connectionDraftStartPoint(source);
  const to = connectState.pointer;
  const dx = Math.max(80, Math.abs(to.x - from.x) * 0.45);
  const c1x = from.x + (to.x >= from.x ? dx : -dx);
  const c2x = to.x - (to.x >= from.x ? dx : -dx);
  const validClass = connectState.validTarget ? " valid" : connectState.pointer ? " invalid" : "";
  const profileClass = ` notation-${escapeAttribute(graph.modeling_style || "none")}`;
  return `<path class="draft-edge${profileClass}${validClass}" d="M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}" marker-end="url(#arrowPreview)" />`;
}

function renderEdge(edge, options = {}) {
  const from = graph.nodes.find((node) => node.id === edge.from_node);
  const to = graph.nodes.find((node) => node.id === edge.to_node);
  if (!from || !to) return "";

  const fromPoint = connectionPoint(edge, from, to, "out");
  const toPoint = connectionPoint(edge, to, from, "in");
  const dx = Math.max(90, Math.abs(toPoint.x - fromPoint.x) * 0.48);
  const c1x = fromPoint.x + (toPoint.x >= fromPoint.x ? dx : -dx);
  const c2x = toPoint.x - (toPoint.x >= fromPoint.x ? dx : -dx);
  const path = `M ${fromPoint.x} ${fromPoint.y} C ${c1x} ${fromPoint.y}, ${c2x} ${toPoint.y}, ${toPoint.x} ${toPoint.y}`;
  const midX = (fromPoint.x + toPoint.x) / 2;
  const midY = (fromPoint.y + toPoint.y) / 2 - 16;
  const selectedClass = !options.preview && selected.kind === "edge" && selected.id === edge.id ? " is-selected" : "";
  const previewClass = options.preview ? " is-preview" : "";
  const visual = edgeVisual(edge);
  const marker = options.preview ? "url(#arrowPreview)" : selected.kind === "edge" && selected.id === edge.id ? "url(#arrowSelected)" : `url(#${visual.marker})`;
  const dataAttr = options.preview ? `data-preview-edge-id="${escapeAttribute(edge.id)}"` : `data-edge-id="${escapeAttribute(edge.id)}"`;
  const flowLabel = edgeFlowLabel(edge);
  const label = edge.condition || flowLabel || ontologyLabel("edge_types", edge.type);
  const showLabel = Boolean(edge.condition || flowLabel || edge.type !== "flow" || selected.id === edge.id);
  const labelText = escapeHtml(truncate(label, 24));
  const labelWidth = Math.max(58, Math.min(188, label.length * 7 + 20));

  return `
    <g class="edge-group notation-${escapeAttribute(graph.modeling_style || "none")}${selectedClass}${previewClass}" ${dataAttr}>
      ${options.preview ? "" : `<path class="edge-hit" d="${path}" data-edge-id="${escapeAttribute(edge.id)}" />`}
      <path class="edge-path ${edge.type} ${visual.flowClass}" d="${path}" marker-end="${marker}" style="${visual.style}" />
      ${
        showLabel
          ? `<rect class="edge-label-bg" x="${midX - labelWidth / 2}" y="${midY - 13}" width="${labelWidth}" height="24" rx="6" />
      <text class="edge-label" x="${midX}" y="${midY + 3}">${labelText}</text>`
          : ""
      }
    </g>
  `;
}

// P0-4: when a filter is active and the selected object is hidden by the view,
// return a small notice with a "Show full graph" button; otherwise an empty string.
function outsideViewNotice(kind, id) {
  if (!filterIsActive(activeFilter)) return "";
  const view = resolveView(graph, activeFilter, selected);
  if (!view.active) return "";
  const visible = kind === "edge" ? view.edgeIds.has(id) : view.nodeIds.has(id);
  if (visible) return "";
  const label = kind === "edge" ? "edge" : "node";
  return `
    <div class="outside-view-notice">
      <span>This ${escapeHtml(label)} is outside the current view.</span>
      <button class="button tiny" type="button" data-show-full-graph>Show full graph</button>
    </div>
  `;
}

function renderInspector() {
  if (!selected.kind || !selected.id) {
    els.inspectorContent.innerHTML = renderEmptyInspector();
    return;
  }

  if (selected.kind === "edge") {
    const edge = graph.edges.find((item) => item.id === selected.id);
    if (!edge) {
      selected = { kind: null, id: null };
      renderInspector();
      return;
    }
    const flowRows = renderEdgeFlowEditor(edge);
    const edgePerspectiveRows = renderPerspectivesEditor(edge, "edge");
    const edgePropertyRows = renderPropertiesEditor(edge, "edge");
    const edgeDefinitionStatus = normalizeDefinitionStatus(edge.description_status, edge.description);
    els.inspectorContent.innerHTML = `
      ${outsideViewNotice("edge", edge.id)}
      <h3>Edge Properties</h3>
      <label class="field">
        <span>ID</span>
        <input type="text" value="${escapeAttribute(edge.id)}" disabled />
      </label>
      <div class="field-grid">
        <label class="field">
          <span>From</span>
          <select data-edge-field="from_node">${nodeOptions(edge.from_node)}</select>
        </label>
        <label class="field">
          <span>To</span>
          <select data-edge-field="to_node">${nodeOptions(edge.to_node)}</select>
        </label>
      </div>
      <label class="field">
        <span>Type</span>
        <select data-edge-field="type">${EDGE_TYPES.map((type) => option(type, edge.type, ontologyLabel("edge_types", type))).join("")}</select>
      </label>
      <div class="type-help">${escapeHtml(ontologyDescription("edge_types", edge.type))}</div>
      <label class="field">
        <span>Condition</span>
        <input type="text" data-edge-field="condition" value="${escapeAttribute(edge.condition || "")}" placeholder="Optional" />
      </label>
      <div class="field definition-field">
        <div class="section-title">
          <span>Definition</span>
          <span class="definition-status ${escapeAttribute(edgeDefinitionStatus)}">${escapeHtml(definitionStatusLabel(edgeDefinitionStatus))}</span>
        </div>
        <textarea rows="3" data-edge-field="description" placeholder="Explain what this edge represents">${escapeHtml(edge.description || "")}</textarea>
      </div>
      <div class="field">
        <div class="section-title">
          <span>Perspectives</span>
          <button class="icon-button" type="button" title="Add perspective" data-add-perspective="edge">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          </button>
        </div>
        <div class="list-editor">${edgePerspectiveRows}</div>
      </div>
      <div class="field">
        <div class="section-title">
          <span>Flows Carried</span>
          <button class="icon-button" type="button" title="Add edge flow" data-add-edge-flow>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          </button>
        </div>
        <div class="list-editor">${flowRows}</div>
      </div>
      <div class="field">
        <div class="section-title">
          <span>Properties</span>
          <button class="icon-button" type="button" title="Add property" data-add-prop="edge">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          </button>
        </div>
        <div class="list-editor">${edgePropertyRows}</div>
      </div>
      ${renderEdgeChangeEditor(edge)}
      <button class="button secondary full" type="button" data-delete-edge="${edge.id}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
        Delete Edge
      </button>
    `;
    return;
  }

  const node = graph.nodes.find((item) => item.id === selected.id) || graph.nodes[0];
  if (!node) {
    els.inspectorContent.innerHTML = renderEmptyInspector();
    return;
  }

  selected = { kind: "node", id: node.id };
  const inputRows = renderStringListEditor("inputs", node.inputs);
  const outputRows = renderStringListEditor("outputs", node.outputs);
  const perspectiveRows = renderPerspectivesEditor(node, "node");
  const propertyRows = renderPropertiesEditor(node, "node");
  const definitionStatus = normalizeNodeDescriptionStatus(node.description_status, node.description);
  const definitionApproved = definitionStatus === "approved";

  els.inspectorContent.innerHTML = `
    ${outsideViewNotice("node", node.id)}
    <h3>Node Properties</h3>
    <label class="field">
      <span>Name</span>
      <input type="text" data-node-field="name" value="${escapeAttribute(node.name)}" />
    </label>
    <label class="field">
      <span>Type</span>
      <select data-node-field="type">${NODE_TYPES.map((type) => option(type, node.type, ontologyLabel("node_types", type))).join("")}</select>
    </label>
    <div class="type-help">${escapeHtml(ontologyDescription("node_types", node.type))}</div>
    <div class="field definition-field">
      <div class="section-title">
        <span>Definition</span>
        <span class="definition-status ${escapeAttribute(definitionStatus)}">${escapeHtml(definitionStatusLabel(definitionStatus))}</span>
      </div>
      <textarea rows="4" data-node-field="description">${escapeHtml(node.description || "")}</textarea>
      <div class="type-help">Approve the definition when it correctly explains this node. Approved definitions become searchable ontology entries.</div>
      <div class="button-row definition-actions">
        <button class="button secondary" type="button" data-suggest-node-description>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="m5.6 5.6 2.8 2.8" /><path d="m15.6 15.6 2.8 2.8" /><path d="m18.4 5.6-2.8 2.8" /><path d="m8.4 15.6-2.8 2.8" /></svg>
          Suggest
        </button>
        <button class="button primary" type="button" data-approve-node-description ${definitionApproved ? "disabled" : ""}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5" /></svg>
          Approve Definition
        </button>
      </div>
    </div>
    <div class="field">
      <div class="section-title">
        <span>Perspectives</span>
        <button class="icon-button" type="button" title="Add perspective" data-add-perspective="node">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        </button>
      </div>
      <div class="list-editor">${perspectiveRows}</div>
    </div>
    <div class="field">
      <div class="section-title">
        <span>Inputs</span>
        <button class="icon-button" type="button" title="Add input" data-add-io="inputs">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        </button>
      </div>
      <div class="list-editor">${inputRows}</div>
    </div>
    <div class="field">
      <div class="section-title">
        <span>Outputs</span>
        <button class="icon-button" type="button" title="Add output" data-add-io="outputs">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        </button>
      </div>
      <div class="list-editor">${outputRows}</div>
    </div>
    <div class="field">
      <div class="section-title">
        <span>Properties</span>
        <button class="icon-button" type="button" title="Add property" data-add-prop="node">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        </button>
      </div>
      <div class="list-editor">${propertyRows}</div>
    </div>
    ${renderNodeVariantEditor(node)}
    <button class="button secondary full" type="button" data-delete-node="${node.id}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
      Delete Node
    </button>
  `;
}

function renderEmptyInspector() {
  return `
    <h3>Canvas</h3>
    <div class="type-help">Select a node or edge to edit its properties, or create a new graph object.</div>
    <div class="button-row">
      <button class="button primary" type="button" data-toggle-add-node-form>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        Add Node
      </button>
    </div>
    ${
      addNodeFormOpen
        ? `<div class="list-row add-node-form">
            <label class="field">
              <span>Name</span>
              <input type="text" id="newNodeNameInput" placeholder="New process step" />
            </label>
            <label class="field">
              <span>Type</span>
              <select id="newNodeTypeSelect">${NODE_TYPES.map((type) => option(type, "task", ontologyLabel("node_types", type))).join("")}</select>
            </label>
            <button class="button primary full" type="button" data-create-node>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
              Create Node
            </button>
          </div>`
        : ""
    }
  `;
}

function renderStringListEditor(field, values) {
  return values.length
    ? values
        .map(
          (value, index) => `
            <div class="list-row">
              <label class="field">
                <span>${field === "inputs" ? "Input" : "Output"} ${index + 1}</span>
                <input type="text" data-node-list-field="${field}" data-list-index="${index}" value="${escapeAttribute(value)}" />
              </label>
              <button class="icon-button danger" type="button" title="Remove ${field === "inputs" ? "input" : "output"}" data-remove-io="${field}" data-list-index="${index}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
              </button>
            </div>
          `
        )
        .join("")
    : `<div class="type-help">No ${field} defined yet.</div>`;
}

// Reusable properties (free-form key/value) editor. `target` is "node" (edits
// obj.attributes) or "edge" (edits obj.properties). Rows render the object as
// snake_case key + string value pairs; the handler rebuilds the whole object
// from all rows on every edit. Built so a later modal pass can re-host it unchanged.
function renderPropertiesEditor(obj, target) {
  const store = target === "edge" ? obj.properties : obj.attributes;
  const entries = Object.entries(store || {});
  const rows = entries
    .map(([key, value], index) => renderPropertyRow(target, index, key, value))
    .join("");
  return entries.length ? rows : `<div class="type-help">No properties yet. Add snake_case key/value rows as needed.</div>`;
}

// DS-1 KEYSTONE. Each property row keeps key + string value by default plus a
// "ƒ" toggle that promotes the value to a quantitative parameter object
// { value, unit, uncertainty?, variable? }. Promotion/demotion re-renders the
// inspector so the parameter sub-inputs appear/disappear; all other edits
// rebuild the store from the DOM (see collectPropertyStore).
function renderPropertyRow(target, index, key, value) {
  const promoted = isParameterValue(value);
  const param = promoted ? normalizeParameter(value) : null;
  const stringValue = promoted ? "" : String(value ?? "");
  const toggle = `
    <button class="icon-button param-toggle ${promoted ? "is-active" : ""}" type="button"
      title="${promoted ? "Revert to plain text value" : "Promote to a quantitative parameter"}"
      data-prop-target="${target}" data-prop-index="${index}" data-prop-toggle="parameter" aria-pressed="${promoted ? "true" : "false"}">ƒ</button>`;
  const valueInput = promoted
    ? `<input type="text" data-prop-target="${target}" data-prop-index="${index}" data-prop-part="value" value="${escapeAttribute(param.value)}" placeholder="number" />`
    : `<input type="text" data-prop-target="${target}" data-prop-index="${index}" data-prop-part="value" value="${escapeAttribute(stringValue)}" placeholder="value" />`;
  const head = `
    <div class="property-row">
      <label class="field">
        <span>Key</span>
        <input type="text" data-prop-target="${target}" data-prop-index="${index}" data-prop-part="key" value="${escapeAttribute(key)}" placeholder="snake_case_key" />
      </label>
      <label class="field">
        <span>${promoted ? "Value" : "Value"}</span>
        ${valueInput}
      </label>
      <div class="property-row-tools">
        ${toggle}
        <button class="icon-button danger" type="button" title="Remove property" data-remove-prop="${index}" data-prop-target="${target}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
        </button>
      </div>
    </div>`;
  if (!promoted) return head;
  return head + renderParameterEditor(target, index, param);
}

// Compact parameter sub-editor: unit + uncertainty mini-editor (kind select +
// relevant fields) + a "variable" toggle revealing the decision-domain inputs.
function renderParameterEditor(target, index, param) {
  const base = { target, index };
  const unc = param.uncertainty || null;
  const uncKind = unc ? unc.kind : "";
  const variable = param.variable || null;
  const dp = (part) => `data-prop-target="${target}" data-prop-index="${index}" data-prop-field="${part}"`;

  const uncFields = (() => {
    if (!unc) return "";
    if (uncKind === "range") {
      return `
        <label class="field"><span>Low</span><input type="text" ${dp("unc_low")} value="${escapeAttribute(unc.low ?? "")}" placeholder="low" /></label>
        <label class="field"><span>High</span><input type="text" ${dp("unc_high")} value="${escapeAttribute(unc.high ?? "")}" placeholder="high" /></label>`;
    }
    if (uncKind === "plus_minus") {
      return `
        <label class="field"><span>± amount</span><input type="text" ${dp("unc_plus_minus")} value="${escapeAttribute(unc.plus_minus ?? "")}" placeholder="±" /></label>
        <label class="checkbox-field param-percent"><input type="checkbox" ${dp("unc_percent")} ${unc.percent ? "checked" : ""} /><span>percent</span></label>`;
    }
    if (uncKind === "confidence") {
      return `
        <label class="field"><span>Confidence</span><input type="text" ${dp("unc_confidence")} value="${escapeAttribute(unc.confidence ?? "")}" placeholder="e.g. 95%" /></label>
        <label class="field"><span>Low</span><input type="text" ${dp("unc_low")} value="${escapeAttribute(unc.low ?? "")}" placeholder="low" /></label>
        <label class="field"><span>High</span><input type="text" ${dp("unc_high")} value="${escapeAttribute(unc.high ?? "")}" placeholder="high" /></label>`;
    }
    if (uncKind === "distribution") {
      return `
        <label class="field"><span>Distribution</span><input type="text" ${dp("unc_distribution")} value="${escapeAttribute(unc.distribution ?? "")}" placeholder="e.g. normal" /></label>
        <label class="field"><span>Mean</span><input type="text" ${dp("unc_mean")} value="${escapeAttribute(unc.mean ?? "")}" placeholder="mean" /></label>
        <label class="field"><span>Std</span><input type="text" ${dp("unc_std")} value="${escapeAttribute(unc.std ?? "")}" placeholder="std" /></label>`;
    }
    return "";
  })();

  const variableFields = (() => {
    if (!variable) return "";
    if (variable.kind === "range") {
      return `
        <label class="field"><span>Min</span><input type="text" ${dp("var_min")} value="${escapeAttribute(variable.min ?? "")}" placeholder="min" /></label>
        <label class="field"><span>Max</span><input type="text" ${dp("var_max")} value="${escapeAttribute(variable.max ?? "")}" placeholder="max" /></label>
        <label class="field"><span>Step</span><input type="text" ${dp("var_step")} value="${escapeAttribute(variable.step ?? "")}" placeholder="step" /></label>
        <label class="field"><span>Unit</span><input type="text" ${dp("var_unit")} value="${escapeAttribute(variable.unit ?? "")}" placeholder="unit" /></label>`;
    }
    if (variable.kind === "enum") {
      return `
        <label class="field param-enum"><span>Options (comma-separated)</span><input type="text" ${dp("var_options")} value="${escapeAttribute((variable.options || []).join(", "))}" placeholder="a, b, c" /></label>`;
    }
    return `<div class="type-help param-help">Boolean domain: the search chooses true or false.</div>`;
  })();

  return `
    <div class="param-editor">
      <div class="param-row">
        <label class="field"><span>Unit</span><input type="text" ${dp("unit")} value="${escapeAttribute(param.unit ?? "")}" placeholder="e.g. s, USD, kg" /></label>
        <label class="field"><span>Uncertainty</span>
          <select ${dp("unc_kind")}>
            <option value=""${uncKind === "" ? " selected" : ""}>— none —</option>
            ${UNCERTAINTY_KINDS.map((k) => `<option value="${k}"${uncKind === k ? " selected" : ""}>${titleCase(k)}</option>`).join("")}
          </select>
        </label>
      </div>
      ${uncFields ? `<div class="param-row param-unc-fields">${uncFields}</div>` : ""}
      <label class="checkbox-field param-variable-toggle">
        <input type="checkbox" ${dp("variable_on")} ${variable ? "checked" : ""} />
        <span>Decision variable (the external search chooses from this domain)</span>
      </label>
      ${
        variable
          ? `<div class="param-row param-variable-fields">
              <label class="field"><span>Domain</span>
                <select ${dp("var_kind")}>
                  ${VARIABLE_KINDS.map((k) => `<option value="${k}"${variable.kind === k ? " selected" : ""}>${titleCase(k)}</option>`).join("")}
                </select>
              </label>
              ${variableFields}
            </div>`
          : ""
      }
    </div>`;
}

// DS-1. Rebuild a property store from all rows in the inspector for `target`
// ("node" -> attributes, "edge" -> properties). Plain rows produce a string
// value; promoted rows (a "ƒ" toggle with aria-pressed=true) produce a
// quantitative parameter object assembled from the data-prop-field inputs.
function collectPropertyStore(target) {
  const byIndex = {};
  const ensure = (index) => {
    byIndex[index] = byIndex[index] || { key: "", value: "", promoted: false, fields: {} };
    return byIndex[index];
  };
  els.inspectorContent
    .querySelectorAll(`[data-prop-target="${target}"][data-prop-part]`)
    .forEach((input) => {
      const row = ensure(input.dataset.propIndex);
      row[input.dataset.propPart] = input.value;
    });
  els.inspectorContent
    .querySelectorAll(`[data-prop-target="${target}"][data-prop-toggle="parameter"]`)
    .forEach((button) => {
      ensure(button.dataset.propIndex).promoted = button.getAttribute("aria-pressed") === "true";
    });
  els.inspectorContent
    .querySelectorAll(`[data-prop-target="${target}"][data-prop-field]`)
    .forEach((input) => {
      const row = ensure(input.dataset.propIndex);
      const val = input.type === "checkbox" ? input.checked : input.value;
      row.fields[input.dataset.propField] = val;
    });

  const store = {};
  Object.values(byIndex).forEach((row) => {
    const key = (row.key || "").trim();
    if (!key) return;
    store[key] = row.promoted ? buildParameterFromFields(row.value, row.fields) : row.value;
  });
  return store;
}

// Assemble a quantitative parameter object from the flat field map produced by
// the parameter sub-editor. Empty/blank fields are dropped by normalizeParameter.
function buildParameterFromFields(value, fields) {
  const f = fields || {};
  const param = { value };
  if (f.unit !== undefined) param.unit = f.unit;
  const uncKind = f.unc_kind || "";
  if (uncKind) {
    const unc = { kind: uncKind };
    if (uncKind === "range") {
      unc.low = f.unc_low;
      unc.high = f.unc_high;
    } else if (uncKind === "plus_minus") {
      unc.plus_minus = f.unc_plus_minus;
      unc.percent = Boolean(f.unc_percent);
    } else if (uncKind === "confidence") {
      unc.confidence = f.unc_confidence;
      unc.low = f.unc_low;
      unc.high = f.unc_high;
    } else if (uncKind === "distribution") {
      unc.distribution = f.unc_distribution;
      unc.mean = f.unc_mean;
      unc.std = f.unc_std;
    }
    param.uncertainty = unc;
  }
  if (f.variable_on) {
    const varKind = f.var_kind || "range";
    const variable = { kind: varKind };
    if (varKind === "range") {
      variable.min = f.var_min;
      variable.max = f.var_max;
      variable.step = f.var_step;
      variable.unit = f.var_unit;
    } else if (varKind === "enum") {
      variable.options = String(f.var_options || "")
        .split(",")
        .map((opt) => opt.trim())
        .filter(Boolean);
    }
    param.variable = variable;
  }
  return normalizeParameter(param);
}

// Reusable perspectives editor. Renders obj.perspectives as labeled blocks
// ({ label, text }); the handler rebuilds the list from all rows. `target` is
// "node" or "edge"; commits via update_node / update_edge.
function renderPerspectivesEditor(obj, target) {
  const perspectives = Array.isArray(obj.perspectives) ? obj.perspectives : [];
  const rows = perspectives
    .map(
      (perspective, index) => `
        <div class="perspective-row">
          <label class="field">
            <span>Label</span>
            <input type="text" data-perspective-target="${target}" data-perspective-index="${index}" data-perspective-part="label" value="${escapeAttribute(perspective.label || "")}" placeholder="e.g. Finance view" />
          </label>
          <label class="field">
            <span>Text</span>
            <textarea rows="2" data-perspective-target="${target}" data-perspective-index="${index}" data-perspective-part="text" placeholder="How this object looks from this perspective">${escapeHtml(perspective.text || "")}</textarea>
          </label>
          <button class="icon-button danger" type="button" title="Remove perspective" data-remove-perspective="${index}" data-perspective-target="${target}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
          </button>
        </div>
      `
    )
    .join("");
  return perspectives.length ? rows : `<div class="type-help">No perspectives yet. Add labeled description blocks as needed.</div>`;
}

function renderEdgeFlowEditor(edge) {
  const flows = normalizeFlows(edge.flows);
  return flows.length
    ? flows
        .map(
          (flow, index) => `
            <div class="flow-row">
              <label class="field">
                <span>Name</span>
                <input type="text" data-edge-flow-field="name" data-edge-flow-index="${index}" value="${escapeAttribute(flow.name || "")}" />
              </label>
              <label class="field">
                <span>Kind</span>
                <select data-edge-flow-field="kind" data-edge-flow-index="${index}">${FLOW_KINDS.map((kind) => option(kind, flow.kind, ontologyLabel("flow_types", kind))).join("")}</select>
              </label>
              <label class="field">
                <span>Qty</span>
                <input type="text" data-edge-flow-field="quantity" data-edge-flow-index="${index}" value="${escapeAttribute(flow.quantity || "")}" />
              </label>
              <label class="field">
                <span>Unit</span>
                <input type="text" data-edge-flow-field="unit" data-edge-flow-index="${index}" value="${escapeAttribute(flow.unit || "")}" />
              </label>
              <button class="icon-button danger" type="button" title="Remove edge flow" data-remove-edge-flow="${index}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
              </button>
              <div class="flow-econ">
                <span class="flow-econ-label">Value</span>
                <input type="text" class="flow-econ-value" data-edge-flow-field="value_value" data-edge-flow-index="${index}" value="${escapeAttribute(flow.value?.value ?? "")}" placeholder="amount" aria-label="Flow value amount" />
                <input type="text" class="flow-econ-unit" data-edge-flow-field="value_unit" data-edge-flow-index="${index}" value="${escapeAttribute(flow.value?.unit ?? "")}" placeholder="unit" aria-label="Flow value unit" />
                <span class="flow-econ-label">Cost</span>
                <input type="text" class="flow-econ-value" data-edge-flow-field="cost_value" data-edge-flow-index="${index}" value="${escapeAttribute(flow.cost?.value ?? "")}" placeholder="amount" aria-label="Flow cost amount" />
                <input type="text" class="flow-econ-unit" data-edge-flow-field="cost_unit" data-edge-flow-index="${index}" value="${escapeAttribute(flow.cost?.unit ?? "")}" placeholder="unit" aria-label="Flow cost unit" />
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="type-help">No flows defined yet. Add cash, energy, parts, information, data, work, approval, or custom flows.</div>`;
}

// DS-7: edge change-moves. reroutable / eliminable + change cost/time.
// Stored as edge.change = { reroutable, eliminable, cost:{value,unit}, time:{value,unit} }.
function renderEdgeChangeEditor(edge) {
  const change = edge.change || {};
  const cost = change.cost || {};
  const time = change.time || {};
  return `
    <div class="field change-moves">
      <div class="section-title"><span>Change moves</span></div>
      <div class="type-help">How this edge can change in the design space, with the cost and time each move incurs.</div>
      <div class="change-toggles">
        <label class="checkbox-field"><input type="checkbox" data-edge-change-field="reroutable" ${change.reroutable ? "checked" : ""} /><span>Reroutable</span></label>
        <label class="checkbox-field"><input type="checkbox" data-edge-change-field="eliminable" ${change.eliminable ? "checked" : ""} /><span>Eliminable</span></label>
      </div>
      <div class="quantity-grid">
        <span class="quantity-label">Cost</span>
        <input type="text" data-edge-change-field="cost_value" value="${escapeAttribute(cost.value ?? "")}" placeholder="amount" aria-label="Change cost amount" />
        <input type="text" data-edge-change-field="cost_unit" value="${escapeAttribute(cost.unit ?? "")}" placeholder="unit (e.g. USD)" aria-label="Change cost unit" />
        <span class="quantity-label">Time</span>
        <input type="text" data-edge-change-field="time_value" value="${escapeAttribute(time.value ?? "")}" placeholder="amount" aria-label="Change time amount" />
        <input type="text" data-edge-change-field="time_unit" value="${escapeAttribute(time.unit ?? "")}" placeholder="unit (e.g. wk)" aria-label="Change time unit" />
      </div>
    </div>`;
}

// DS-5: node variants. "Variant of" base node + adoption cost/time. Setting a
// base stores { variant_of, adoption: { cost, time } } on the node. Also offers
// "Create variant of this node" which clones into a new node tagged variant_of.
function renderNodeVariantEditor(node) {
  const adoption = node.adoption || {};
  const cost = adoption.cost || {};
  const time = adoption.time || {};
  const isVariant = typeof node.variant_of === "string" && node.variant_of.trim();
  const baseOptions = graph.nodes
    .filter((other) => other.id !== node.id && other.type !== "resource")
    .map((other) => `<option value="${escapeAttribute(other.id)}"${node.variant_of === other.id ? " selected" : ""}>${escapeHtml(other.name || other.id)}</option>`)
    .join("");
  return `
    <div class="field node-variant">
      <div class="section-title"><span>Variant</span></div>
      <div class="type-help">Tag this node as a variant of a base node (an alternative the search may adopt), and record what adopting it costs.</div>
      <label class="field">
        <span>Variant of</span>
        <select data-node-variant-field="variant_of">
          <option value=""${isVariant ? "" : " selected"}>— none —</option>
          ${baseOptions}
        </select>
      </label>
      ${
        isVariant
          ? `<div class="quantity-grid">
              <span class="quantity-label">Adoption cost</span>
              <input type="text" data-node-variant-field="cost_value" value="${escapeAttribute(cost.value ?? "")}" placeholder="amount" aria-label="Adoption cost amount" />
              <input type="text" data-node-variant-field="cost_unit" value="${escapeAttribute(cost.unit ?? "")}" placeholder="unit (e.g. USD)" aria-label="Adoption cost unit" />
              <span class="quantity-label">Adoption time</span>
              <input type="text" data-node-variant-field="time_value" value="${escapeAttribute(time.value ?? "")}" placeholder="amount" aria-label="Adoption time amount" />
              <input type="text" data-node-variant-field="time_unit" value="${escapeAttribute(time.unit ?? "")}" placeholder="unit (e.g. wk)" aria-label="Adoption time unit" />
            </div>`
          : ""
      }
      <button class="button secondary full" type="button" data-create-variant="${escapeAttribute(node.id)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></svg>
        Create variant of this node
      </button>
    </div>`;
}

function renderValidation() {
  const report = validateGraph();
  const items = report.items;
  const errors = items.filter((item) => item.level === "error").length;
  const warnings = items.filter((item) => item.level === "warn").length;
  const complete = errors === 0 && warnings === 0;
  els.readinessBadge.textContent = complete ? "handoff readiness high" : `${errors} errors, ${warnings} warnings`;
  const healthColor = errors ? "var(--danger)" : warnings ? "var(--orange)" : "var(--green)";
  els.readinessBadge.style.color = healthColor;
  if (els.validationStatusDot) {
    els.validationStatusDot.style.background = healthColor;
    els.validationStatusDot.title = els.readinessBadge.textContent;
  }
  els.allowCyclesInput.checked = allowCycles;
  if (els.validateViewInput) els.validateViewInput.checked = validateCurrentView;

  const scope = report.scope;
  if (els.validationScopeNote) {
    if (scope && scope.scoped) {
      els.validationScopeNote.hidden = false;
      els.validationScopeNote.textContent = `Validating current view: ${scope.visibleNodeCount} of ${scope.totalNodeCount} nodes`;
    } else {
      els.validationScopeNote.hidden = true;
      els.validationScopeNote.textContent = "";
    }
  }

  els.validationList.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <div class="validation-item ${item.level}">
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml(item.detail)}</span>
            </div>
          `
        )
        .join("")
    : `
      <div class="validation-item ok">
        <strong>Structure complete</strong>
        <span>No validation issues found for the current graph settings.</span>
      </div>
    `;
}

// Constraints live inside the element editor modal (Constraints tab). Each
// constraint is OWNED by the selected node/edge via fields.target = element id.
function renderElementConstraints() {
  if (!els.elementConstraints) return;
  const ownerId = selected.id;
  const owned =
    (selected.kind === "node" || selected.kind === "edge") && ownerId
      ? graph.constraints.filter((constraint) => constraint.fields?.target === ownerId)
      : [];

  const helpTip = `<div class="type-help">Write each constraint in plain language as a relationship between inputs, properties, outputs, resources, or capacity. Example: "Blending tank capacity is 5,000 L; the combined volume of input flows must not exceed it."</div>`;

  const rows = owned
    .map(
      (constraint) => `
        <div class="constraint-item" data-constraint-id="${escapeAttribute(constraint.id)}">
          <label class="field">
            <span>Constraint</span>
            <textarea data-constraint-field="expression" placeholder="Describe the constraint in plain language…">${escapeHtml(constraint.expression || "")}</textarea>
          </label>
          <div class="constraint-meta">
            <button class="icon-button danger" type="button" title="Remove constraint" data-delete-constraint="${escapeAttribute(constraint.id)}">✕</button>
          </div>
        </div>
      `
    )
    .join("");

  const addButton = `<button class="button secondary full" type="button" data-add-constraint>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
      Add constraint
    </button>`;

  els.elementConstraints.innerHTML =
    helpTip +
    (rows || `<div class="type-help">No constraints on this element yet.</div>`) +
    addButton;
}

function renderOntology() {
  if (!els.ontologyContent) return;
  ensureGraphShape();
  const query = (els.ontologySearchInput?.value || "").trim().toLowerCase();
  const groups = [
    ["modeling_styles", "Modeling Styles"],
    ["node_types", "Node Types"],
    ["edge_types", "Edge Types"],
    ["flow_types", "Flow Types"],
    ["constraint_types", "Constraint Types"],
    ["resource_types", "Resource Types"],
    ["properties", "Properties"],
  ];

  els.ontologyContent.innerHTML =
    groups
      .map(([key, label]) => renderOntologyGroup(key, label, query))
      .filter(Boolean)
      .join("") || `<div class="type-help">No ontology entries match the current search.</div>`;
}

function renderOntologyGroup(key, label, query) {
  const entries = Object.entries(graph.ontology?.[key] || {}).filter(([id, entry]) => {
    const haystack = `${id} ${entry.label || ""} ${entry.description || ""}`.toLowerCase();
    return !query || haystack.includes(query);
  });
  if (!entries.length) return "";
  return `
    <div class="ontology-group">
      <div class="ontology-heading">
        <h3>${escapeHtml(label)}</h3>
        <span>${entries.length}</span>
      </div>
      ${entries
        .map(
          ([id, entry]) => `
            <div class="ontology-row" data-ontology-group="${key}" data-ontology-id="${escapeAttribute(id)}">
              <div>
                <strong>${escapeHtml(entry.label || titleCase(id))}</strong>
                <small>${escapeHtml(id)}</small>
              </div>
              <label class="field">
                <span>Label</span>
                <input type="text" data-ontology-field="label" value="${escapeAttribute(entry.label || titleCase(id))}" />
              </label>
              <label class="field">
                <span>Definition</span>
                <textarea rows="3" data-ontology-field="description">${escapeHtml(entry.description || "")}</textarea>
              </label>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function handleOntologyInput(event) {
  const row = event.target.closest("[data-ontology-group]");
  const field = event.target.dataset.ontologyField;
  if (!row || !field) return;
  const group = row.dataset.ontologyGroup;
  const id = row.dataset.ontologyId;
  graph.ontology[group][id] = {
    ...(graph.ontology[group][id] || {}),
    [field]: event.target.value,
  };
  saveState();
}

function handleModelingStyleChange(event) {
  if (event.target.name !== "modelingStyle") return;
  graph.modeling_style = MODELING_STYLES.includes(event.target.value) ? event.target.value : "none";
  inferOntologyFromGraph();
  renderModelingStyle();
  renderCanvas();
  renderNotationLegend();
  renderValidation();
  renderOntology();
  updateStatus();
  saveState();
  toast(`Modeling style: ${ontologyLabel("modeling_styles", graph.modeling_style)}`);
}

function renderLog() {
  els.mutationLog.innerHTML =
    mutationLog
      .slice()
      .reverse()
      .map(
        (entry) => `
          <div class="log-entry">
            <strong>${escapeHtml(entry.action)} ${entry.target_id ? escapeHtml(entry.target_id) : ""}</strong>
            <span>${escapeHtml(entry.reason || "No reason provided")} | confidence: ${escapeHtml(entry.confidence || "medium")}</span>
          </div>
        `
      )
      .join("") ||
    `<div class="log-entry"><strong>No mutations yet</strong><span>Graph changes appear here for audit.</span></div>`;
}

function updateStatus() {
  els.nodeCount.textContent = `${graph.nodes.length} nodes`;
  els.edgeCount.textContent = `${graph.edges.length} edges`;
  if (pendingPlan?.mutations?.length) {
    const previewCount = canvasPreviewMutationCount();
    els.selectedStatus.textContent = previewCount
      ? `Previewing ${previewCount} proposed graph change${previewCount === 1 ? "" : "s"}`
      : `${pendingPlan.mutations.length} non-graph mutation${pendingPlan.mutations.length === 1 ? "" : "s"} pending`;
    els.graphSubtitle.textContent = `${graph.name} | v${graph.version} | ${currentNotationProfile().shortLabel}`;
    return;
  }
  const selectedObject =
    selected.kind === "edge"
      ? graph.edges.find((edge) => edge.id === selected.id)
      : graph.nodes.find((node) => node.id === selected.id);
  els.selectedStatus.textContent = selectedObject
    ? `Selected ${selected.kind}: ${selectedObject.name || selectedObject.id}`
    : "Nothing selected";
  els.graphSubtitle.textContent = `${graph.name} | v${graph.version} | ${currentNotationProfile().shortLabel}`;
}

function targetNodeFromPointer(clientX, clientY, sourceId) {
  const element = document.elementFromPoint(clientX, clientY);
  const group = element?.closest?.(".node-group");
  const id = group?.dataset.nodeId;
  if (!id || id === sourceId) return null;
  return graph.nodes.find((node) => node.id === id) || null;
}

function connectionDraftStartPoint(node) {
  const pos = layout[node.id] || { x: 0, y: 0 };
  const size = nodeSize(node);
  const count = Math.max(nodePortCount(node, "out"), 1);
  const local = localPortPoint(node, size, "out", 0, count);
  return { x: pos.x + local.x, y: pos.y + local.y };
}

function handleCanvasPointerDown(event) {
  const port = event.target.closest(".node-port");
  const nodeGroup = event.target.closest(".node-group");
  const edgeTarget = event.target.closest("[data-edge-id]");

  if (port && port.dataset.portDirection === "out") {
    const fromNode = port.dataset.portNode;
    selected = { kind: "node", id: fromNode };
    connectState = {
      fromNode,
      pointer: canvasPoint(event),
      validTarget: null,
    };
    els.graphCanvas.setPointerCapture(event.pointerId);
    renderCanvas();
    updateStatus();
    return;
  }

  if (nodeGroup) {
    const nodeId = nodeGroup.dataset.nodeId;
    selected = { kind: "node", id: nodeId };
    const pointer = canvasPoint(event);
    const pos = layout[nodeId];
    dragState = {
      nodeId,
      offsetX: pointer.x - pos.x,
      offsetY: pointer.y - pos.y,
      moved: false,
    };
    els.graphCanvas.setPointerCapture(event.pointerId);
    render();
    return;
  }

  if (edgeTarget) {
    const edgeId = edgeTarget.dataset.edgeId;
    selected = { kind: "edge", id: edgeId };
    render();
    openElementEditor();
    return;
  }

  panState = {
    pointerId: event.pointerId,
    start: svgPoint(event),
    viewStart: { ...canvasView },
    moved: false,
  };
  els.graphCanvas.setPointerCapture(event.pointerId);
  els.graphCanvas.classList.add("is-panning");
}

function handleCanvasPointerMove(event) {
  if ((dragState || connectState || panState) && event.buttons === 0) {
    handleCanvasPointerUp(event);
    return;
  }

  if (connectState) {
    const pointer = canvasPoint(event);
    const target = targetNodeFromPointer(event.clientX, event.clientY, connectState.fromNode);
    connectState.pointer = pointer;
    connectState.validTarget = target?.id || null;
    renderCanvas();
    updateStatus();
    return;
  }

  if (panState) {
    const pointer = svgPoint(event);
    const dx = pointer.x - panState.start.x;
    const dy = pointer.y - panState.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) panState.moved = true;
    canvasView = normalizeCanvasView({
      ...canvasView,
      x: panState.viewStart.x + dx,
      y: panState.viewStart.y + dy,
    });
    renderCanvas();
    updateStatus();
    return;
  }

  if (panState) {
    if (els.graphCanvas.hasPointerCapture(event.pointerId)) {
      els.graphCanvas.releasePointerCapture(event.pointerId);
    }
    const moved = panState.moved;
    panState = null;
    els.graphCanvas.classList.remove("is-panning");
    if (!moved) {
      selected = { kind: null, id: null };
      render();
    } else {
      renderCanvas();
      updateStatus();
      saveState();
    }
    return;
  }

  if (!dragState) return;
  const pointer = canvasPoint(event);
  dragState.moved = true;
  layout[dragState.nodeId] = {
    x: Math.max(20, pointer.x - dragState.offsetX),
    y: Math.max(20, pointer.y - dragState.offsetY),
  };
  renderCanvas();
}

function handleCanvasPointerUp(event) {
  if (event?.type === "lostpointercapture" && (dragState || connectState || panState)) {
    dragState = null;
    connectState = null;
    panState = null;
    els.graphCanvas.classList.remove("is-panning");
    render();
    return;
  }

  if (connectState) {
    if (els.graphCanvas.hasPointerCapture(event.pointerId)) {
      els.graphCanvas.releasePointerCapture(event.pointerId);
    }
    const targetId = connectState.validTarget;
    const fromNode = connectState.fromNode;
    connectState = null;
    if (!targetId || targetId === fromNode) {
      render();
      toast("Drop on another node to create an edge");
      return;
    }
    if (graph.edges.some((edge) => edge.from_node === fromNode && edge.to_node === targetId)) {
      render();
      toast("Edge already exists");
      return;
    }
    const id = uniqueId(`e_${slug(fromNode)}_${slug(targetId)}`);
    pushUndoSnapshot("Before canvas edge creation");
    applyMutation({
      action: "add_edge",
      target_id: null,
      payload: {
        id,
        from_node: fromNode,
        to_node: targetId,
        type: "flow",
        condition: graph.nodes.find((node) => node.id === fromNode)?.type === "decision" ? "if condition" : "",
        flows: inferEdgeFlowsFromNodes({ id, from_node: fromNode, to_node: targetId }),
      },
      reason: "Canvas drag created edge",
      confidence: "high",
    });
    selected = { kind: "edge", id };
    toast("Edge created");
    return;
  }

  if (!dragState) return;
  if (els.graphCanvas.hasPointerCapture(event.pointerId)) {
    els.graphCanvas.releasePointerCapture(event.pointerId);
  }
  const wasClick = !dragState.moved;
  dragState = null;
  render();
  if (wasClick) openElementEditor();
}

function handleInspectorInput(event) {
  const nodeField = event.target.dataset.nodeField;
  const edgeField = event.target.dataset.edgeField;
  const edgeFlowField = event.target.dataset.edgeFlowField;
  const nodeListField = event.target.dataset.nodeListField;

  if (nodeField && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    const payload = { [nodeField]: event.target.value };
    if (nodeField === "description") {
      payload.description_status = event.target.value.trim() ? "custom" : "empty";
    }
    if ((nodeField === "name" || nodeField === "type") && ["empty", "suggested"].includes(node.description_status)) {
      const nextNode = { ...node, [nodeField]: event.target.value };
      payload.description = suggestNodeDescription(nextNode, graph);
      payload.description_status = "suggested";
    }
    applyMutation(
      {
        action: "update_node",
        target_id: selected.id,
        payload,
        reason: `Inspector updated node ${nodeField}`,
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    if (nodeField === "description") {
      const updatedNode = graph.nodes.find((item) => item.id === selected.id);
      if (updatedNode && payload.description_status !== "approved") removeNodeDefinitionFromOntology(updatedNode);
    }
    renderCanvas();
    renderValidation();
    renderOntology();
    updateStatus();
    if (nodeField === "description") {
      const status = payload.description_status;
      const statusEl = els.inspectorContent.querySelector(".definition-status");
      const approveButton = els.inspectorContent.querySelector("[data-approve-node-description]");
      if (statusEl) {
        statusEl.className = `definition-status ${status}`;
        statusEl.textContent = definitionStatusLabel(status);
      }
      if (approveButton) approveButton.disabled = status === "approved";
    }
    if (nodeField === "name" && payload.description) {
      const definitionInput = els.inspectorContent.querySelector("[data-node-field='description']");
      const statusEl = els.inspectorContent.querySelector(".definition-status");
      const approveButton = els.inspectorContent.querySelector("[data-approve-node-description]");
      if (definitionInput) definitionInput.value = payload.description;
      if (statusEl) {
        statusEl.className = "definition-status suggested";
        statusEl.textContent = definitionStatusLabel("suggested");
      }
      if (approveButton) approveButton.disabled = false;
    }
    if (nodeField === "type") renderInspector();
  }

  if (nodeListField && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    const values = [...(node[nodeListField] || [])];
    values[Number(event.target.dataset.listIndex)] = event.target.value;
    applyMutation(
      {
        action: "update_node",
        target_id: selected.id,
        payload: { [nodeListField]: values },
        reason: `Inspector updated node ${nodeListField}`,
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    inferOntologyFromGraph();
    renderCanvas();
    renderValidation();
    updateStatus();
  }

  if (edgeField && selected.kind === "edge") {
    const payload = { [edgeField]: event.target.value };
    if (edgeField === "description") {
      payload.description_status = event.target.value.trim() ? "custom" : "empty";
    }
    applyMutation(
      {
        action: "update_edge",
        target_id: selected.id,
        payload,
        reason: `Inspector updated edge ${edgeField}`,
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    renderCanvas();
    renderValidation();
    updateStatus();
    if (edgeField === "description") {
      const status = payload.description_status;
      const statusEl = els.inspectorContent.querySelector(".definition-status");
      if (statusEl) {
        statusEl.className = `definition-status ${status}`;
        statusEl.textContent = definitionStatusLabel(status);
      }
    }
  }

  if (edgeFlowField && selected.kind === "edge") {
    const edge = graph.edges.find((item) => item.id === selected.id);
    if (!edge) return;
    const flows = normalizeFlows(edge.flows);
    const index = Number(event.target.dataset.edgeFlowIndex);
    const current = flows[index] || createFlow({});
    // DS-6: flow economics composite fields (value/cost = { value, unit }).
    if (["value_value", "value_unit", "cost_value", "cost_unit"].includes(edgeFlowField)) {
      const [econ, part] = edgeFlowField.split("_");
      current[econ] = { ...(current[econ] || {}), [part]: event.target.value };
    } else {
      current[edgeFlowField] = event.target.value;
    }
    if (edgeFlowField === "name" && (!current.kind || current.kind === "custom")) {
      current.kind = inferFlowKind(event.target.value);
    }
    flows[index] = createFlow(current);
    applyMutation(
      {
        action: "update_edge",
        target_id: selected.id,
        payload: { flows },
        reason: "Inspector updated edge flow",
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    inferOntologyFromGraph();
    renderCanvas();
    renderValidation();
    renderOntology();
  }

  // DS-7: edge change-moves. Rebuild edge.change from the section's inputs.
  const edgeChangeField = event.target.dataset.edgeChangeField;
  if (edgeChangeField && selected.kind === "edge") {
    const edge = graph.edges.find((item) => item.id === selected.id);
    if (!edge) return;
    const change = buildChangeFromInputs();
    const payload = { change: change || null };
    applyMutation(
      {
        action: "update_edge",
        target_id: selected.id,
        payload,
        reason: "Inspector updated edge change moves",
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    updateStatus();
  }

  // DS-5: node variant base + adoption cost/time. Both the variant_of select
  // and the adoption inputs route here (input + change both fire this handler).
  const nodeVariantField = event.target.dataset.nodeVariantField;
  if (nodeVariantField && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    if (nodeVariantField === "variant_of") {
      applyNodeVariantOf(node, event.target.value);
      renderInspector();
      renderCanvas();
      updateStatus();
    } else {
      const adoption = buildAdoptionFromInputs();
      applyMutation(
        {
          action: "update_node",
          target_id: selected.id,
          payload: { adoption },
          reason: "Inspector updated node adoption",
          confidence: "high",
        },
        { rerender: false, log: false }
      );
      updateStatus();
    }
  }

  // Properties (key/value or quantitative parameter) for nodes (attributes) and
  // edges (properties). Rebuild the whole store from all rows so renaming a key
  // drops the old key; promoted rows assemble a parameter object (DS-1).
  // Fires for plain value/key inputs AND parameter sub-field inputs.
  const propTarget = event.target.dataset.propTarget;
  if (propTarget && (event.target.dataset.propPart || event.target.dataset.propField) && selected.kind === propTarget) {
    const collection = propTarget === "edge" ? graph.edges : graph.nodes;
    const obj = collection.find((item) => item.id === selected.id);
    if (!obj) return;
    const store = collectPropertyStore(propTarget);
    const payload = propTarget === "edge" ? { properties: store } : { attributes: store };
    applyMutation(
      {
        action: propTarget === "edge" ? "update_edge" : "update_node",
        target_id: selected.id,
        payload,
        reason: `Inspector updated ${propTarget} properties`,
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    // The uncertainty-kind and variable-domain selects change which sub-inputs
    // are shown; re-render so the editor reflects the new shape.
    if (["unc_kind", "var_kind", "variable_on", "unc_percent"].includes(event.target.dataset.propField)) {
      renderInspector();
    }
    renderCanvas();
    updateStatus();
  }

  // Perspectives ({ label, text }) for nodes and edges. Rebuild list from all rows.
  const perspectiveTarget = event.target.dataset.perspectiveTarget;
  if (perspectiveTarget && selected.kind === perspectiveTarget) {
    const collection = perspectiveTarget === "edge" ? graph.edges : graph.nodes;
    const obj = collection.find((item) => item.id === selected.id);
    if (!obj) return;
    const inputs = [...els.inspectorContent.querySelectorAll(`[data-perspective-target="${perspectiveTarget}"][data-perspective-part]`)];
    const byIndex = {};
    inputs.forEach((input) => {
      const index = input.dataset.perspectiveIndex;
      byIndex[index] = byIndex[index] || { label: "", text: "" };
      byIndex[index][input.dataset.perspectivePart] = input.value;
    });
    const perspectives = Object.keys(byIndex)
      .sort((a, b) => Number(a) - Number(b))
      .map((index) => byIndex[index]);
    applyMutation(
      {
        action: perspectiveTarget === "edge" ? "update_edge" : "update_node",
        target_id: selected.id,
        payload: { perspectives },
        reason: `Inspector updated ${perspectiveTarget} perspectives`,
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    updateStatus();
  }
}

function handleInspectorClick(event) {
  const deleteNodeId = event.target.closest("[data-delete-node]")?.dataset.deleteNode;
  const deleteEdgeId = event.target.closest("[data-delete-edge]")?.dataset.deleteEdge;
  const addIoField = event.target.closest("[data-add-io]")?.dataset.addIo;
  const removeIoButton = event.target.closest("[data-remove-io]");
  const addPropButton = event.target.closest("[data-add-prop]");
  const removePropButton = event.target.closest("[data-remove-prop]");
  const paramToggleButton = event.target.closest("[data-prop-toggle='parameter']");
  const createVariantButton = event.target.closest("[data-create-variant]");
  const addPerspectiveButton = event.target.closest("[data-add-perspective]");
  const removePerspectiveButton = event.target.closest("[data-remove-perspective]");
  const addEdgeFlow = event.target.closest("[data-add-edge-flow]");
  const removeEdgeFlow = event.target.closest("[data-remove-edge-flow]")?.dataset.removeEdgeFlow;
  const toggleAddNodeForm = event.target.closest("[data-toggle-add-node-form]");
  const createNodeButton = event.target.closest("[data-create-node]");
  const suggestNodeDescriptionButton = event.target.closest("[data-suggest-node-description]");
  const approveNodeDescriptionButton = event.target.closest("[data-approve-node-description]");
  const showFullGraphButton = event.target.closest("[data-show-full-graph]");

  if (showFullGraphButton) {
    clearViewFilter();
    renderInspector();
    return;
  }

  if (toggleAddNodeForm) {
    addNodeFormOpen = !addNodeFormOpen;
    renderInspector();
    saveState();
    return;
  }

  if (createNodeButton) {
    const name = document.getElementById("newNodeNameInput")?.value.trim() || "New task";
    const type = document.getElementById("newNodeTypeSelect")?.value || "task";
    const id = uniqueId(`n_${slug(name)}`);
    applyMutation({
      action: "add_node",
      target_id: null,
      payload: createNode({ id, name, type }),
      reason: "Inspector created node",
      confidence: "high",
    });
    selected = { kind: "node", id };
    addNodeFormOpen = false;
    render();
    return;
  }

  if (suggestNodeDescriptionButton && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    applyMutation({
      action: "update_node",
      target_id: selected.id,
      payload: {
        description: suggestNodeDescription(node, graph),
        description_status: "suggested",
      },
      reason: "Assistant suggested node definition",
      confidence: "medium",
    });
    toast("Definition suggested");
    return;
  }

  if (approveNodeDescriptionButton && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    const description = node.description || suggestNodeDescription(node, graph);
    applyMutation(
      {
        action: "update_node",
        target_id: selected.id,
        payload: {
          description,
          description_status: "approved",
        },
        reason: "Approved node definition into ontology",
        confidence: "high",
      },
      { rerender: false, log: true }
    );
    const approvedNode = graph.nodes.find((item) => item.id === selected.id);
    if (approvedNode) syncNodeDefinitionToOntology(approvedNode, { force: true });
    toast("Definition approved into ontology");
    render();
    return;
  }

  if (deleteNodeId) {
    applyMutation({
      action: "delete_node",
      target_id: deleteNodeId,
      payload: {},
      reason: "Deleted from inspector",
      confidence: "high",
    });
    selected = { kind: null, id: null };
    closeElementEditor();
    render();
  }

  if (deleteEdgeId) {
    applyMutation({
      action: "delete_edge",
      target_id: deleteEdgeId,
      payload: {},
      reason: "Deleted from inspector",
      confidence: "high",
    });
    selected = { kind: null, id: null };
    closeElementEditor();
    render();
  }

  if (addIoField && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    applyMutation({
      action: "update_node",
      target_id: selected.id,
      payload: { [addIoField]: [...(node[addIoField] || []), ""] },
      reason: `Inspector added node ${addIoField}`,
      confidence: "high",
    });
  }

  if (removeIoButton && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    const field = removeIoButton.dataset.removeIo;
    const index = Number(removeIoButton.dataset.listIndex);
    const values = [...(node[field] || [])];
    values.splice(index, 1);
    applyMutation({
      action: "update_node",
      target_id: selected.id,
      payload: { [field]: values },
      reason: `Inspector removed node ${field}`,
      confidence: "high",
    });
  }

  if (addPropButton) {
    const propTarget = addPropButton.dataset.addProp || "node";
    if (selected.kind !== propTarget) return;
    const collection = propTarget === "edge" ? graph.edges : graph.nodes;
    const obj = collection.find((item) => item.id === selected.id);
    if (!obj) return;
    const store = propTarget === "edge" ? { ...(obj.properties || {}) } : { ...(obj.attributes || {}) };
    // Find a free placeholder key so the new (empty-value) row persists and renders.
    let key = "new_property";
    let counter = 1;
    while (Object.prototype.hasOwnProperty.call(store, key)) {
      counter += 1;
      key = `new_property_${counter}`;
    }
    store[key] = "";
    const payload = propTarget === "edge" ? { properties: store } : { attributes: store };
    applyMutation({
      action: propTarget === "edge" ? "update_edge" : "update_node",
      target_id: selected.id,
      payload,
      reason: `Inspector added ${propTarget} property`,
      confidence: "high",
    });
  }

  if (removePropButton) {
    const propTarget = removePropButton.dataset.propTarget || "node";
    if (selected.kind !== propTarget) return;
    const collection = propTarget === "edge" ? graph.edges : graph.nodes;
    const obj = collection.find((item) => item.id === selected.id);
    if (!obj) return;
    const index = Number(removePropButton.dataset.removeProp);
    const entries = Object.entries(propTarget === "edge" ? obj.properties || {} : obj.attributes || {});
    entries.splice(index, 1);
    const store = Object.fromEntries(entries);
    const payload = propTarget === "edge" ? { properties: store } : { attributes: store };
    applyMutation({
      action: propTarget === "edge" ? "update_edge" : "update_node",
      target_id: selected.id,
      payload,
      reason: `Inspector removed ${propTarget} property`,
      confidence: "high",
    });
  }

  // DS-5: clone the selected node into a NEW variant node tagged variant_of the
  // original, with copied attributes, placed near the original, then open it.
  if (createVariantButton) {
    const baseId = createVariantButton.dataset.createVariant;
    const base = graph.nodes.find((item) => item.id === baseId);
    if (!base) return;
    const newId = uniqueId(`${base.id}_variant`);
    const variant = createNode({
      id: newId,
      name: `${base.name || base.id} (variant)`,
      type: base.type,
      inputs: [...(base.inputs || [])],
      outputs: [...(base.outputs || [])],
      attributes: clone(base.attributes || {}),
      variant_of: base.id,
      adoption: {},
    });
    const basePoint = layout[base.id];
    applyMutation(
      {
        action: "add_node",
        target_id: null,
        payload: variant,
        reason: "Inspector created node variant",
        confidence: "high",
      },
      { rerender: false, log: true }
    );
    // Place near the original (offset) rather than the default grid slot.
    layout[newId] = basePoint ? { x: basePoint.x + 60, y: basePoint.y + 90 } : nextLayoutPoint();
    selected = { kind: "node", id: newId };
    render();
    openElementEditor();
    toast("Variant created");
    return;
  }

  // DS-1: promote a plain value to a quantitative parameter, or demote back to
  // a plain string. Reads the live DOM store, swaps just this key, re-renders.
  if (paramToggleButton) {
    const propTarget = paramToggleButton.dataset.propTarget || "node";
    if (selected.kind !== propTarget) return;
    const collection = propTarget === "edge" ? graph.edges : graph.nodes;
    const obj = collection.find((item) => item.id === selected.id);
    if (!obj) return;
    const index = paramToggleButton.dataset.propIndex;
    const keyInput = els.inspectorContent.querySelector(
      `[data-prop-target="${propTarget}"][data-prop-index="${index}"][data-prop-part="key"]`
    );
    const key = (keyInput?.value || "").trim();
    const store = collectPropertyStore(propTarget);
    if (key) {
      const promote = paramToggleButton.getAttribute("aria-pressed") !== "true";
      const current = store[key];
      if (promote) {
        const numeric = isParameterValue(current) ? current : { value: String(current ?? "") };
        store[key] = normalizeParameter(numeric);
      } else {
        store[key] = isParameterValue(current) ? String(current.value ?? "") : String(current ?? "");
      }
    }
    const payload = propTarget === "edge" ? { properties: store } : { attributes: store };
    applyMutation(
      {
        action: propTarget === "edge" ? "update_edge" : "update_node",
        target_id: selected.id,
        payload,
        reason: `Inspector ${paramToggleButton.getAttribute("aria-pressed") === "true" ? "demoted" : "promoted"} ${propTarget} property`,
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    renderInspector();
    renderCanvas();
    updateStatus();
    return;
  }

  if (addPerspectiveButton) {
    const perspectiveTarget = addPerspectiveButton.dataset.addPerspective || "node";
    if (selected.kind !== perspectiveTarget) return;
    const collection = perspectiveTarget === "edge" ? graph.edges : graph.nodes;
    const obj = collection.find((item) => item.id === selected.id);
    if (!obj) return;
    const perspectives = [...(Array.isArray(obj.perspectives) ? obj.perspectives : []), { label: "New perspective", text: "" }];
    applyMutation({
      action: perspectiveTarget === "edge" ? "update_edge" : "update_node",
      target_id: selected.id,
      payload: { perspectives },
      reason: `Inspector added ${perspectiveTarget} perspective`,
      confidence: "high",
    });
  }

  if (removePerspectiveButton) {
    const perspectiveTarget = removePerspectiveButton.dataset.perspectiveTarget || "node";
    if (selected.kind !== perspectiveTarget) return;
    const collection = perspectiveTarget === "edge" ? graph.edges : graph.nodes;
    const obj = collection.find((item) => item.id === selected.id);
    if (!obj) return;
    const perspectives = [...(Array.isArray(obj.perspectives) ? obj.perspectives : [])];
    perspectives.splice(Number(removePerspectiveButton.dataset.removePerspective), 1);
    applyMutation({
      action: perspectiveTarget === "edge" ? "update_edge" : "update_node",
      target_id: selected.id,
      payload: { perspectives },
      reason: `Inspector removed ${perspectiveTarget} perspective`,
      confidence: "high",
    });
  }

  if (addEdgeFlow && selected.kind === "edge") {
    const edge = graph.edges.find((item) => item.id === selected.id);
    if (!edge) return;
    const flows = normalizeFlows(edge.flows);
    const inferred = inferEdgeFlowsFromNodes(edge)[0] || createFlow({ name: "", kind: "information" });
    flows.push(inferred);
    applyMutation({
      action: "update_edge",
      target_id: selected.id,
      payload: { flows },
      reason: "Inspector added edge flow",
      confidence: "high",
    });
  }

  if (removeEdgeFlow !== undefined && selected.kind === "edge") {
    const edge = graph.edges.find((item) => item.id === selected.id);
    if (!edge) return;
    const flows = normalizeFlows(edge.flows);
    flows.splice(Number(removeEdgeFlow), 1);
    applyMutation({
      action: "update_edge",
      target_id: selected.id,
      payload: { flows },
      reason: "Inspector removed edge flow",
      confidence: "high",
    });
  }
}

function handleElementConstraintInput(event) {
  const item = event.target.closest("[data-constraint-id]");
  if (!item || event.target.dataset.constraintField !== "expression") return;
  const constraint = graph.constraints.find((entry) => entry.id === item.dataset.constraintId);
  if (!constraint) return;
  applyMutation(
    {
      action: "update_constraint",
      target_id: item.dataset.constraintId,
      payload: { expression: event.target.value },
      reason: "Constraint edited on element",
      confidence: "high",
    },
    { rerender: false, log: false }
  );
  renderValidation();
  // The textarea already displays the committed value, so we skip re-rendering to preserve focus.
}

function handleElementConstraintClick(event) {
  if (event.target.closest("[data-add-constraint]")) {
    addConstraintForSelected();
    return;
  }
  const deleteButton = event.target.closest("[data-delete-constraint]");
  if (!deleteButton) return;
  const id = deleteButton.dataset.deleteConstraint;
  const index = graph.constraints.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  pushUndoSnapshot("Before remove constraint");
  graph.constraints.splice(index, 1);
  inferOntologyFromGraph();
  renderElementConstraints();
  renderValidation();
  saveState();
}

function addConstraintForSelected() {
  if (selected.kind !== "node" && selected.kind !== "edge") return;
  if (!selected.id) return;
  const id = uniqueId(`c_${slug(selected.id)}_${graph.constraints.length + 1}`);
  applyMutation(
    {
      action: "add_constraint",
      target_id: null,
      payload: createConstraint({ id, type: "policy_rule", expression: "", fields: { target: selected.id } }),
      reason: "Added constraint on element",
      confidence: "medium",
    },
    { rerender: false, log: true }
  );
  renderElementConstraints();
  renderValidation();
}

function addNodeFromToolbar(type) {
  const count = graph.nodes.filter((node) => node.type === type).length + 1;
  const id = uniqueId(`n_${type}_${count}`);
  const x = 120 + (graph.nodes.length % 4) * 190;
  const y = 110 + Math.floor(graph.nodes.length / 4) * 150;
  applyMutation({
    action: "add_node",
    target_id: null,
    payload: createNode({ id, name: `${titleCase(type)} ${count}`, type }),
    reason: `Toolbar added ${type} node`,
    confidence: "high",
  });
  layout[id] = { x, y };
  selected = { kind: "node", id };
  render();
}


function applyMutations(mutations) {
  if (mutations.some((mutation) => GRAPH_MUTATION_ACTIONS.includes(mutation.action))) {
    pushUndoSnapshot("Before applied mutation plan");
  }
  mutations.forEach((mutation) => applyMutation(mutation, { rerender: false, log: true }));
  autoLayoutGraph();
  clarificationContext = null;
  render();
}

function pushUndoSnapshot(label) {
  undoStack.push({
    label,
    graph: clone(graph),
    layout: clone(layout),
    selected: clone(selected),
    mutationLog: clone(mutationLog),
    openQuestions: clone(openQuestions),
    chatMessages: clone(chatMessages),
    timestamp: new Date().toISOString(),
  });
  undoStack = undoStack.slice(-12);
}

function undoLastMutationBatch() {
  const snapshot = undoStack.pop();
  if (!snapshot) return;
  graph = snapshot.graph;
  layout = snapshot.layout;
  selected = snapshot.selected || { kind: null, id: null };
  mutationLog = snapshot.mutationLog || [];
  openQuestions = snapshot.openQuestions || [];
  chatMessages = snapshot.chatMessages || [];
  pendingPlan = null;
  clarificationContext = null;
  appendChatMessage("assistant", { summary: "Undid last graph change", detail: snapshot.label || "Restored the previous graph state.", questions: [], warnings: [] });
  renderPlan();
  render();
  toast("Last graph change undone");
}

function applyMutation(mutation, options = {}) {
  const settings = { rerender: true, log: true, ...options };
  if (!MUTATION_ACTIONS.includes(mutation.action)) {
    throw new Error(`Unsupported mutation action: ${mutation.action}`);
  }

  const payload = mutation.payload || {};
  switch (mutation.action) {
    case "add_node": {
      const node = createNode(payload);
      if (graph.nodes.some((item) => item.id === node.id)) return;
      graph.nodes.push(node);
      if (!layout[node.id]) layout[node.id] = nextLayoutPoint();
      selected = { kind: "node", id: node.id };
      break;
    }
    case "update_node": {
      const node = graph.nodes.find((item) => item.id === mutation.target_id);
      if (!node) return;
      Object.assign(node, payload);
      // The Properties editor sends the complete rebuilt attributes object (so a
      // removed/renamed key drops); use it as a full replacement rather than a merge.
      node.attributes = payload.attributes ? { ...payload.attributes } : node.attributes || {};
      node.resources_required = normalizeResourceRequirements(node.resources_required);
      break;
    }
    case "delete_node": {
      graph.nodes = graph.nodes.filter((node) => node.id !== mutation.target_id);
      graph.edges = graph.edges.filter(
        (edge) => edge.from_node !== mutation.target_id && edge.to_node !== mutation.target_id
      );
      delete layout[mutation.target_id];
      break;
    }
    case "add_edge": {
      const edge = createEdge(payload);
      if (graph.edges.some((item) => item.id === edge.id)) return;
      graph.edges.push(edge);
      selected = { kind: "edge", id: edge.id };
      break;
    }
    case "update_edge": {
      const edge = graph.edges.find((item) => item.id === mutation.target_id);
      if (!edge) return;
      Object.assign(edge, payload);
      edge.type = normalizeEdgeType(edge.type);
      edge.flows = normalizeFlows(edge.flows);
      edge.resources_required = normalizeResourceRequirements(edge.resources_required);
      // Properties editor sends the complete rebuilt object — full replacement so
      // removed/renamed keys drop (mirrors node attributes).
      edge.properties = payload.properties ? { ...payload.properties } : edge.properties || {};
      edge.perspectives = normalizePerspectives(edge.perspectives);
      break;
    }
    case "delete_edge": {
      graph.edges = graph.edges.filter((edge) => edge.id !== mutation.target_id);
      break;
    }
    case "add_resource": {
      const resource = createResource(payload);
      if (graph.resources.some((item) => item.id === resource.id)) return;
      graph.resources.push(resource);
      break;
    }
    case "update_resource": {
      const resource = graph.resources.find((item) => item.id === mutation.target_id);
      if (!resource) return;
      Object.assign(resource, payload);
      resource.attributes = { ...(resource.attributes || {}), ...(payload.attributes || {}) };
      break;
    }
    case "add_constraint": {
      const constraint = createConstraint(payload);
      if (graph.constraints.some((item) => item.id === constraint.id)) return;
      graph.constraints.push(constraint);
      break;
    }
    case "update_constraint": {
      const constraint = graph.constraints.find((item) => item.id === mutation.target_id);
      if (!constraint) return;
      Object.assign(constraint, payload);
      // expression is the source of truth (free text); fields kept only for back-compat.
      if (payload.fields) {
        constraint.fields = { ...(constraint.fields || {}), ...payload.fields };
      }
      break;
    }
    case "add_assumption": {
      const assumption = { id: payload.id || uniqueId(`a_${graph.assumptions.length + 1}`), text: payload.text || "" };
      graph.assumptions.push(assumption);
      break;
    }
    case "add_question": {
      const text = payload.text || payload.question || "";
      if (text && !openQuestions.includes(text)) openQuestions.push(text);
      break;
    }
    default:
      break;
  }

  inferOntologyFromGraph();

  if (settings.log) {
    mutationLog.push({
      ...mutation,
      timestamp: new Date().toISOString(),
    });
  }
  // Single persistence chokepoint. A full render() already persists via
  // saveState(); partial-render edits (e.g. inspector field edits) persist here
  // so no edit is silently lost on reload.
  if (settings.rerender) {
    render();
  } else {
    saveState();
  }
}

function compileInstruction(input) {
  const message = input.trim();
  const warnings = [];
  const questions = [];
  const mutations = [];

  if (!message) {
    questions.push("What process structure should be added or modified?");
    return buildCompilerResponse("No instruction provided", mutations, questions, warnings);
  }

  const segments = extractSegments(message);

  if (segments.length < 2) {
    questions.push("Which existing node should this step connect from and to?");
    const nodeName = cleanNodeName(message);
    if (nodeName) {
      const id = findNodeByName(nodeName)?.id || uniqueId(`n_${slug(nodeName)}`);
      if (!graph.nodes.some((node) => node.id === id)) {
        mutations.push({
          action: "add_node",
          target_id: null,
          payload: createNode({ id, name: nodeName, type: inferNodeType(nodeName, message) }),
          reason: "User described a step without clear sequencing",
          confidence: "medium",
        });
      }
    }
    return buildCompilerResponse("Instruction needs sequencing clarification", mutations, questions, warnings);
  }

  const segmentIds = [];
  segments.forEach((name, index) => {
    const existing = findNodeByName(name);
    const type = inferNodeType(name, message, index, segments.length);
    const id = existing?.id || uniqueId(`n_${slug(name)}`);
    segmentIds.push(id);
    if (!existing) {
      mutations.push({
        action: "add_node",
        target_id: null,
        payload: createNode({ id, name, type }),
        reason: "User described a process step",
        confidence: type === "decision" ? "medium" : "high",
      });
    }
  });

  for (let i = 0; i < segmentIds.length - 1; i += 1) {
    const fromId = segmentIds[i];
    const toId = segmentIds[i + 1];
    if (graph.edges.some((edge) => edge.from_node === fromId && edge.to_node === toId)) continue;
    const fromName = segments[i];
    const type = inferEdgeType(message, fromName);
    mutations.push({
      action: "add_edge",
      target_id: null,
      payload: {
        id: uniqueId(`e_${slug(fromId)}_${slug(toId)}`),
        from_node: fromId,
        to_node: toId,
        type,
        condition: inferNodeType(fromName, message) === "decision" ? inferCondition(message, fromName, segments[i + 1]) : "",
        flows: inferFlowsFromText(message, fromName, segments[i + 1]),
      },
      reason: "User described flow between steps",
      confidence: inferNodeType(fromName, message) === "decision" ? "medium" : "high",
    });
  }

  const decisionNames = segments.filter((name) => inferNodeType(name, message) === "decision");
  decisionNames.forEach((name) => {
    const outgoingCount =
      graph.edges.filter((edge) => edge.from_node === findNodeByName(name)?.id).length +
      mutations.filter((mutation) => mutation.action === "add_edge" && mutation.payload.from_node === segmentIds[segments.indexOf(name)])
        .length;
    if (outgoingCount < 2) {
      questions.push(`What are the complete outgoing branches for decision "${name}"?`);
      mutations.push({
        action: "add_question",
        target_id: null,
        payload: { text: `What are the complete outgoing branches for decision "${name}"?` },
        reason: "Decision branch is incomplete",
        confidence: "high",
      });
    }
  });

  if (/\b(maybe|probably|assume|usually|typically)\b/i.test(message)) {
    mutations.push({
      action: "add_assumption",
      target_id: null,
      payload: {
        id: uniqueId(`a_${graph.assumptions.length + 1}`),
        text: "User instruction included uncertain or implied process structure.",
      },
      reason: "Information was implied but uncertain",
      confidence: "medium",
    });
  }

  return buildCompilerResponse("Compiled user instruction into graph mutations", mutations, questions, warnings);
}

function buildCompilerResponse(summary, mutations, questions, warnings) {
  const simulatedGraph = clone(graph);
  const originalGraph = graph;
  const originalLayout = layout;
  const originalSelected = selected;
  const originalQuestions = openQuestions;
  const originalLog = mutationLog;
  graph = simulatedGraph;
  layout = clone(layout);
  selected = clone(selected);
  openQuestions = clone(openQuestions);
  mutationLog = clone(mutationLog);
  mutations.forEach((mutation) => applyMutation(mutation, { rerender: false, log: false }));
  const validation = validateGraph();
  const missingValues = findMissingValues(graph);
  const missingConstraints = graph.constraints.length ? [] : ["constraints"];
  graph = originalGraph;
  layout = originalLayout;
  selected = originalSelected;
  openQuestions = originalQuestions;
  mutationLog = originalLog;

  return {
    summary,
    mutations,
    questions,
    warnings,
    handoff_readiness: {
      structure_complete: validation.items.filter((item) => item.level === "error").length === 0 && questions.length === 0,
      missing_values: missingValues,
      missing_constraints: missingConstraints,
      open_questions: questions,
    },
  };
}

// Computes the validation scope. When the "validate current view only" toggle is
// on AND a filter is active, validation runs against just the view's visible id
// sets (so a view that hides an orphan's only edge does not report the orphan as
// newly broken). Otherwise it validates the full graph exactly as before.
function validationScope() {
  if (validateCurrentView && filterIsActive(activeFilter)) {
    const view = resolveView(graph, activeFilter, selected);
    if (view.active) {
      const scopedNodes = graph.nodes.filter((node) => view.nodeIds.has(node.id));
      const scopedEdges = graph.edges.filter((edge) => view.edgeIds.has(edge.id));
      return {
        scoped: true,
        nodes: scopedNodes,
        edges: scopedEdges,
        // Constraints are not id-restricted by views, so validate them as-is.
        constraints: graph.constraints,
        visibleNodeCount: scopedNodes.length,
        totalNodeCount: graph.nodes.length,
      };
    }
  }
  return {
    scoped: false,
    nodes: graph.nodes,
    edges: graph.edges,
    constraints: graph.constraints,
    visibleNodeCount: graph.nodes.length,
    totalNodeCount: graph.nodes.length,
  };
}

function validateGraph() {
  const items = [];
  const scope = validationScope();
  const scopeGraph = { nodes: scope.nodes, edges: scope.edges, constraints: scope.constraints };
  const nodeIds = new Set(scopeGraph.nodes.map((node) => node.id));
  const incoming = countBy(scopeGraph.edges, "to_node");
  const outgoing = countBy(scopeGraph.edges, "from_node");

  scopeGraph.edges.forEach((edge) => {
    if (!nodeIds.has(edge.from_node)) {
      items.push({ level: "error", title: "Invalid edge source", detail: `${edge.id} references ${edge.from_node}` });
    }
    if (!nodeIds.has(edge.to_node)) {
      items.push({ level: "error", title: "Invalid edge target", detail: `${edge.id} references ${edge.to_node}` });
    }
    if (edge.type === "flow" && !normalizeFlows(edge.flows).length) {
      items.push({ level: "warn", title: "Flow missing payload", detail: `${edge.id} should name what moves on the edge.` });
    }
  });

  scopeGraph.nodes.forEach((node) => {
    const inCount = incoming[node.id] || 0;
    const outCount = outgoing[node.id] || 0;
    if (node.type === "source" && outCount === 0) {
      items.push({ level: "warn", title: "Source has no output edge", detail: `${node.name} does not feed any step.` });
    }
    if (node.type === "sink" && inCount === 0) {
      items.push({ level: "warn", title: "Sink has no input edge", detail: `${node.name} is not reached by the process.` });
    }
    if ((node.type === "task" || node.type === "decision") && (inCount === 0 || outCount === 0)) {
      items.push({ level: "warn", title: "Orphan node", detail: `${node.name} is missing an input or output edge.` });
    }
    if (node.type === "decision" && outCount < 2) {
      items.push({
        level: "warn",
        title: "Decision needs 2+ outputs",
        detail: `${node.name} has ${outCount} outgoing branch${outCount === 1 ? "" : "es"}.`,
      });
    }
    if (node.type === "decision" && outCount >= 2) {
      scopeGraph.edges
        .filter((edge) => edge.from_node === node.id)
        .forEach((edge) => {
          if (!edge.condition) {
            items.push({ level: "warn", title: "Decision branch condition missing", detail: `${edge.id} should explain when that branch is used.` });
          }
        });
    }
  });

  scopeGraph.constraints.forEach((constraint) => {
    if (!String(constraint.expression || "").trim()) {
      items.push({ level: "warn", title: "Constraint statement missing", detail: `${constraint.id} needs a plain-language statement describing the constraint.` });
    }
  });

  items.push(...profileValidationItems(scopeGraph));

  if (!allowCycles && hasCycle(scopeGraph)) {
    items.push({
      level: "warn",
      title: "Cycle detected",
      detail: "The graph contains a cycle. Enable cycles only when rework loops are intentional.",
    });
  }

  return { items, scope };
}

// Profile-aware hints (P2-1). These are PLAIN-LANGUAGE, read-only suggestions
// keyed to the selected modeling_style. They are never "error" — style must
// never block handoff or mutate the graph — only "warn" or "info". Works against
// the passed-in graph so it composes with the view-scoped validation set.
function profileValidationItems(targetGraph = graph) {
  const items = [];
  const style = graph.modeling_style || "none";
  const nodes = targetGraph.nodes || [];
  const edges = targetGraph.edges || [];
  const flowKinds = new Set(edges.flatMap((edge) => normalizeFlows(edge.flows).map((flow) => flow.kind)));
  const outgoing = countBy(edges, "from_node");
  const hasType = (type) => nodes.some((node) => node.type === type);

  if (style === "business_process") {
    if (!hasType("source")) {
      items.push({ level: "warn", title: "No start point", detail: "A business process usually has a start (source) node showing where it begins." });
    }
    if (!hasType("sink")) {
      items.push({ level: "warn", title: "No end point", detail: "A business process usually has an end (sink) node showing where it finishes." });
    }
    const thinDecisions = nodes.filter((node) => node.type === "decision" && (outgoing[node.id] || 0) < 2);
    if (thinDecisions.length) {
      const names = thinDecisions.map((node) => `"${node.name}"`).join(", ");
      items.push({
        level: "info",
        title: "Decisions should branch",
        detail: `In a business process, a decision should lead to at least two paths. Add more outgoing edges for: ${names}.`,
      });
    }
  }

  if (style === "value_stream") {
    if (!flowKinds.has("parts") && !flowKinds.has("information")) {
      items.push({
        level: "info",
        title: "Label your flow kinds",
        detail: "Value stream maps separate material flows (parts) from information flows. Set each edge's flow kind to 'parts' or 'information' so the two are clear.",
      });
    }
  }

  if (style === "system_flow") {
    const missingPorts = nodes.filter(
      (node) => !(node.inputs || []).length && !(node.outputs || []).length
    );
    if (missingPorts.length) {
      items.push({
        level: "info",
        title: "Add inputs and outputs",
        detail: `${missingPorts.length} node${missingPorts.length === 1 ? "" : "s"} have no defined inputs or outputs. System flow diagrams read best when each block lists its input and output ports.`,
      });
    }
  }

  if (style === "team_topology") {
    if (!hasType("resource")) {
      items.push({
        level: "info",
        title: "Add teams as resources",
        detail: "Team topology maps usually include teams as resource nodes. Add resource nodes to show who owns each part of the work.",
      });
    }
    const hasInteraction = edges.some((edge) => edge.type === "allocation" || edge.type === "dependency");
    if (!hasInteraction) {
      items.push({
        level: "info",
        title: "Show team interactions",
        detail: "Add allocation or dependency edges to show how teams hand work off or depend on each other.",
      });
    }
  }

  // "none" and "custom" intentionally add no style-specific hints.
  return items;
}

function hasCycle(targetGraph) {
  const adjacency = new Map();
  targetGraph.nodes.forEach((node) => adjacency.set(node.id, []));
  targetGraph.edges.forEach((edge) => {
    if (adjacency.has(edge.from_node)) adjacency.get(edge.from_node).push(edge.to_node);
  });

  const visiting = new Set();
  const visited = new Set();

  function dfs(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) || []) {
      if (dfs(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return targetGraph.nodes.some((node) => dfs(node.id));
}

function generateMarkdown() {
  const lines = [];
  const validation = validateGraph().items;
  lines.push(`# Process Graph: ${graph.name}`);
  lines.push("");
  lines.push("## Description");
  lines.push(graph.description || "");
  lines.push("");
  lines.push(`Modeling style: ${ontologyLabel("modeling_styles", graph.modeling_style || "none")}`);
  const profile = currentNotationProfile();
  lines.push(`Notation profile: ${profile.label} (${profile.shortLabel})`);
  if (profile.references?.length) {
    lines.push(
      `Notation references: ${profile.references
        .map((key) => {
          const reference = OFFICIAL_REFERENCES[key];
          return reference ? `${reference.label} - ${reference.url}` : "";
        })
        .filter(Boolean)
        .join("; ")}`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Nodes");
  lines.push("");
  graph.nodes.forEach((node) => {
    lines.push(`### ${node.id} - ${node.name}`);
    lines.push(`- Type: ${node.type}`);
    if (node.description) {
      lines.push(`- Definition: ${node.description}`);
      lines.push(`- Definition Status: ${definitionStatusLabel(normalizeNodeDescriptionStatus(node.description_status, node.description))}`);
    }
    lines.push(`- Inputs: [${node.inputs.join(", ")}]`);
    lines.push(`- Outputs: [${node.outputs.join(", ")}]`);
    normalizePerspectives(node.perspectives).forEach((perspective) => {
      lines.push(`- Perspective (${perspective.label || "Note"}): ${perspective.text}`);
    });
    lines.push("");
  });
  lines.push("---");
  lines.push("");
  lines.push("## Edges");
  lines.push("");
  graph.edges.forEach((edge) => {
    const from = graph.nodes.find((node) => node.id === edge.from_node)?.name || edge.from_node;
    const to = graph.nodes.find((node) => node.id === edge.to_node)?.name || edge.to_node;
    const condition = edge.condition ? ` (if ${edge.condition.replace(/^if\s+/i, "")})` : "";
    const flows = normalizeFlows(edge.flows)
      .map((flow) => `${flow.name || "Unnamed flow"} [${ontologyLabel("flow_types", flow.kind)}${flow.quantity ? `, qty ${flow.quantity}` : ""}${flow.unit ? ` ${flow.unit}` : ""}]`)
      .join("; ");
    lines.push(`- ${from} -> ${to} | ${ontologyLabel("edge_types", edge.type)}${condition}${flows ? ` | Flows: ${flows}` : ""}`);
    normalizePerspectives(edge.perspectives).forEach((perspective) => {
      lines.push(`  - Perspective (${perspective.label || "Note"}): ${perspective.text}`);
    });
  });
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Constraints");
  lines.push("");
  graph.constraints.forEach((constraint) => {
    lines.push(`- ${constraint.id}: ${ontologyLabel("constraint_types", constraint.type)} - ${constraint.expression || "TBD"}`);
  });
  if (!graph.constraints.length) lines.push("- None");
  lines.push("");
  lines.push("---");
  lines.push("");
  if (graph.assumptions.length) {
    lines.push("## Assumptions");
    lines.push("");
    graph.assumptions.forEach((assumption) => {
      lines.push(`- ${assumption.text}`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  if (openQuestions.length) {
    lines.push("## Open Questions");
    lines.push("");
    openQuestions.forEach((question) => lines.push(`- ${question}`));
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  lines.push("## Validation");
  lines.push("");
  const errorCount = validation.filter((item) => item.level === "error").length;
  const warningCount = validation.filter((item) => item.level === "warn").length;
  lines.push(`- Errors: ${errorCount}`);
  lines.push(`- Warnings: ${warningCount}`);
  if (validation.length) {
    validation.forEach((item) => lines.push(`- [${item.level}] ${item.title} - ${item.detail}`));
  } else {
    lines.push("- No issues");
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Handoff Readiness");
  lines.push("");
  lines.push("_A summary/proposal for downstream tools, not a guarantee._");
  lines.push("");
  lines.push(`- Structure complete: ${errorCount === 0 ? "yes" : "no"}`);
  lines.push(`- Errors: ${errorCount}`);
  lines.push(`- Warnings: ${warningCount}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  const savedViews = Array.isArray(graph.saved_views) ? graph.saved_views : [];
  if (savedViews.length) {
    lines.push("## Saved Views");
    lines.push("");
    savedViews.forEach((view) => lines.push(`- ${view.name || view.id}`));
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  lines.push("## Ontology");
  lines.push("");
  Object.entries(graph.ontology || {}).forEach(([group, entries]) => {
    lines.push(`### ${titleCase(group)}`);
    Object.entries(entries).forEach(([id, entry]) => {
      lines.push(`- ${id}: ${entry.label || titleCase(id)} - ${entry.description || ""}`);
    });
    lines.push("");
  });
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Mutation History");
  lines.push("");
  mutationLog.forEach((entry) => {
    lines.push(`- ${entry.timestamp || ""} ${entry.action}${entry.target_id ? ` ${entry.target_id}` : ""}: ${entry.reason || ""}`);
  });
  if (!mutationLog.length) lines.push("- None");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Chat Transcript");
  lines.push("");
  chatMessages.forEach((message) => {
    const content = message.content || {};
    lines.push(`- ${message.role}: ${content.summary ? `${content.summary} - ` : ""}${content.detail || ""}`);
  });
  if (!chatMessages.length) lines.push("- None");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Design Space");
  lines.push("");
  const space = buildDesignSpace(graph);
  const describeDomain = (domain) => {
    if (!domain) return "";
    if (domain.kind === "range") {
      const span = [domain.min, domain.max].filter((v) => v !== undefined && v !== null && v !== "").join(" to ");
      return `range ${span}${domain.step ? ` step ${domain.step}` : ""}${domain.unit ? ` ${domain.unit}` : ""}`.trim();
    }
    if (domain.kind === "enum") return `one of {${(domain.options || []).join(", ")}}`;
    if (domain.kind === "boolean") return "on/off";
    return domain.kind || "";
  };
  const qty = (q) => (q ? `${q.value ?? ""}${q.unit ? ` ${q.unit}` : ""}`.trim() : "");
  if (!space.variables.length && !space.objectives.length && !space.budgets.length && !space.notes) {
    lines.push("- None defined");
  } else {
    lines.push("### Decision variables");
    if (space.variables.length) {
      space.variables.forEach((variable) => {
        if (variable.kind === "parameter") lines.push(`- parameter: ${variable.target}${variable.domain ? ` — ${describeDomain(variable.domain)}` : ""}`);
        else if (variable.kind === "node_variant") lines.push(`- node variant: ${variable.base} → {${(variable.options || []).join(", ")}}`);
        else if (variable.kind === "flow_move") lines.push(`- flow move: ${variable.target} — ${(variable.moves || []).join(", ")}`);
      });
    } else {
      lines.push("- None");
    }
    lines.push("");
    lines.push("### Objectives");
    if (space.objectives.length) {
      space.objectives.forEach((objective) => lines.push(`- ${objective.metric}${objective.direction ? ` (${objective.direction})` : ""}${objective.kind ? ` [${objective.kind}]` : ""}`));
    } else {
      lines.push("- None");
    }
    lines.push("");
    lines.push("### Budgets");
    if (space.budgets.length) {
      space.budgets.forEach((budgetItem) => lines.push(`- ${budgetItem.metric}: ${qty(budgetItem.limit)}`));
    } else {
      lines.push("- None");
    }
    if (space.notes) {
      lines.push("");
      lines.push(`Notes: ${space.notes}`);
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Graph JSON");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(graph, null, 2));
  lines.push("```");
  return lines.join("\n");
}

function snakeCaseNotationProfile(profile) {
  if (!profile) return profile;
  return {
    label: profile.label,
    short_label: profile.shortLabel,
    summary: profile.summary,
    references: profile.references,
    port_shape: profile.portShape,
    node_legend: profile.nodeLegend,
    edge_legend: profile.edgeLegend,
  };
}

// Derives a handoff-readiness summary from the current validation run.
// This is a PROPOSAL/summary for downstream solver/agent tools, not a
// guarantee that the graph is correct or solvable (P2-3).
function computeHandoffReadiness() {
  const items = validateGraph().items;
  const errorCount = items.filter((item) => item.level === "error").length;
  const warningCount = items.filter((item) => item.level === "warn").length;
  return {
    structure_complete: errorCount === 0,
    error_count: errorCount,
    warning_count: warningCount,
    open_questions: openQuestions.slice(),
    assumptions_count: (graph.assumptions || []).length,
    validation: items,
  };
}

function exportEnvelope() {
  const exportedAt = new Date().toISOString();
  const validation = validateGraph().items;
  return {
    // Future-ready envelope metadata (P0-0). The envelope is NOT validated
    // by the graph schema, so these extra fields are safe to carry.
    artifact_id: "art_" + Date.now(),
    schema_version: SCHEMA_VERSION,
    graph_version: graph.version,
    created_by: graph.metadata?.created_by || "user",
    created_at: graph.metadata?.created_at || exportedAt,
    updated_at: exportedAt,
    // Core artifact: most downstream-tool inputs ride along inside `graph`
    // (ontology, assumptions, open_questions, versions, saved_views).
    graph,
    layout,
    selected,
    mutation_log: mutationLog,
    open_questions: openQuestions,
    chat_messages: chatMessages,
    llm_assist_enabled: llmAssistEnabled,
    ontology: graph.ontology,
    assumptions: graph.assumptions,
    versions: graph.versions || [],
    saved_views: graph.saved_views,
    // DS-3: the flattened design-space handoff artifact (derived variables +
    // authored objectives/budgets/notes). Computed at export time.
    design_space: buildDesignSpace(graph),
    notation_profile: snakeCaseNotationProfile(currentNotationProfile()),
    validation,
    handoff_readiness: computeHandoffReadiness(),
    exported_at: exportedAt,
  };
}

function downloadMarkdown() {
  const markdown = generateMarkdown();
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(graph.name) || "process-graph"}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Markdown exported");
}

function downloadGraphJson() {
  const json = graphJsonText();
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(graph.name) || "process-graph"}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Graph JSON exported");
}

function graphJsonText() {
  return JSON.stringify(exportEnvelope(), null, 2);
}

function graphFilePickerTypes() {
  return [
    {
      description: "Process graph JSON",
      accept: { "application/json": [".json"] },
    },
  ];
}

function supportsOpenFilePicker() {
  return typeof window.showOpenFilePicker === "function";
}

function supportsSaveFilePicker() {
  return typeof window.showSaveFilePicker === "function";
}

function clearCurrentFileHandle() {
  currentFileHandle = null;
  currentFileName = "";
  updateFileAccessUi();
}

function updateCurrentFileHandle(fileHandle, fileName) {
  currentFileHandle = fileHandle || null;
  currentFileName = fileHandle?.name || fileName || "";
  updateFileAccessUi();
}

function updateFileAccessUi() {
  if (els.fileSaveStatus) {
    els.fileSaveStatus.textContent = currentFileHandle
      ? `Opened file: ${currentFileName || "JSON file"}`
      : "No opened file";
  }
  if (els.saveToOpenedFileButton) {
    els.saveToOpenedFileButton.disabled = !currentFileHandle;
    els.saveToOpenedFileButton.title = currentFileHandle
      ? `Save to ${currentFileName || "the opened JSON file"}`
      : "Open a JSON file first";
  }
  if (els.saveAsFileButton) {
    els.saveAsFileButton.title = supportsSaveFilePicker()
      ? "Choose a JSON file path"
      : "Exports JSON as a download in this browser";
  }
  if (els.openFilePickerButton) {
    els.openFilePickerButton.title = supportsOpenFilePicker()
      ? "Open a JSON file for save-back editing"
      : "Imports JSON in this browser";
  }
}

async function openGraphFileWithPicker() {
  if (!supportsOpenFilePicker()) {
    els.importFileInput.click();
    toast("Opened the import picker");
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: graphFilePickerTypes(),
      excludeAcceptAllOption: false,
    });
    if (!handle) return;
    const file = await handle.getFile();
    const imported = await importGraphFromFile(file, { fileHandle: handle });
    if (imported) closeLibrary();
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.warn("Unable to open JSON file", error);
    toast("Could not open JSON file");
  }
}

async function requestWritableFilePermission(fileHandle) {
  if (!fileHandle) return false;
  const options = { mode: "readwrite" };
  if (typeof fileHandle.queryPermission === "function") {
    const current = await fileHandle.queryPermission(options);
    if (current === "granted") return true;
  }
  if (typeof fileHandle.requestPermission === "function") {
    return (await fileHandle.requestPermission(options)) === "granted";
  }
  return true;
}

async function writeGraphToFileHandle(fileHandle) {
  const hasPermission = await requestWritableFilePermission(fileHandle);
  if (!hasPermission) {
    toast("File write permission was not granted");
    return false;
  }
  const writable = await fileHandle.createWritable();
  await writable.write(graphJsonText());
  await writable.close();
  updateCurrentFileHandle(fileHandle);
  saveState();
  return true;
}

async function saveGraphToOpenedFile() {
  if (!currentFileHandle) {
    toast("Open a JSON file first");
    updateFileAccessUi();
    return;
  }
  try {
    const saved = await writeGraphToFileHandle(currentFileHandle);
    if (saved) toast(`Saved ${currentFileName || "JSON file"}`);
  } catch (error) {
    console.warn("Unable to save opened JSON file", error);
    toast("Could not save opened file");
  }
}

async function saveGraphAsFile() {
  if (!supportsSaveFilePicker()) {
    downloadGraphJson();
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: `${slug(graph.name) || "process-graph"}.json`,
      types: graphFilePickerTypes(),
      excludeAcceptAllOption: false,
    });
    const saved = await writeGraphToFileHandle(handle);
    if (saved) {
      toast(`Saved ${currentFileName || "JSON file"}`);
      closeSaveDialog();
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.warn("Unable to save JSON file", error);
    toast("Could not save JSON file");
  }
}

// DS-3: download just the design_space artifact (derived variables + authored
// objectives/budgets/notes), reusing the blob/anchor pattern above.
function downloadDesignSpaceJson() {
  const json = JSON.stringify(buildDesignSpace(graph), null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(graph.name) || "process-graph"}.design_space.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Design space exported");
}

// Reads an envelope field by its snake_case wire key, with a camelCase
// fallback so files written by either exportEnvelope (snake_case) or a
// localStorage-shaped object (camelCase) both restore correctly.
function readEnvelopeField(env, snakeKey, camelKey, fallback) {
  if (env[snakeKey] !== undefined) return env[snakeKey];
  if (env[camelKey] !== undefined) return env[camelKey];
  return fallback;
}

async function importGraphFromFile(file, options = {}) {
  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn("Unable to read imported JSON file", error);
    toast("Could not read JSON file");
    return false;
  }

  // Accept either a full export envelope ({ graph, layout, ... }) or a bare
  // graph object ({ nodes, edges, ... }).
  const isEnvelope = parsed && typeof parsed === "object" && parsed.graph && typeof parsed.graph === "object";
  const env = isEnvelope ? parsed : { graph: parsed };
  const importedGraph = env.graph;

  if (!importedGraph || typeof importedGraph !== "object" || (!Array.isArray(importedGraph.nodes) && !Array.isArray(importedGraph.edges))) {
    toast("File does not contain a valid graph");
    return false;
  }

  graph = importedGraph;
  layout = (env.layout && typeof env.layout === "object") ? env.layout : {};
  selected = env.selected || selected;
  mutationLog = readEnvelopeField(env, "mutation_log", "mutationLog", []) || [];
  openQuestions = readEnvelopeField(env, "open_questions", "openQuestions", []) || [];
  const importedChat = readEnvelopeField(env, "chat_messages", "chatMessages", []);
  chatMessages = Array.isArray(importedChat) ? importedChat : [];
  const importedAllowCycles = readEnvelopeField(env, "allow_cycles", "allowCycles", undefined);
  if (importedAllowCycles !== undefined) {
    allowCycles = Boolean(importedAllowCycles);
  }
  const importedView = readEnvelopeField(env, "canvas_view", "canvasView", undefined);
  if (importedView) {
    canvasView = normalizeCanvasView(importedView);
  }

  // Clear transient plan/clarification state, mirroring loadState/resetGraph.
  pendingPlan = null;
  clarificationContext = null;
  undoStack = [];

  ensureGraphShape();
  // An imported graph carries its own saved_views; the prior activeViewId
  // (from a different graph) no longer applies.
  const importedViewId = readEnvelopeField(env, "active_view_id", "activeViewId", null);
  activeViewId = graph.saved_views.some((view) => view.id === importedViewId) ? importedViewId : null;
  const hadLayout = Object.keys(layout).length > 0;
  normalizeLayout();
  if (!hadLayout) {
    // No layout in the file: derive a hierarchical layout instead of the
    // plain grid fallback from normalizeLayout.
    autoLayoutGraph();
  }
  renderPlan();
  render();
  if (options.fileHandle) {
    updateCurrentFileHandle(options.fileHandle, file.name);
    toast(`Opened ${currentFileName || file.name || "JSON file"}`);
  } else if (options.clearFileHandle) {
    clearCurrentFileHandle();
    toast("Graph imported");
  } else {
    toast("Graph imported");
  }
  return true;
}

async function copyGraphJson() {
  const text = graphJsonText();
  try {
    await navigator.clipboard.writeText(text);
    toast("Graph JSON copied");
  } catch {
    toast("Clipboard unavailable");
  }
}

function resetGraph() {
  graph = clone(sampleGraph);
  layout = clone(sampleLayout);
  selected = { kind: "node", id: "n_machining" };
  pendingPlan = null;
  mutationLog = [];
  openQuestions = [];
  allowCycles = true;
  validateCurrentView = false;
  addNodeFormOpen = false;
  legendCollapsed = false;
  chatMessages = [];
  undoStack = [];
  clarificationContext = null;
  canvasView = { x: 0, y: 0, zoom: 1 };
  activeFilter = createEmptyFilter();
  activeViewId = null;
  renderPlan();
  render();
  toast("Sample graph restored");
}

function blankGraph() {
  return {
    id: "pg_untitled",
    name: "Untitled Process Graph",
    version: "0.1.0",
    description: "",
    modeling_style: graph.modeling_style || "none",
    nodes: [],
    edges: [],
    resources: [],
    constraints: [],
    assumptions: [],
    open_questions: [],
    chat_messages: [],
    versions: [],
    ontology: clone(DEFAULT_ONTOLOGY),
    metadata: { created_by: "user", created_at: new Date().toISOString(), tags: [] },
  };
}

function clearGraph() {
  if (!window.confirm("Clear the canvas? This removes all nodes, edges, and constraints from the current graph. Save it to the Library first if you want to keep it.")) {
    return;
  }
  graph = blankGraph();
  layout = {};
  selected = { kind: null, id: null };
  pendingPlan = null;
  mutationLog = [];
  openQuestions = [];
  chatMessages = [];
  undoStack = [];
  clarificationContext = null;
  canvasView = { x: 0, y: 0, zoom: 1 };
  activeFilter = createEmptyFilter();
  activeViewId = null;
  validateCurrentView = false;
  legendCollapsed = false;
  renderPlan();
  render();
  toast("Canvas cleared");
}

function createNode(payload) {
  const type = NODE_TYPES.includes(payload.type) ? payload.type : "task";
  const node = {
    id: payload.id || uniqueId(`n_${slug(payload.name || type)}`),
    name: payload.name || titleCase(type),
    type,
    inputs: Array.isArray(payload.inputs) ? payload.inputs : [],
    outputs: Array.isArray(payload.outputs) ? payload.outputs : [],
    resources_required: normalizeResourceRequirements(payload.resources_required || []),
    // DS-1: attribute values may be plain strings OR quantitative parameter objects.
    attributes: normalizePropertyStore(payload.attributes),
    description: typeof payload.description === "string" ? payload.description : "",
    description_status: normalizeNodeDescriptionStatus(payload.description_status, payload.description || ""),
    perspectives: normalizePerspectives(payload.perspectives),
    notes: payload.notes || "",
  };
  // DS-5: node variant tagging + adoption cost/time (optional).
  if (typeof payload.variant_of === "string" && payload.variant_of.trim()) {
    node.variant_of = payload.variant_of.trim();
    node.adoption = normalizeAdoption(payload.adoption);
  } else if (payload.adoption && typeof payload.adoption === "object") {
    node.adoption = normalizeAdoption(payload.adoption);
  }
  if (!node.description) {
    node.description = suggestNodeDescription(node, graph);
    node.description_status = "suggested";
  }
  return node;
}

function normalizeNodeDescriptionStatus(status, description = "") {
  if (NODE_DESCRIPTION_STATUSES.includes(status)) return status;
  return description ? "custom" : "empty";
}

function definitionStatusLabel(status) {
  return {
    empty: "No definition",
    suggested: "Suggested",
    custom: "Edited",
    approved: "Approved",
  }[status] || "No definition";
}

function suggestNodeDescription(node, targetGraph = graph) {
  const name = node.name || "This node";
  const type = NODE_TYPES.includes(node.type) ? node.type : "task";
  const inputs = (node.inputs || []).filter(Boolean);
  const outputs = (node.outputs || []).filter(Boolean);
  const resources = normalizeResourceRequirements(node.resources_required || [])
    .map((requirement) => requirement.name || requirement.resource_id)
    .filter(Boolean);
  const incoming = (targetGraph.edges || [])
    .filter((edge) => edge.to_node === node.id)
    .map((edge) => targetGraph.nodes.find((item) => item.id === edge.from_node)?.name || edge.from_node)
    .filter(Boolean);
  const outgoing = (targetGraph.edges || [])
    .filter((edge) => edge.from_node === node.id)
    .map((edge) => targetGraph.nodes.find((item) => item.id === edge.to_node)?.name || edge.to_node)
    .filter(Boolean);

  const inputText = inputs.length ? inputs.join(", ") : incoming.length ? `work from ${incoming.join(", ")}` : "incoming work or flow";
  const outputText = outputs.length ? outputs.join(", ") : outgoing.length ? `work for ${outgoing.join(", ")}` : "outgoing work or flow";

  let sentence = "";
  if (type === "source") {
    sentence = `${name} is the entry point where ${outputText} first enters the graph.`;
  } else if (type === "sink") {
    sentence = `${name} is the end point where ${inputText} leaves the graph or is considered complete.`;
  } else if (type === "decision") {
    sentence = `${name} is a decision point that checks ${inputText} and routes the next step based on clear conditions.`;
  } else {
    sentence = `${name} is a process step that takes ${inputText} and turns it into ${outputText}.`;
  }

  if (resources.length) {
    sentence += ` It may require ${resources.join(", ")}.`;
  }
  if (targetGraph.name) {
    sentence += ` Use this definition within ${targetGraph.name}.`;
  }
  return sentence.replace(/\s+/g, " ").trim();
}

function nodeDefinitionOntologyId(node) {
  return `node_definition_${slug(node.id || node.name)}`;
}

function syncNodeDefinitionToOntology(node, options = {}) {
  const settings = { force: false, ...options };
  if (!node?.description) return;
  const id = nodeDefinitionOntologyId(node);
  graph.ontology.properties = graph.ontology.properties || {};
  if (!settings.force && graph.ontology.properties[id]) return;
  graph.ontology.properties[id] = {
    ...(graph.ontology.properties[id] || {}),
    label: `${node.name} definition`,
    description: node.description,
    source_node_id: node.id,
  };
}

function removeNodeDefinitionFromOntology(node) {
  const id = nodeDefinitionOntologyId(node);
  const entry = graph.ontology?.properties?.[id];
  if (entry?.source_node_id === node.id) delete graph.ontology.properties[id];
}

function createEdge(payload) {
  const type = normalizeEdgeType(payload.type);
  const explicitFlows = Array.isArray(payload.flows) ? normalizeFlows(payload.flows) : [];
  const flows = explicitFlows.length || type !== "flow" ? explicitFlows : inferEdgeFlowsFromNodes(payload);
  const edge = {
    id: payload.id || uniqueId(`e_${slug(payload.from_node)}_${slug(payload.to_node)}`),
    from_node: payload.from_node,
    to_node: payload.to_node,
    type,
    condition: payload.condition || "",
    flows,
    resources_required: normalizeResourceRequirements(payload.resources_required || []),
    // DS-1: property values may be plain strings OR quantitative parameter objects.
    properties: normalizePropertyStore(payload.properties),
    perspectives: normalizePerspectives(payload.perspectives),
    description: typeof payload.description === "string" ? payload.description : "",
    description_status: normalizeDefinitionStatus(payload.description_status, payload.description || ""),
  };
  // DS-7: edge change-moves (reroutable / eliminable + cost/time), optional.
  const change = normalizeChange(payload.change);
  if (change) edge.change = change;
  return edge;
}

// A perspective is a labeled description block: { label, text }. snake_case on the wire.
function normalizePerspectives(perspectives) {
  return (Array.isArray(perspectives) ? perspectives : [])
    .map((perspective) => ({
      label: typeof perspective?.label === "string" ? perspective.label : "",
      text: typeof perspective?.text === "string" ? perspective.text : "",
    }))
    .filter((perspective) => perspective.label || perspective.text);
}

// Shared definition-status normalizer for edges/resources/constraints (mirrors node statuses).
function normalizeDefinitionStatus(status, description = "") {
  if (NODE_DESCRIPTION_STATUSES.includes(status)) return status;
  return description ? "custom" : "empty";
}

// --- Design-space element annotations (DS-1/5/6/7) -------------------------
// All additive/optional. A graph without these fields is unchanged.

const UNCERTAINTY_KINDS = ["range", "plus_minus", "confidence", "distribution"];
const VARIABLE_KINDS = ["range", "enum", "boolean"];

// DS-1 KEYSTONE. A property value is EITHER a plain string (default) OR a
// quantitative parameter object { value, unit, uncertainty?, variable? }.
// normalizePropertyValue keeps strings as strings and normalizes objects so
// object-valued attributes/properties survive load/save (never stringified).
function normalizePropertyValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return normalizeParameter(value);
  }
  return String(value ?? "");
}

function isParameterValue(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeParameter(param) {
  const source = param && typeof param === "object" ? param : {};
  const result = { value: source.value !== undefined && source.value !== null ? String(source.value) : "" };
  if (source.unit !== undefined && source.unit !== null && String(source.unit) !== "") {
    result.unit = String(source.unit);
  }
  const uncertainty = normalizeUncertainty(source.uncertainty);
  if (uncertainty) result.uncertainty = uncertainty;
  const variable = normalizeVariable(source.variable);
  if (variable) result.variable = variable;
  return result;
}

function normalizeUncertainty(unc) {
  if (!unc || typeof unc !== "object") return null;
  const kind = UNCERTAINTY_KINDS.includes(unc.kind) ? unc.kind : "range";
  const out = { kind };
  const num = (v) => (v !== undefined && v !== null && String(v) !== "" ? String(v) : undefined);
  if (kind === "range") {
    if (num(unc.low) !== undefined) out.low = num(unc.low);
    if (num(unc.high) !== undefined) out.high = num(unc.high);
  } else if (kind === "plus_minus") {
    if (num(unc.plus_minus) !== undefined) out.plus_minus = num(unc.plus_minus);
    if (unc.percent !== undefined) out.percent = Boolean(unc.percent);
  } else if (kind === "confidence") {
    if (num(unc.confidence) !== undefined) out.confidence = num(unc.confidence);
    if (num(unc.low) !== undefined) out.low = num(unc.low);
    if (num(unc.high) !== undefined) out.high = num(unc.high);
  } else if (kind === "distribution") {
    if (unc.distribution !== undefined && unc.distribution !== null && String(unc.distribution) !== "") {
      out.distribution = String(unc.distribution);
    }
    if (num(unc.mean) !== undefined) out.mean = num(unc.mean);
    if (num(unc.std) !== undefined) out.std = num(unc.std);
  }
  return out;
}

function normalizeVariable(variable) {
  if (!variable || typeof variable !== "object") return null;
  const kind = VARIABLE_KINDS.includes(variable.kind) ? variable.kind : "range";
  const out = { kind };
  const num = (v) => (v !== undefined && v !== null && String(v) !== "" ? String(v) : undefined);
  if (kind === "range") {
    if (num(variable.min) !== undefined) out.min = num(variable.min);
    if (num(variable.max) !== undefined) out.max = num(variable.max);
    if (num(variable.step) !== undefined) out.step = num(variable.step);
    if (variable.unit !== undefined && variable.unit !== null && String(variable.unit) !== "") out.unit = String(variable.unit);
  } else if (kind === "enum") {
    out.options = Array.isArray(variable.options)
      ? variable.options.map((opt) => String(opt)).filter((opt) => opt !== "")
      : [];
  }
  // boolean: nothing extra
  return out;
}

// Normalize a property store ({ key: string | parameter-object }), preserving
// object-valued parameters. Used by createNode/createEdge/ensureGraphShape.
function normalizePropertyStore(store) {
  if (!store || typeof store !== "object") return {};
  const out = {};
  Object.entries(store).forEach(([key, value]) => {
    out[key] = normalizePropertyValue(value);
  });
  return out;
}

// A small quantity { value, unit } (used by adoption cost/time, flow value/cost,
// edge change cost/time). Returns null when both are empty so we don't persist
// empty objects.
function normalizeQuantity(quantity) {
  if (!quantity || typeof quantity !== "object") return null;
  const value = quantity.value !== undefined && quantity.value !== null ? String(quantity.value) : "";
  const unit = quantity.unit !== undefined && quantity.unit !== null ? String(quantity.unit) : "";
  if (value === "" && unit === "") return null;
  const out = { value };
  if (unit !== "") out.unit = unit;
  return out;
}

// DS-5: node adoption cost/time for a variant. Always returns an object shape
// (cost/time present, possibly empty) so the editor inputs bind cleanly.
function normalizeAdoption(adoption) {
  const source = adoption && typeof adoption === "object" ? adoption : {};
  return {
    cost: normalizeQuantity(source.cost) || { value: "" },
    time: normalizeQuantity(source.time) || { value: "" },
  };
}

// DS-7: edge change-moves. Returns null when nothing meaningful is set.
function normalizeChange(change) {
  if (!change || typeof change !== "object") return null;
  const out = {
    reroutable: Boolean(change.reroutable),
    eliminable: Boolean(change.eliminable),
  };
  const cost = normalizeQuantity(change.cost);
  if (cost) out.cost = cost;
  const time = normalizeQuantity(change.time);
  if (time) out.time = time;
  if (typeof change.notes === "string" && change.notes.trim()) out.notes = change.notes;
  return out;
}

// --- Design space (DS-2 authoring + DS-3 build/export) ---------------------
// graph.design_space holds the AUTHORED set only: objectives, budgets, notes.
// Decision variables are DERIVED from element annotations at build time
// (buildDesignSpace) and are NOT stored here.

const OBJECTIVE_DIRECTIONS = ["max", "min"];
const OBJECTIVE_KINDS = ["objective", "hard_constraint", "soft_constraint"];

// DS-2: default/clean the authored design_space stored on the graph.
function normalizeDesignSpace(designSpace) {
  const source = designSpace && typeof designSpace === "object" ? designSpace : {};
  return {
    objectives: Array.isArray(source.objectives) ? source.objectives.map(normalizeObjective) : [],
    budgets: Array.isArray(source.budgets) ? source.budgets.map(normalizeBudget) : [],
    notes: typeof source.notes === "string" ? source.notes : "",
  };
}

function normalizeObjective(objective) {
  const source = objective && typeof objective === "object" ? objective : {};
  const out = { metric: typeof source.metric === "string" ? source.metric : "" };
  if (OBJECTIVE_DIRECTIONS.includes(source.direction)) out.direction = source.direction;
  out.kind = OBJECTIVE_KINDS.includes(source.kind) ? source.kind : "objective";
  if (typeof source.notes === "string" && source.notes.trim()) out.notes = source.notes;
  return out;
}

function normalizeBudget(budget) {
  const source = budget && typeof budget === "object" ? budget : {};
  const out = { metric: typeof source.metric === "string" ? source.metric : "" };
  const limit = normalizeQuantity(source.limit);
  out.limit = limit || { value: "" };
  if (typeof source.notes === "string" && source.notes.trim()) out.notes = source.notes;
  return out;
}

// DS-3: derive the decision variables from the graph annotations. NOT stored.
function buildDesignSpaceVariables(graph) {
  const variables = [];

  // parameter variables: any node attribute / edge property whose value is a
  // parameter object carrying a `.variable` decision domain.
  const collectParameters = (elementId, store) => {
    if (!store || typeof store !== "object") return;
    Object.entries(store).forEach(([key, value]) => {
      if (isParameterValue(value) && value.variable) {
        const ref = {
          kind: "parameter",
          target: `${elementId}.${key}`,
          domain: value.variable,
        };
        if (value.uncertainty) ref.uncertainty = value.uncertainty;
        variables.push(ref);
      }
    });
  };
  (graph.nodes || []).forEach((node) => collectParameters(node.id, node.attributes));
  (graph.edges || []).forEach((edge) => collectParameters(edge.id, edge.properties));

  // node_variant variables: group nodes by variant_of; each base with >=1 variant.
  const variantsByBase = new Map();
  (graph.nodes || []).forEach((node) => {
    if (typeof node.variant_of === "string" && node.variant_of) {
      if (!variantsByBase.has(node.variant_of)) variantsByBase.set(node.variant_of, []);
      variantsByBase.get(node.variant_of).push(node);
    }
  });
  variantsByBase.forEach((variantNodes, baseId) => {
    const ref = {
      kind: "node_variant",
      base: baseId,
      options: [baseId, ...variantNodes.map((node) => node.id)],
    };
    // Adoption: take the first variant carrying a meaningful adoption cost/time.
    const withAdoption = variantNodes.find((node) => {
      const cost = node.adoption?.cost;
      const time = node.adoption?.time;
      return (cost && cost.value !== "" && cost.value !== undefined) || (time && time.value !== "" && time.value !== undefined);
    });
    if (withAdoption) ref.adoption = withAdoption.adoption;
    variables.push(ref);
  });

  // flow_move variables: edges flagged reroutable and/or eliminable.
  (graph.edges || []).forEach((edge) => {
    const change = edge.change;
    if (!change || typeof change !== "object") return;
    const moves = [];
    if (change.reroutable) moves.push("reroute");
    if (change.eliminable) moves.push("eliminate");
    if (!moves.length) return;
    variables.push({ kind: "flow_move", target: edge.id, moves, change });
  });

  return variables;
}

// DS-3: assemble the full design_space handoff artifact.
function buildDesignSpace(graph) {
  const authored = normalizeDesignSpace(graph.design_space);
  const designSpace = {
    id: graph.id ? `ds-${graph.id}` : `ds-${slug(graph.name) || "design-space"}`,
    name: graph.name ? `${graph.name} design space` : "Design space",
    base_graph_id: graph.id || "",
    variables: buildDesignSpaceVariables(graph),
    objectives: authored.objectives,
    budgets: authored.budgets,
  };
  if (authored.notes && authored.notes.trim()) designSpace.notes = authored.notes;
  return designSpace;
}

// --- Design-space dialog (DS-2 authoring UI) -------------------------------

function openDesignSpaceDialog() {
  renderDesignSpaceDialog();
  showDialog(els.designSpaceDialog);
}

function closeDesignSpaceDialog() {
  hideDialog(els.designSpaceDialog);
}

function renderDesignSpaceDialog() {
  renderDesignSpaceVariables();
  renderDesignSpaceObjectives();
  renderDesignSpaceBudgets();
  if (els.designSpaceNotes) els.designSpaceNotes.value = graph.design_space.notes || "";
}

function describeDesignSpaceVariable(variable) {
  if (variable.kind === "parameter") {
    const domain = variable.domain || {};
    let domainText = domain.kind || "";
    if (domain.kind === "range") {
      const parts = [domain.min, domain.max].filter((v) => v !== undefined && v !== "");
      domainText = `range ${parts.join("–")}${domain.step ? ` step ${domain.step}` : ""}${domain.unit ? ` ${domain.unit}` : ""}`.trim();
    } else if (domain.kind === "enum") {
      domainText = `enum [${(domain.options || []).join(", ")}]`;
    } else if (domain.kind === "boolean") {
      domainText = "boolean";
    }
    return { tag: "parameter", target: variable.target, summary: domainText };
  }
  if (variable.kind === "node_variant") {
    return {
      tag: "node_variant",
      target: variable.base,
      summary: `${(variable.options || []).length} options (base + variants)`,
    };
  }
  if (variable.kind === "flow_move") {
    return { tag: "flow_move", target: variable.target, summary: (variable.moves || []).join(" / ") };
  }
  return { tag: variable.kind || "variable", target: "", summary: "" };
}

function renderDesignSpaceVariables() {
  if (!els.designSpaceVariables) return;
  const variables = buildDesignSpaceVariables(graph);
  if (!variables.length) {
    els.designSpaceVariables.innerHTML = `<div class="type-help">Mark a property variable, add a node variant, or flag an edge reroutable/eliminable to populate this.</div>`;
    return;
  }
  els.designSpaceVariables.innerHTML = variables
    .map((variable) => {
      const view = describeDesignSpaceVariable(variable);
      return (
        `<div class="ds-variable-row">` +
        `<span class="ds-variable-tag">${escapeHtml(view.tag)}</span>` +
        `<span class="ds-variable-target">${escapeHtml(view.target)}</span>` +
        `<span class="ds-variable-summary">${escapeHtml(view.summary)}</span>` +
        `</div>`
      );
    })
    .join("");
}

function objectiveDirectionOptions(selected) {
  return [
    `<option value="">—</option>`,
    ...OBJECTIVE_DIRECTIONS.map(
      (dir) => `<option value="${dir}"${selected === dir ? " selected" : ""}>${escapeHtml(dir)}</option>`
    ),
  ].join("");
}

function objectiveKindOptions(selected) {
  return OBJECTIVE_KINDS.map(
    (kind) => `<option value="${kind}"${selected === kind ? " selected" : ""}>${escapeHtml(titleCase(kind))}</option>`
  ).join("");
}

function renderDesignSpaceObjectives() {
  if (!els.designSpaceObjectives) return;
  const objectives = graph.design_space.objectives || [];
  const rows = objectives
    .map(
      (objective, index) => `
        <div class="ds-row" data-objective-index="${index}">
          <input type="text" class="ds-metric" data-objective-field="metric" value="${escapeAttribute(objective.metric || "")}" placeholder="margin_gain / feasibility / uncertainty / throughput / change_cost / change_time" aria-label="Objective metric" />
          <select class="ds-select" data-objective-field="direction" aria-label="Objective direction">${objectiveDirectionOptions(objective.direction)}</select>
          <select class="ds-select" data-objective-field="kind" aria-label="Objective kind">${objectiveKindOptions(objective.kind)}</select>
          <button class="icon-button danger" type="button" title="Remove objective" data-delete-objective="${index}">✕</button>
        </div>
      `
    )
    .join("");
  const addButton = `<button class="button secondary full" type="button" data-add-objective>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
      Add objective
    </button>`;
  els.designSpaceObjectives.innerHTML =
    (rows || `<div class="type-help">No objectives yet.</div>`) + addButton;
}

function renderDesignSpaceBudgets() {
  if (!els.designSpaceBudgets) return;
  const budgets = graph.design_space.budgets || [];
  const rows = budgets
    .map(
      (budget, index) => `
        <div class="ds-row" data-budget-index="${index}">
          <input type="text" class="ds-metric" data-budget-field="metric" value="${escapeAttribute(budget.metric || "")}" placeholder="change_cost / change_time" aria-label="Budget metric" />
          <input type="text" class="ds-limit-value" data-budget-field="limit_value" value="${escapeAttribute(budget.limit?.value ?? "")}" placeholder="limit" aria-label="Budget limit amount" />
          <input type="text" class="ds-limit-unit" data-budget-field="limit_unit" value="${escapeAttribute(budget.limit?.unit ?? "")}" placeholder="unit (e.g. USD, wk)" aria-label="Budget limit unit" />
          <button class="icon-button danger" type="button" title="Remove budget" data-delete-budget="${index}">✕</button>
        </div>
      `
    )
    .join("");
  const addButton = `<button class="button secondary full" type="button" data-add-budget>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
      Add budget
    </button>`;
  els.designSpaceBudgets.innerHTML =
    (rows || `<div class="type-help">No budgets yet.</div>`) + addButton;
}

// design_space is graph-level authoring/UI state, not a graph mutation: edit it
// directly then saveState() (mirrors how saved_views/ontology persist).
function handleDesignSpaceObjectiveInput(event) {
  const field = event.target.dataset.objectiveField;
  if (!field) return;
  const row = event.target.closest("[data-objective-index]");
  if (!row) return;
  const objective = graph.design_space.objectives[Number(row.dataset.objectiveIndex)];
  if (!objective) return;
  if (field === "metric") {
    objective.metric = event.target.value;
  } else if (field === "direction") {
    if (OBJECTIVE_DIRECTIONS.includes(event.target.value)) objective.direction = event.target.value;
    else delete objective.direction;
  } else if (field === "kind") {
    objective.kind = OBJECTIVE_KINDS.includes(event.target.value) ? event.target.value : "objective";
  }
  saveState();
  // Selects (change events) re-render to keep options in sync; text inputs do not.
  if (field !== "metric") renderDesignSpaceObjectives();
}

function handleDesignSpaceObjectiveClick(event) {
  if (event.target.closest("[data-add-objective]")) {
    graph.design_space.objectives.push(normalizeObjective({}));
    saveState();
    renderDesignSpaceObjectives();
    return;
  }
  const deleteButton = event.target.closest("[data-delete-objective]");
  if (!deleteButton) return;
  const index = Number(deleteButton.dataset.deleteObjective);
  if (Number.isNaN(index)) return;
  graph.design_space.objectives.splice(index, 1);
  saveState();
  renderDesignSpaceObjectives();
}

function handleDesignSpaceBudgetInput(event) {
  const field = event.target.dataset.budgetField;
  if (!field) return;
  const row = event.target.closest("[data-budget-index]");
  if (!row) return;
  const budget = graph.design_space.budgets[Number(row.dataset.budgetIndex)];
  if (!budget) return;
  if (field === "metric") {
    budget.metric = event.target.value;
  } else if (field === "limit_value") {
    budget.limit = budget.limit && typeof budget.limit === "object" ? budget.limit : { value: "" };
    budget.limit.value = event.target.value;
  } else if (field === "limit_unit") {
    budget.limit = budget.limit && typeof budget.limit === "object" ? budget.limit : { value: "" };
    if (event.target.value) budget.limit.unit = event.target.value;
    else delete budget.limit.unit;
  }
  saveState();
  // All budget fields are text inputs — patch in place, preserve focus.
}

function handleDesignSpaceBudgetClick(event) {
  if (event.target.closest("[data-add-budget]")) {
    graph.design_space.budgets.push(normalizeBudget({}));
    saveState();
    renderDesignSpaceBudgets();
    return;
  }
  const deleteButton = event.target.closest("[data-delete-budget]");
  if (!deleteButton) return;
  const index = Number(deleteButton.dataset.deleteBudget);
  if (Number.isNaN(index)) return;
  graph.design_space.budgets.splice(index, 1);
  saveState();
  renderDesignSpaceBudgets();
}

function handleDesignSpaceNotesInput(event) {
  graph.design_space.notes = event.target.value;
  saveState();
}

// Read the edge change-moves section's inputs into a normalized change object
// (or null when nothing meaningful is set).
function buildChangeFromInputs() {
  const read = (field) => els.inspectorContent.querySelector(`[data-edge-change-field="${field}"]`);
  const raw = {
    reroutable: read("reroutable")?.checked || false,
    eliminable: read("eliminable")?.checked || false,
    cost: { value: read("cost_value")?.value || "", unit: read("cost_unit")?.value || "" },
    time: { value: read("time_value")?.value || "", unit: read("time_unit")?.value || "" },
  };
  return normalizeChange(raw);
}

// Read the node variant adoption inputs into a normalized adoption object.
function buildAdoptionFromInputs() {
  const read = (field) => els.inspectorContent.querySelector(`[data-node-variant-field="${field}"]`);
  return normalizeAdoption({
    cost: { value: read("cost_value")?.value || "", unit: read("cost_unit")?.value || "" },
    time: { value: read("time_value")?.value || "", unit: read("time_unit")?.value || "" },
  });
}

// Set or clear a node's variant_of base (and default its adoption). Commits
// via applyMutation; caller re-renders.
function applyNodeVariantOf(node, baseId) {
  const trimmed = (baseId || "").trim();
  const payload = {};
  if (trimmed && trimmed !== node.id) {
    payload.variant_of = trimmed;
    payload.adoption = node.adoption && typeof node.adoption === "object" ? normalizeAdoption(node.adoption) : normalizeAdoption({});
  } else {
    payload.variant_of = "";
    payload.adoption = null;
  }
  applyMutation(
    {
      action: "update_node",
      target_id: node.id,
      payload,
      reason: "Inspector updated node variant base",
      confidence: "high",
    },
    { rerender: false, log: false }
  );
}

function createFlow(payload) {
  const kind = FLOW_KINDS.includes(payload.kind) ? payload.kind : inferFlowKind(payload.name || "");
  const flow = {
    id: payload.id || uniqueId(`f_${slug(payload.name || kind || "flow")}`),
    name: payload.name || "",
    kind,
    quantity: payload.quantity !== undefined ? String(payload.quantity) : "",
    unit: payload.unit || "",
    properties: payload.properties || {},
  };
  // DS-6: flow economics — value/cost as small quantities { value, unit }, optional.
  const value = normalizeQuantity(payload.value);
  if (value) flow.value = value;
  const cost = normalizeQuantity(payload.cost);
  if (cost) flow.cost = cost;
  return flow;
}

function createResource(payload) {
  return {
    id: payload.id || uniqueId(`r_${slug(payload.name || "resource")}`),
    name: payload.name || "Resource",
    type: RESOURCE_TYPES.includes(payload.type) ? payload.type : "human",
    attributes: payload.attributes || {},
    description: typeof payload.description === "string" ? payload.description : "",
    description_status: normalizeDefinitionStatus(payload.description_status, payload.description || ""),
  };
}

function createConstraint(payload) {
  return {
    id: payload.id || uniqueId(`c_${slug(payload.type || "constraint")}`),
    type: normalizeConstraintType(payload.type || "policy_rule"),
    // fields.target is the OWNER element id (the node/edge whose modal it lives in).
    // Set implicitly when added inside an element editor; no picker.
    fields: { target: payload.fields?.target || "" },
    expression: typeof payload.expression === "string" ? payload.expression : "",
    description: typeof payload.description === "string" ? payload.description : "",
    description_status: normalizeDefinitionStatus(payload.description_status, payload.description || ""),
  };
}

// Best-effort owner for a constraint with no/stale fields.target: the longest
// node name (then edge id) that appears in the constraint text.
function resolveConstraintOwnerFromText(text) {
  const haystack = (text || "").toLowerCase();
  if (!haystack) return "";
  const node = graph.nodes
    .slice()
    .sort((a, b) => (b.name || "").length - (a.name || "").length)
    .find((item) => item.name && haystack.includes(item.name.toLowerCase()));
  if (node) return node.id;
  const edge = graph.edges.find((item) => haystack.includes(item.id.toLowerCase()));
  return edge ? edge.id : "";
}

function normalizeResourceRequirements(requirements) {
  return (Array.isArray(requirements) ? requirements : []).map((requirement) => ({
    resource_id: requirement.resource_id || findResourceIdByName(requirement.name) || "",
    name: requirement.name || resourceName(requirement.resource_id) || "",
    quantity: requirement.quantity !== undefined ? String(requirement.quantity) : "",
  }));
}

function resourceName(resourceId) {
  return graph.resources.find((resource) => resource.id === resourceId)?.name || "";
}

function findResourceIdByName(name) {
  const normalized = slug(name);
  return graph.resources.find((resource) => slug(resource.name) === normalized)?.id || "";
}

function normalizeEdgeType(type) {
  const migrated = {
    sequence: "flow",
    conditional: "flow",
    parallel: "flow",
  }[type] || type;
  return EDGE_TYPES.includes(migrated) ? migrated : "flow";
}

function normalizeConstraintType(type) {
  const migrated =
    {
      capacity: "capability_limit",
      limit: "capability_limit",
      resource_binding: "capability_limit",
      resource_requirement: "capability_limit",
      precedence: "policy_rule",
    }[type] || type;
  return CONSTRAINT_TYPES.includes(migrated) ? migrated : "flow_balance";
}

function normalizeFlows(flows) {
  return (Array.isArray(flows) ? flows : [])
    .map((flow) => ({ raw: flow || {}, normalized: createFlow(flow || {}) }))
    .filter(({ raw, normalized }) => raw.name || raw.kind || raw.quantity || raw.unit || normalized.value || normalized.cost)
    .map(({ normalized }) => normalized);
}

function inferEdgeFlowsFromNodes(edgeLike) {
  const from = graph.nodes.find((node) => node.id === edgeLike.from_node);
  const to = graph.nodes.find((node) => node.id === edgeLike.to_node);
  const fromOutputs = from?.outputs || [];
  const toInputs = to?.inputs || [];
  const shared = fromOutputs.filter((output) => toInputs.some((input) => slug(input) === slug(output)));
  const names = dedupe(shared.length ? shared : fromOutputs).slice(0, 3);
  const prefix = slug(edgeLike.id || `${edgeLike.from_node}_${edgeLike.to_node}` || "edge");
  return names.map((name) => createFlow({ id: uniqueId(`f_${prefix}_${slug(name)}`), name, kind: inferFlowKind(name) }));
}

function inferFlowsFromText(message, fromName = "", toName = "") {
  const text = `${message} ${fromName} ${toName}`;
  const candidates = [];
  if (/\b(cash|money|payment|invoice|revenue|cost|budget|price|dollar|margin)\b/i.test(text)) {
    candidates.push(createFlow({ name: "cash", kind: "cash" }));
  }
  if (/\b(energy|electric|electricity|power|heat|fuel|steam|compressed air)\b/i.test(text)) {
    candidates.push(createFlow({ name: "energy", kind: "energy" }));
  }
  if (/\b(part|parts|material|component|inventory|product|scrap|unit)\b/i.test(text)) {
    candidates.push(createFlow({ name: "parts", kind: "parts" }));
  }
  if (/\b(data|record|file|measurement|table|model input|model output)\b/i.test(text)) {
    candidates.push(createFlow({ name: "data", kind: "data" }));
  }
  if (/\b(approval|approve|sign off|permission|authorization)\b/i.test(text)) {
    candidates.push(createFlow({ name: "approval", kind: "approval" }));
  }
  if (/\b(request|order|message|document|information|notice|signal|instruction)\b/i.test(text)) {
    candidates.push(createFlow({ name: "information", kind: "information" }));
  }
  return dedupe(candidates.map((flow) => flow.name)).map((name) => candidates.find((flow) => flow.name === name));
}

function inferFlowKind(text) {
  if (/\b(cash|money|payment|invoice|revenue|cost|budget|price|dollar|margin)\b/i.test(text)) return "cash";
  if (/\b(energy|electric|electricity|power|heat|fuel|steam|compressed air)\b/i.test(text)) return "energy";
  if (/\b(part|parts|material|component|inventory|product|scrap|unit)\b/i.test(text)) return "parts";
  if (/\b(data|record|file|measurement|table|model input|model output)\b/i.test(text)) return "data";
  if (/\b(approval|approve|sign off|permission|authorization)\b/i.test(text)) return "approval";
  if (/\b(request|order|message|document|information|notice|signal|instruction)\b/i.test(text)) return "information";
  if (/\b(work|job|case|task|effort|wip)\b/i.test(text)) return "work";
  return "work";
}

function edgeFlowLabel(edge) {
  const flows = normalizeFlows(edge.flows);
  if (!flows.length) return "";
  if (flows.length === 1) return flows[0].name || ontologyLabel("flow_types", flows[0].kind);
  return `${flows.length} flows`;
}

function edgeVisual(edge) {
  const flowKind = normalizeFlows(edge.flows)[0]?.kind || "";
  const style = graph.modeling_style || "none";
  const flowClass = flowKind ? `flow-${slug(flowKind)}` : "flow-unspecified";
  let color = "#718096";
  let width = 2.2;
  let dash = "";
  let marker = "arrow";

  if (edge.type === "dependency") dash = "8 5";
  if (edge.type === "feedback") {
    color = "#d98021";
    dash = "6 5";
    marker = "arrowOrange";
  }
  if (edge.type === "allocation") {
    color = "#168a55";
    width = 2.6;
    dash = "2 6"; // dotted line marks a resource being allocated into a task
    marker = "arrowGreen";
  }
  if (edge.type === "trigger") {
    color = "#2166d2";
    marker = "arrowBlue";
  }
  if (edge.type === "custom") {
    color = "#6f56b3";
    dash = "2 5";
    marker = "arrowPurple";
  }

  if (edge.type === "flow" && flowKind) {
    const flowColor = flowKindColor(flowKind);
    color = flowColor.color;
    marker = flowColor.marker;
  }

  if (style === "value_stream") {
    if (flowKind === "parts") {
      color = "#15181d";
      width = 3.4;
      marker = "arrowBlack";
    }
    if (["information", "data", "approval"].includes(flowKind)) {
      color = "#2166d2";
      dash = "9 6";
      width = 2.4;
      marker = "arrowBlue";
    }
  }

  if (style === "system_flow") {
    width = edge.type === "dependency" ? 2 : 2.6;
    if (edge.type === "dependency") dash = "7 5";
  }

  if (style === "team_topology") {
    if (edge.type === "allocation") {
      color = "#168a55";
      marker = "teamService";
      width = 3;
    } else if (edge.type === "feedback") {
      color = "#d98021";
      dash = "2 6";
      marker = "arrowOrange";
    } else if (edge.type === "dependency") {
      dash = "9 6";
    }
  }

  return {
    flowClass,
    marker,
    style: `stroke:${color};stroke-width:${width};${dash ? `stroke-dasharray:${dash};` : ""}`,
  };
}

function flowKindColor(kind) {
  if (kind === "cash") return { color: "#168a55", marker: "arrowGreen" };
  if (kind === "energy") return { color: "#d98021", marker: "arrowOrange" };
  if (kind === "approval") return { color: "#6f56b3", marker: "arrowPurple" };
  if (kind === "parts" || kind === "work") return { color: "#15181d", marker: "arrowBlack" };
  if (kind === "information" || kind === "data") return { color: "#2166d2", marker: "arrowBlue" };
  return { color: "#718096", marker: "arrow" };
}

function inferTeamShape(node) {
  const text = `${node.name || ""} ${node.description || ""}`.toLowerCase();
  if (/\b(platform|shared service|self service|self-service)\b/.test(text)) return "platform";
  if (/\b(enabling|enablement|coach|mentor|facilitat)\b/.test(text)) return "enabling";
  if (/\b(complicated|subsystem|specialist|expert|algorithm|model|solver)\b/.test(text)) return "complicated";
  return "stream";
}

// Migration-only: build a readable free-text statement from legacy structured
// constraint fields so pre-text-model constraints don't render blank. Not used by
// the editor — the textarea expression is the source of truth going forward.
function legacyConstraintText(constraint) {
  const fields = (constraint && constraint.fields) || {};
  const parts = [
    fields.target,
    fields.metric,
    fields.operator ? String(fields.operator).replace(/_/g, " ") : "",
    fields.value,
    fields.unit,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return parts.join(" ").trim();
}

function ontologyLabel(group, id) {
  return graph.ontology?.[group]?.[id]?.label || DEFAULT_ONTOLOGY[group]?.[id]?.label || titleCase(id);
}

function ontologyDescription(group, id) {
  return graph.ontology?.[group]?.[id]?.description || DEFAULT_ONTOLOGY[group]?.[id]?.description || "";
}

function extractSegments(message) {
  let normalized = message
    .replace(/\b(add|create|map|build|process|flow|step|steps|node|nodes)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const splitPattern = /\s*(?:->|=>|,|\bthen\b|\bnext\b|\bfollowed by\b|\bafter that\b|\bto\b)\s*/i;
  const parts = normalized
    .split(splitPattern)
    .map(cleanNodeName)
    .filter(Boolean);

  return dedupe(parts).slice(0, 12);
}

function cleanNodeName(value) {
  return titleCase(
    value
      .replace(/\b(source|sink|task|decision)\b[:\s-]*/gi, "")
      .replace(/\b(if|when)\s+/i, "")
      .replace(/[.;]+$/g, "")
      .trim()
  );
}

function inferNodeType(name, fullMessage, index = -1, total = -1) {
  const local = String(name || "").toLowerCase();
  const full = String(fullMessage || "").toLowerCase();
  if (
    /\b(source|start|trigger|intake|request enters|input)\b/i.test(name) ||
    (index === 0 && (full.includes(`source ${local}`) || /\bsource\b/i.test(fullMessage)))
  ) {
    return "source";
  }
  if (
    /\b(sink|end|closed|done|archive|output)\b/i.test(name) ||
    (index === total - 1 && (full.includes(`sink ${local}`) || /\bsink\b/i.test(fullMessage)))
  ) {
    return "sink";
  }
  if (
    /\b(decision|decide|check|approve|approval|whether|valid|complete)\b/i.test(name) ||
    /^(is|are|does|do|can|should|will|has|have)\b/i.test(name) ||
    name.includes("?") ||
    full.includes(`decision ${local}`)
  ) {
    return "decision";
  }
  return "task";
}

function inferEdgeType(message, fromName) {
  if (/\b(return|rework|revise|retry|loop back|feedback|clarification)\b/i.test(message)) return "feedback";
  if (/\b(assign|allocate|staff|resource|capacity|budget)\b/i.test(message)) return "allocation";
  if (/\b(trigger|signal|starts|start|initiates|kick off)\b/i.test(message)) return "trigger";
  if (/\b(depends|requires completion|must finish|waits for|needs)\b/i.test(message)) return "dependency";
  return "flow";
}

function inferCondition(message, fromName, toName) {
  const lower = message.toLowerCase();
  if (lower.includes("incomplete") && /clarification|missing|return/i.test(toName)) return "if incomplete";
  if (lower.includes("complete") && !/clarification|missing|return/i.test(toName)) return "if complete";
  if (/reject|fail|no/i.test(toName)) return "if no";
  if (/approve|pass|yes|complete/i.test(toName)) return "if yes";
  return "";
}

function findMissingValues(targetGraph) {
  const missing = [];
  targetGraph.nodes.forEach((node) => {
    if (!node.inputs.length && node.type !== "source") missing.push(`${node.id}.inputs`);
    if (!node.outputs.length && node.type !== "sink") missing.push(`${node.id}.outputs`);
  });
  targetGraph.edges.forEach((edge) => {
    if (edge.type === "flow" && !normalizeFlows(edge.flows).length) missing.push(`${edge.id}.flows`);
  });
  return missing;
}

function normalizeLayout() {
  graph.nodes.forEach((node, index) => {
    if (!layout[node.id]) {
      layout[node.id] = {
        x: 80 + (index % 5) * 205,
        y: 110 + Math.floor(index / 5) * 150,
      };
    }
  });
}

function autoLayoutGraph() {
  const incoming = countBy(graph.edges, "to_node");
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  graph.edges.forEach((edge) => {
    if (adjacency.has(edge.from_node)) adjacency.get(edge.from_node).push(edge.to_node);
  });

  const levels = new Map();
  const sources = graph.nodes.filter((node) => node.type === "source" || !incoming[node.id]);
  const queue = sources.map((node) => ({ id: node.id, level: 0 }));

  while (queue.length) {
    const current = queue.shift();
    if (levels.has(current.id)) continue;
    levels.set(current.id, current.level);
    (adjacency.get(current.id) || []).forEach((nextId) => {
      if (current.level < graph.nodes.length) queue.push({ id: nextId, level: current.level + 1 });
    });
  }

  graph.nodes.forEach((node) => {
    if (!levels.has(node.id)) levels.set(node.id, Math.max(0, levels.size % 5));
  });

  const columns = new Map();
  graph.nodes.forEach((node) => {
    const level = levels.get(node.id) || 0;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(node);
  });

  Array.from(columns.entries()).forEach(([level, nodes]) => {
    nodes.forEach((node, row) => {
      layout[node.id] = {
        x: 64 + level * 170,
        y: 96 + row * 126 + (node.type === "decision" ? -12 : 0),
      };
    });
  });
}

function layoutBounds(targetGraph = graph, targetLayout = layout) {
  return targetGraph.nodes.reduce(
    (acc, node) => {
      const pos = targetLayout[node.id] || { x: 0, y: 0 };
      const size = nodeSize(node);
      return {
        maxX: Math.max(acc.maxX, pos.x + size.w),
        maxY: Math.max(acc.maxY, pos.y + size.h),
      };
    },
    { maxX: 0, maxY: 0 }
  );
}

function graphWorldBounds(targetGraph = graph, targetLayout = layout) {
  if (!targetGraph.nodes.length) {
    return { minX: 0, minY: 0, maxX: 900, maxY: 560, w: 900, h: 560 };
  }
  const bounds = targetGraph.nodes.reduce(
    (acc, node) => {
      const pos = targetLayout[node.id] || { x: 0, y: 0 };
      const size = nodeSize(node);
      return {
        minX: Math.min(acc.minX, pos.x),
        minY: Math.min(acc.minY, pos.y),
        maxX: Math.max(acc.maxX, pos.x + size.w),
        maxY: Math.max(acc.maxY, pos.y + size.h),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
  return {
    ...bounds,
    w: Math.max(1, bounds.maxX - bounds.minX),
    h: Math.max(1, bounds.maxY - bounds.minY),
  };
}

function paddedWorldBounds(bounds, padding = 90) {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  };
}

function visibleGraphRect() {
  const size = canvasViewportSize();
  const view = normalizeCanvasView(canvasView);
  return {
    minX: -view.x / view.zoom,
    minY: -view.y / view.zoom,
    w: size.w / view.zoom,
    h: size.h / view.zoom,
  };
}

function mergeBounds(...bounds) {
  return bounds.reduce(
    (acc, item) => ({
      maxX: Math.max(acc.maxX, item.maxX || 0),
      maxY: Math.max(acc.maxY, item.maxY || 0),
    }),
    { maxX: 0, maxY: 0 }
  );
}

function nextLayoutPoint() {
  const index = graph.nodes.length;
  return {
    x: 100 + (index % 5) * 200,
    y: 120 + Math.floor(index / 5) * 155,
  };
}

function nodeSize(node) {
  return node.type === "decision" ? { w: 144, h: 104 } : { w: 154, h: 74 };
}

function nodeColor(type) {
  if (type === "source") return "#168a55";
  if (type === "sink") return "#15181d";
  if (type === "decision") return "#d98021";
  if (type === "resource") return "#0f9b9b";
  return "#2166d2";
}

function connectionPoint(edge, node, otherNode, direction) {
  const pos = layout[node.id];
  const size = nodeSize(node);
  const edgeSet = direction === "out"
    ? graph.edges.filter((item) => item.from_node === node.id)
    : graph.edges.filter((item) => item.to_node === node.id);
  const index = Math.max(0, edgeSet.findIndex((item) => item.id === edge.id));
  const count = Math.max(nodePortCount(node, direction), edgeSet.length, 1);
  const point = localPortPoint(node, size, direction, index, count);
  return { x: pos.x + point.x, y: pos.y + point.y };
}

function nodePortCount(node, direction) {
  const edgeCount =
    direction === "out"
      ? graph.edges.filter((edge) => edge.from_node === node.id).length
      : graph.edges.filter((edge) => edge.to_node === node.id).length;
  const ioCount = direction === "out" ? (node.outputs || []).length : (node.inputs || []).length;
  if (node.type === "source" && direction === "in") return Math.max(edgeCount, 0);
  if (node.type === "sink" && direction === "out") return Math.max(edgeCount, 0);
  return Math.max(edgeCount, ioCount, 1);
}

function localPortPoint(node, size, direction, index, count) {
  if ((graph.modeling_style || "none") === "business_process" && (node.type === "source" || node.type === "sink")) {
    const rx = size.w / 2 - 9;
    const ry = size.h / 2 - 8;
    const spread = count > 1 ? ((index + 1) / (count + 1) - 0.5) * 1.4 : 0;
    return {
      x: direction === "in" ? size.w / 2 - rx : size.w / 2 + rx,
      y: size.h / 2 + spread * ry,
    };
  }
  const y = ((index + 1) / (count + 1)) * size.h;
  if (node.type === "decision") {
    if (direction === "in") return { x: 9, y };
    return { x: size.w - 9, y };
  }
  return direction === "in" ? { x: 0, y } : { x: size.w, y };
}

function nodeOptions(selectedId) {
  return graph.nodes.map((node) => option(node.id, selectedId, node.name)).join("");
}

function option(value, selectedValue, label = value) {
  return `<option value="${escapeAttribute(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function svgPoint(event) {
  const svg = els.graphCanvas;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function canvasPoint(event) {
  const point = svgPoint(event);
  return screenPointToGraph(point);
}

function screenPointToGraph(point) {
  const view = normalizeCanvasView(canvasView);
  return {
    x: (point.x - view.x) / view.zoom,
    y: (point.y - view.y) / view.zoom,
  };
}

function graphPointToScreen(point) {
  const view = normalizeCanvasView(canvasView);
  return {
    x: point.x * view.zoom + view.x,
    y: point.y * view.zoom + view.y,
  };
}

function canvasViewportSize() {
  return {
    w: Math.max(900, els.graphCanvas?.clientWidth || 900),
    h: Math.max(560, els.graphCanvas?.clientHeight || 560),
  };
}

function canvasViewportCenter() {
  const size = canvasViewportSize();
  return { x: size.w / 2, y: size.h / 2 };
}

function normalizeCanvasView(view) {
  return {
    x: Number.isFinite(view?.x) ? view.x : 0,
    y: Number.isFinite(view?.y) ? view.y : 0,
    zoom: clamp(Number.isFinite(view?.zoom) ? view.zoom : 1, 0.3, 2.8),
  };
}

function handleCanvasWheel(event) {
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.001);
  setCanvasZoom(canvasView.zoom * factor, svgPoint(event));
}

function zoomCanvasBy(factor) {
  setCanvasZoom(canvasView.zoom * factor, canvasViewportCenter());
}

function setCanvasZoom(nextZoom, centerPoint) {
  const center = centerPoint || canvasViewportCenter();
  const before = screenPointToGraph(center);
  const zoom = clamp(nextZoom, 0.3, 2.8);
  canvasView = normalizeCanvasView({
    zoom,
    x: center.x - before.x * zoom,
    y: center.y - before.y * zoom,
  });
  renderCanvas();
  updateStatus();
  saveState();
}

function fitCanvasToGraph() {
  const bounds = paddedWorldBounds(graphWorldBounds());
  const viewport = canvasViewportSize();
  const zoom = clamp(Math.min((viewport.w - 64) / bounds.w, (viewport.h - 64) / bounds.h), 0.3, 2.8);
  canvasView = normalizeCanvasView({
    zoom,
    x: (viewport.w - bounds.w * zoom) / 2 - bounds.minX * zoom,
    y: (viewport.h - bounds.h * zoom) / 2 - bounds.minY * zoom,
  });
  renderCanvas();
  updateStatus();
  saveState();
}

function resetCanvasView() {
  canvasView = { x: 0, y: 0, zoom: 1 };
  renderCanvas();
  updateStatus();
  saveState();
}

function handleMinimapPointerDown(event) {
  const svg = event.target.closest("svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const minX = Number(svg.dataset.minimapMinX || 0);
  const minY = Number(svg.dataset.minimapMinY || 0);
  const scale = Number(svg.dataset.minimapScale || 1);
  const offsetX = Number(svg.dataset.minimapOffsetX || 0);
  const offsetY = Number(svg.dataset.minimapOffsetY || 0);
  const viewBoxW = 180;
  const viewBoxH = 120;
  const localX = ((event.clientX - rect.left) / rect.width) * viewBoxW;
  const localY = ((event.clientY - rect.top) / rect.height) * viewBoxH;
  const graphPoint = {
    x: minX + (localX - offsetX) / scale,
    y: minY + (localY - offsetY) / scale,
  };
  const center = canvasViewportCenter();
  canvasView = normalizeCanvasView({
    ...canvasView,
    x: center.x - graphPoint.x * canvasView.zoom,
    y: center.y - graphPoint.y * canvasView.zoom,
  });
  renderCanvas();
  updateStatus();
  saveState();
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

function findNodeByName(name) {
  const normalized = slug(name);
  return graph.nodes.find((node) => slug(node.name) === normalized);
}

function splitCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueId(base) {
  const clean = slug(base || "id");
  const existing = new Set([
    ...graph.nodes.map((item) => item.id),
    ...graph.edges.map((item) => item.id),
    ...graph.edges.flatMap((edge) => (Array.isArray(edge.flows) ? edge.flows.map((flow) => flow.id).filter(Boolean) : [])),
    ...graph.resources.map((item) => item.id),
    ...graph.constraints.map((item) => item.id),
    ...graph.assumptions.map((item) => item.id),
  ]);
  if (!existing.has(clean)) return clean;
  let index = 2;
  while (existing.has(`${clean}_${index}`)) index += 1;
  return `${clean}_${index}`;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 58);
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function truncate(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function dedupe(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = slug(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
}
