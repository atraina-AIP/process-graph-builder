"use strict";

const STORAGE_KEY = "process-graph-builder-state-v1";
const API_BASE_STORAGE_KEY = "process-graph-builder-api-base";

const MODELING_STYLES = ["none", "business_process", "value_stream", "system_flow", "team_topology", "custom"];
const NODE_TYPES = ["source", "sink", "task", "decision"];
const NODE_DESCRIPTION_STATUSES = ["empty", "suggested", "custom", "approved"];
const EDGE_TYPES = ["flow", "dependency", "trigger", "feedback", "allocation", "custom"];
const FLOW_KINDS = ["parts", "cash", "energy", "information", "data", "work", "approval", "custom"];
const RESOURCE_TYPES = ["human", "machine", "material"];
const CONSTRAINT_TYPES = ["flow_balance", "capability_limit", "timing", "routing_rule", "policy_rule"];
const CONSTRAINT_OPERATORS = [
  "equals",
  "at_most",
  "at_least",
  "requires",
  "routes_to",
  "allowed_when",
  "blocked_when",
  "lasts",
  "custom",
];
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

const CONSTRAINT_TEMPLATES = {
  flow_balance: {
    metric: "incoming and outgoing flow",
    operator: "equals",
    value: "",
    unit: "",
    notes: "Account for transformation, accumulation, loss, scrap, waste, or storage.",
  },
  capability_limit: {
    metric: "resource or capacity",
    operator: "requires",
    value: "",
    unit: "",
    notes: "Describe what this node needs and what it can handle.",
  },
  timing: {
    metric: "duration",
    operator: "lasts",
    value: "",
    unit: "",
    notes: "Describe how long this node or movement takes.",
  },
  routing_rule: {
    metric: "branch",
    operator: "routes_to",
    value: "",
    unit: "",
    notes: "Describe when flow goes one way instead of another.",
  },
  policy_rule: {
    metric: "rule",
    operator: "allowed_when",
    value: "",
    unit: "",
    notes: "Describe what is allowed, blocked, or required.",
  },
};

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
- add_question`;

const sampleGraph = {
  id: "pg-intake-to-close",
  name: "Intake to Close",
  version: "0.1.0",
  description: "Decision-grade process graph for intake, validation, routing, and closure.",
  modeling_style: "none",
  nodes: [
    {
      id: "n_customer_request",
      name: "Customer request",
      type: "source",
      inputs: [],
      outputs: ["request"],
      resources_required: [],
      attributes: {},
      notes: "External demand enters the process.",
    },
    {
      id: "n_validate_request",
      name: "Validate request",
      type: "task",
      inputs: ["request"],
      outputs: ["validated request"],
      resources_required: [{ resource_id: "r_coordinator", name: "Process coordinator", quantity: "1" }],
      attributes: {},
      notes: "Review request completeness before routing.",
    },
    {
      id: "n_request_complete",
      name: "Is request complete",
      type: "decision",
      inputs: ["validated request"],
      outputs: ["complete request", "incomplete request"],
      resources_required: [{ resource_id: "r_coordinator", name: "Process coordinator", quantity: "1" }],
      attributes: {},
      notes: "Decision node should have at least two outgoing branches.",
    },
    {
      id: "n_route_work",
      name: "Route work",
      type: "task",
      inputs: ["complete request"],
      outputs: ["routed work"],
      resources_required: [{ resource_id: "r_coordinator", name: "Process coordinator", quantity: "1" }],
      attributes: {},
      notes: "Assign routed work to the correct owner.",
    },
    {
      id: "n_request_clarification",
      name: "Request clarification",
      type: "task",
      inputs: ["incomplete request"],
      outputs: ["clarification request"],
      resources_required: [{ resource_id: "r_coordinator", name: "Process coordinator", quantity: "1" }],
      attributes: {},
      notes: "Clarify missing information before returning to validation.",
    },
    {
      id: "n_closed",
      name: "Closed",
      type: "sink",
      inputs: ["routed work"],
      outputs: [],
      resources_required: [],
      attributes: {},
      notes: "Terminal state for the MVP sample process.",
    },
  ],
  edges: [
    {
      id: "e_customer_request_validate_request",
      from_node: "n_customer_request",
      to_node: "n_validate_request",
      type: "flow",
      condition: "",
      flows: [{ id: "f_customer_request", name: "request", kind: "information", quantity: "", unit: "", properties: {} }],
    },
    {
      id: "e_validate_request_request_complete",
      from_node: "n_validate_request",
      to_node: "n_request_complete",
      type: "flow",
      condition: "",
      flows: [{ id: "f_validated_request", name: "validated request", kind: "information", quantity: "", unit: "", properties: {} }],
    },
    {
      id: "e_request_complete_route_work",
      from_node: "n_request_complete",
      to_node: "n_route_work",
      type: "flow",
      condition: "if complete",
      flows: [{ id: "f_complete_request", name: "complete request", kind: "information", quantity: "", unit: "", properties: {} }],
    },
    {
      id: "e_request_complete_request_clarification",
      from_node: "n_request_complete",
      to_node: "n_request_clarification",
      type: "flow",
      condition: "if incomplete",
      flows: [{ id: "f_incomplete_request", name: "incomplete request", kind: "information", quantity: "", unit: "", properties: {} }],
    },
    {
      id: "e_request_clarification_validate_request",
      from_node: "n_request_clarification",
      to_node: "n_validate_request",
      type: "feedback",
      condition: "",
      flows: [{ id: "f_clarification_request", name: "clarification request", kind: "information", quantity: "", unit: "", properties: {} }],
    },
    {
      id: "e_route_work_closed",
      from_node: "n_route_work",
      to_node: "n_closed",
      type: "flow",
      condition: "",
      flows: [{ id: "f_routed_work", name: "routed work", kind: "work", quantity: "", unit: "", properties: {} }],
    },
  ],
  resources: [
    {
      id: "r_coordinator",
      name: "Process coordinator",
      type: "human",
      attributes: {},
    },
  ],
  constraints: [
    {
      id: "c_request_completion_balance",
      type: "flow_balance",
      fields: {
        target: "Is request complete",
        metric: "request",
        operator: "equals",
        value: "complete request or incomplete request",
        unit: "",
        notes: "The decision accounts for each validated request as complete or incomplete.",
      },
      expression: "",
    },
    {
      id: "c_request_route_rule",
      type: "routing_rule",
      fields: {
        target: "Is request complete",
        metric: "branch",
        operator: "routes_to",
        value: "complete request to Route work; incomplete request to Request clarification",
        unit: "",
        notes: "Branching is represented by conditioned outgoing edges.",
      },
      expression: "",
    },
    {
      id: "c_validate_capability",
      type: "capability_limit",
      fields: {
        target: "Validate request",
        metric: "Process coordinator",
        operator: "requires",
        value: "1",
        unit: "person",
        notes: "Validation needs one coordinator resource.",
      },
      expression: "",
    },
  ],
  assumptions: [
    {
      id: "a_request_return_loop",
      text: "Incomplete requests return to validation after clarification.",
    },
  ],
  metadata: {
    created_by: "Codex MVP",
    created_at: "2026-05-05T00:00:00.000Z",
    tags: ["mvp", "decision-grade", "process-graph"],
  },
  ontology: clone(DEFAULT_ONTOLOGY),
};

const sampleLayout = {
  n_customer_request: { x: 80, y: 180 },
  n_validate_request: { x: 290, y: 180 },
  n_request_complete: { x: 515, y: 178 },
  n_route_work: { x: 760, y: 105 },
  n_request_clarification: { x: 760, y: 275 },
  n_closed: { x: 980, y: 105 },
};

let graph = clone(sampleGraph);
let layout = clone(sampleLayout);
let selected = { kind: "node", id: "n_request_complete" };
let pendingPlan = null;
let mutationLog = [];
let openQuestions = [];
let allowCycles = true;
let dragState = null;
let connectState = null;
let panState = null;
let toastTimer = null;
let activeInspectorTab = "inspect";
let addNodeFormOpen = false;
let addEdgeFormOpen = false;
let resourcesOpen = false;
let constraintsOpen = false;
let leftPanelCollapsed = false;
let rightPanelCollapsed = false;
let chatMessages = [];
let undoStack = [];
let clarificationContext = null;
let canvasView = { x: 0, y: 0, zoom: 1 };

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  loadState();
  bindEvents();
  render();
});

function bindElements() {
  [
    "resetGraphButton",
    "autoLayoutButton",
    "copyJsonButton",
    "exportJsonButton",
    "exportMarkdownButton",
    "workspace",
    "leftPanel",
    "rightPanel",
    "toggleLeftPanelButton",
    "toggleRightPanelButton",
    "chatInput",
    "sendInstructionButton",
    "planMutationsButton",
    "applyPlanButton",
    "discardPlanButton",
    "undoButton",
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
    "inspectorSubhead",
    "edgeFromSelect",
    "edgeToSelect",
    "edgeTypeSelect",
    "edgeTypeHelp",
    "edgeConditionInput",
    "edgeFlowNameInput",
    "edgeFlowKindSelect",
    "edgeFlowKindHelp",
    "toggleAddEdgeButton",
    "edgeBuilderBody",
    "addEdgeButton",
    "zoomOutButton",
    "zoomLevelLabel",
    "zoomInButton",
    "fitCanvasButton",
    "resetViewButton",
    "notationLegend",
    "canvasMinimap",
    "validationList",
    "readinessBadge",
    "allowCyclesInput",
    "resourceList",
    "resourceCount",
    "toggleResourcesButton",
    "constraintList",
    "constraintCount",
    "toggleConstraintsButton",
    "addResourceButton",
    "addConstraintButton",
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

  document.querySelectorAll("[data-add-node]").forEach((button) => {
    button.addEventListener("click", () => addNodeFromToolbar(button.dataset.addNode));
  });

  document.querySelectorAll("[data-inspector-tab]").forEach((button) => {
    button.addEventListener("click", () => switchInspectorTab(button.dataset.inspectorTab));
  });

  els.planMutationsButton.addEventListener("click", planFromInstruction);
  els.sendInstructionButton.addEventListener("click", planFromInstruction);
  els.chatInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      planFromInstruction();
    }
  });

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
  els.toggleRightPanelButton.addEventListener("click", () => {
    toggleRightPanel();
  });

  els.edgeTypeSelect.addEventListener("change", renderEdgeTypeHelp);
  els.edgeFlowKindSelect.addEventListener("change", renderEdgeFlowKindHelp);
  els.modelingStyleOptions.addEventListener("change", handleModelingStyleChange);
  els.toggleAddEdgeButton.addEventListener("click", () => {
    addEdgeFormOpen = !addEdgeFormOpen;
    renderEdgeBuilder();
    saveState();
  });
  els.addEdgeButton.addEventListener("click", addEdgeFromInspector);
  els.addResourceButton.addEventListener("click", addResource);
  els.addConstraintButton.addEventListener("click", addConstraint);
  els.toggleResourcesButton.addEventListener("click", () => {
    resourcesOpen = !resourcesOpen;
    renderResources();
    saveState();
  });
  els.toggleConstraintsButton.addEventListener("click", () => {
    constraintsOpen = !constraintsOpen;
    renderConstraints();
    saveState();
  });
  els.autoLayoutButton.addEventListener("click", () => {
    autoLayoutGraph();
    render();
    toast("Graph laid out");
  });
  els.exportMarkdownButton.addEventListener("click", downloadMarkdown);
  els.exportJsonButton.addEventListener("click", downloadGraphJson);
  els.copyJsonButton.addEventListener("click", copyGraphJson);
  els.resetGraphButton.addEventListener("click", resetGraph);
  els.allowCyclesInput.addEventListener("change", () => {
    allowCycles = els.allowCyclesInput.checked;
    renderValidation();
    saveState();
  });

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
  els.canvasMinimap.addEventListener("pointerdown", handleMinimapPointerDown);

  els.inspectorContent.addEventListener("input", handleInspectorInput);
  els.inspectorContent.addEventListener("change", handleInspectorInput);
  els.inspectorContent.addEventListener("click", handleInspectorClick);
  els.resourceList.addEventListener("input", handleResourceInput);
  els.resourceList.addEventListener("change", handleResourceInput);
  els.constraintList.addEventListener("input", handleConstraintInput);
  els.constraintList.addEventListener("change", handleConstraintInput);
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

function switchInspectorTab(tabName) {
  activeInspectorTab = tabName;
  document.querySelectorAll("[data-inspector-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.inspectorTab === tabName);
  });
  ["inspect", "ontology"].forEach((name) => {
    const view = document.getElementById(`${name}View`);
    view.classList.toggle("is-active", name === tabName);
  });
  if (tabName === "ontology") renderOntology();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || !saved.graph) return;
    graph = saved.graph;
    layout = saved.layout || {};
    selected = saved.selected || selected;
    mutationLog = saved.mutationLog || [];
    openQuestions = saved.openQuestions || [];
    allowCycles = saved.allowCycles !== undefined ? Boolean(saved.allowCycles) : true;
    addNodeFormOpen = Boolean(saved.addNodeFormOpen);
    addEdgeFormOpen = Boolean(saved.addEdgeFormOpen);
    resourcesOpen = Boolean(saved.resourcesOpen);
    constraintsOpen = Boolean(saved.constraintsOpen);
    leftPanelCollapsed = Boolean(saved.leftPanelCollapsed);
    rightPanelCollapsed = Boolean(saved.rightPanelCollapsed);
    chatMessages = Array.isArray(saved.chatMessages) ? saved.chatMessages : [];
    undoStack = Array.isArray(saved.undoStack) ? saved.undoStack : [];
    clarificationContext = saved.clarificationContext || null;
    canvasView = normalizeCanvasView(saved.canvasView || canvasView);
    ensureGraphShape();
    normalizeLayout();
  } catch (error) {
    console.warn("Unable to load saved graph", error);
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      graph,
      layout,
      selected,
      mutationLog,
      openQuestions,
      allowCycles,
      addNodeFormOpen,
      addEdgeFormOpen,
      resourcesOpen,
      constraintsOpen,
      leftPanelCollapsed,
      rightPanelCollapsed,
      chatMessages,
      undoStack,
      clarificationContext,
      canvasView,
    })
  );
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

  graph.nodes.forEach((node) => {
    node.inputs = Array.isArray(node.inputs) ? node.inputs : [];
    node.outputs = Array.isArray(node.outputs) ? node.outputs : [];
    node.resources_required = normalizeResourceRequirements(node.resources_required || []);
    node.attributes = node.attributes || {};
    node.description = typeof node.description === "string" ? node.description : "";
    node.description_status = normalizeNodeDescriptionStatus(node.description_status, node.description);
    if (!node.description) {
      node.description = suggestNodeDescription(node, graph);
      node.description_status = "suggested";
    }
  });

  graph.resources.forEach((resource) => {
    resource.attributes = resource.attributes || {};
  });

  graph.edges = graph.edges.map((edge) => createEdge(edge));

  graph.constraints = graph.constraints.map((constraint) => {
    const next = createConstraint(constraint);
    if (!next.fields.target) next.fields.target = inferConstraintTarget(next);
    next.expression = constraintExpression(next);
    return next;
  });

  inferOntologyFromGraph({ silent: true });
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
  renderChatMessages();
  renderCanvas();
  renderNotationLegend();
  renderMinimap();
  updateCanvasControls();
  renderInspector();
  renderEdgeBuilder();
  renderEdgeTypeHelp();
  renderEdgeFlowKindHelp();
  renderValidation();
  renderResources();
  renderConstraints();
  renderOntology();
  renderLog();
  renderUndoState();
  updateStatus();
  saveState();
}

function renderPlan() {
  els.applyPlanButton.disabled = !pendingPlan || pendingPlan.mutations.length === 0;
  els.discardPlanButton.disabled = !pendingPlan;
  els.planStatus.textContent = pendingPlan ? `${pendingPlan.mutations.length} mutations pending` : "No pending plan";
  els.planPreview.textContent = JSON.stringify(pendingPlan || {}, null, 2);
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

async function requestBackendAssist(message) {
  const base = apiBase();
  if (!base || clarificationContext?.plan?.questions?.length) return null;
  try {
    const response = await fetch(`${base}/graph/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph_id: graph.id, user_message: message }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function syncBackendMutations(mutations) {
  const base = apiBase();
  if (!base || !mutations.length) return;
  try {
    await fetch(`${base}/graph/mutate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph_id: graph.id, mutations }),
    });
  } catch {
    // Local authoring remains the source of truth when backend sync is unavailable.
  }
}

function apiBase() {
  return (localStorage.getItem(API_BASE_STORAGE_KEY) || window.PROCESS_GRAPH_API_BASE || "").replace(/\/+$/, "");
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
  els.workspace.classList.toggle("right-collapsed", rightPanelCollapsed);
  els.leftPanel.classList.toggle("is-collapsed", leftPanelCollapsed);
  els.rightPanel.classList.toggle("is-collapsed", rightPanelCollapsed);
  els.toggleLeftPanelButton.setAttribute("aria-expanded", String(!leftPanelCollapsed));
  els.toggleRightPanelButton.setAttribute("aria-expanded", String(!rightPanelCollapsed));
  els.toggleLeftPanelButton.title = leftPanelCollapsed ? "Expand left panel" : "Collapse left panel";
  els.toggleRightPanelButton.title = rightPanelCollapsed ? "Expand right panel" : "Collapse right panel";
  els.toggleLeftPanelButton.setAttribute("aria-label", leftPanelCollapsed ? "Expand left menu" : "Collapse left menu");
  els.toggleRightPanelButton.setAttribute("aria-label", rightPanelCollapsed ? "Expand right inspector" : "Collapse right inspector");
  els.toggleLeftPanelButton.innerHTML = leftPanelCollapsed
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>`;
  els.toggleRightPanelButton.innerHTML = rightPanelCollapsed
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>`;
}

function toggleRightPanel() {
  rightPanelCollapsed = !rightPanelCollapsed;
  renderPanelCollapse();
  requestAnimationFrame(() => {
    renderCanvas();
    renderMinimap();
  });
  saveState();
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

  els.notationLegend.innerHTML = `
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
  `;
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
      ${options.preview ? "" : `<path class="edge-hit" d="${path}" data-edge-id="${edge.id}" />`}
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

function renderInspector() {
  if (!selected.kind || !selected.id) {
    els.inspectorSubhead.textContent = "No canvas object selected";
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
    els.inspectorSubhead.textContent = edge.id;
    const flowRows = renderEdgeFlowEditor(edge);
    els.inspectorContent.innerHTML = `
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
      <div class="field">
        <div class="section-title">
          <span>Flows Carried</span>
          <button class="icon-button" type="button" title="Add edge flow" data-add-edge-flow>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          </button>
        </div>
        <div class="list-editor">${flowRows}</div>
      </div>
      <button class="button secondary full" type="button" data-delete-edge="${edge.id}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
        Delete Edge
      </button>
    `;
    return;
  }

  const node = graph.nodes.find((item) => item.id === selected.id) || graph.nodes[0];
  if (!node) {
    els.inspectorSubhead.textContent = "No object selected";
    els.inspectorContent.innerHTML = renderEmptyInspector();
    return;
  }

  selected = { kind: "node", id: node.id };
  els.inspectorSubhead.textContent = node.id;
  const inputRows = renderStringListEditor("inputs", node.inputs);
  const outputRows = renderStringListEditor("outputs", node.outputs);
  const resourceRows = renderResourceRequirementEditor(node);
  const definitionStatus = normalizeNodeDescriptionStatus(node.description_status, node.description);
  const definitionApproved = definitionStatus === "approved";

  els.inspectorContent.innerHTML = `
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
    <label class="field">
      <span>Notes</span>
      <textarea rows="4" data-node-field="notes">${escapeHtml(node.notes || "")}</textarea>
    </label>
    <div class="field">
      <div class="section-title">
        <span>Resources Required</span>
        <button class="icon-button" type="button" title="Add resource requirement" data-add-resource-req>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        </button>
      </div>
      <div class="list-editor">${resourceRows}</div>
    </div>
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
      <button class="button secondary" type="button" data-toggle-add-edge-form>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
        Add Edge
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

function renderResourceRequirementEditor(node) {
  const requirements = node.resources_required || [];
  return requirements.length
    ? requirements
        .map(
          (requirement, index) => `
            <div class="resource-requirement-row">
              <label class="field">
                <span>Name</span>
                <input list="resourceNameOptions" type="text" data-resource-req-field="name" data-resource-req-index="${index}" value="${escapeAttribute(requirement.name || resourceName(requirement.resource_id))}" />
              </label>
              <label class="field">
                <span>Qty</span>
                <input type="text" data-resource-req-field="quantity" data-resource-req-index="${index}" value="${escapeAttribute(requirement.quantity || "")}" />
              </label>
              <button class="icon-button danger" type="button" title="Remove requirement" data-remove-resource-req="${index}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
              </button>
            </div>
          `
        )
        .join("") + `<datalist id="resourceNameOptions">${graph.resources.map((resource) => `<option value="${escapeAttribute(resource.name)}"></option>`).join("")}</datalist>`
    : `<div class="type-help">No resource requirements. Add name + quantity rows as needed.</div>`;
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
            </div>
          `
        )
        .join("")
    : `<div class="type-help">No flows defined yet. Add cash, energy, parts, information, data, work, approval, or custom flows.</div>`;
}

function renderEdgeBuilder() {
  const fromDefault = selected.kind === "node" ? selected.id : graph.nodes[0]?.id || "";
  const toDefault = graph.nodes.find((node) => node.id !== fromDefault)?.id || graph.nodes[0]?.id || "";
  const fromValue = selected.kind === "node" ? fromDefault : els.edgeFromSelect.value || fromDefault;
  els.edgeBuilderBody.style.display = addEdgeFormOpen ? "grid" : "none";
  els.toggleAddEdgeButton.title = addEdgeFormOpen ? "Hide add edge form" : "Show add edge form";
  els.edgeFromSelect.innerHTML = nodeOptions(fromValue);
  els.edgeToSelect.innerHTML = nodeOptions(els.edgeToSelect.value || toDefault);
  els.edgeTypeSelect.innerHTML = EDGE_TYPES.map((type) => option(type, els.edgeTypeSelect.value || "flow", ontologyLabel("edge_types", type))).join("");
  els.edgeFlowKindSelect.innerHTML = FLOW_KINDS.map((kind) => option(kind, els.edgeFlowKindSelect.value || "information", ontologyLabel("flow_types", kind))).join("");
}

function renderEdgeTypeHelp() {
  const type = els.edgeTypeSelect.value || "flow";
  const definition = graph.ontology?.edge_types?.[type] || DEFAULT_ONTOLOGY.edge_types[type];
  els.edgeTypeHelp.textContent = definition?.description || "";
}

function renderEdgeFlowKindHelp() {
  const kind = els.edgeFlowKindSelect.value || "information";
  const definition = graph.ontology?.flow_types?.[kind] || DEFAULT_ONTOLOGY.flow_types[kind];
  els.edgeFlowKindHelp.textContent = definition ? `Flow kind: ${definition.description}` : "";
}

function renderValidation() {
  const report = validateGraph();
  const items = report.items;
  const errors = items.filter((item) => item.level === "error").length;
  const warnings = items.filter((item) => item.level === "warn").length;
  const complete = errors === 0 && warnings === 0;
  els.readinessBadge.textContent = complete ? "handoff readiness high" : `${errors} errors, ${warnings} warnings`;
  els.readinessBadge.style.color = errors ? "var(--danger)" : warnings ? "var(--orange)" : "var(--green)";
  els.allowCyclesInput.checked = allowCycles;

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

function renderResources() {
  els.resourceCount.textContent = `${graph.resources.length}`;
  if (!resourcesOpen) {
    els.resourceList.innerHTML = "";
    return;
  }

  els.resourceList.innerHTML =
    graph.resources
      .map(
        (resource) => `
          <div class="resource-item" data-resource-id="${resource.id}">
            <div class="field-grid">
              <label class="field">
                <span>Name</span>
                <input type="text" data-resource-field="name" value="${escapeAttribute(resource.name)}" />
              </label>
              <label class="field">
                <span>Type</span>
                <select data-resource-field="type">${RESOURCE_TYPES.map((type) => option(type, resource.type, ontologyLabel("resource_types", type))).join("")}</select>
              </label>
            </div>
            <span>${escapeHtml(resource.id)}</span>
          </div>
        `
      )
      .join("") ||
    `<div class="resource-item"><div><strong>No resources</strong><span>Add human, machine, or material resources.</span></div></div>`;
}

function renderConstraints() {
  const associated = selected.kind ? graph.constraints.filter((constraint) => constraintMatchesSelection(constraint)) : [];
  const list = associated.length ? associated : graph.constraints;
  const isOpen = constraintsOpen || associated.length > 0;
  els.constraintCount.textContent = associated.length ? `${associated.length} matching` : `${graph.constraints.length}`;
  if (!isOpen) {
    els.constraintList.innerHTML = "";
    return;
  }

  const markup = list
      .map(
        (constraint) => `
          <div class="constraint-item" data-constraint-id="${constraint.id}">
            <div>
              <div class="field-grid">
                <label class="field">
                  <span>Type</span>
                  <select data-constraint-field="type">${CONSTRAINT_TYPES.map((type) => option(type, constraint.type, ontologyLabel("constraint_types", type))).join("")}</select>
                </label>
                <label class="field">
                  <span>Target</span>
                  <input list="constraintTargetOptions" type="text" data-constraint-field="target" value="${escapeAttribute(constraint.fields?.target || "")}" placeholder="Node, edge, resource..." />
                </label>
              </div>
              <div class="field-grid three">
                <label class="field">
                  <span>What</span>
                  <input type="text" data-constraint-field="metric" value="${escapeAttribute(constraint.fields?.metric || "")}" placeholder="cash, part, resource, duration..." />
                </label>
                <label class="field">
                  <span>Rule</span>
                  <select data-constraint-field="operator">${CONSTRAINT_OPERATORS.map((operator) => option(operator, constraint.fields?.operator || "equals", operatorLabel(operator))).join("")}</select>
                </label>
                <label class="field">
                  <span>Value</span>
                  <input type="text" data-constraint-field="value" value="${escapeAttribute(constraint.fields?.value || "")}" placeholder="TBD" />
                </label>
              </div>
              <label class="field">
                <span>Unit</span>
                <input type="text" data-constraint-field="unit" value="${escapeAttribute(constraint.fields?.unit || "")}" placeholder="Optional" />
              </label>
              <label class="field">
                <span>Notes</span>
                <input type="text" data-constraint-field="notes" value="${escapeAttribute(constraint.fields?.notes || "")}" placeholder="Why this constraint exists" />
              </label>
              <div class="type-help">${escapeHtml(ontologyDescription("constraint_types", constraint.type))}</div>
              <div class="type-help"><strong>Spec:</strong> ${escapeHtml(constraint.expression || constraintExpression(constraint))}</div>
            </div>
            <span>${escapeHtml(constraint.id)}</span>
          </div>
        `
      )
      .join("");

  els.constraintList.innerHTML = markup
    ? `${markup}<datalist id="constraintTargetOptions">${constraintTargetOptions()
        .map((target) => `<option value="${escapeAttribute(target)}"></option>`)
        .join("")}</datalist>`
    : `<div class="constraint-item"><div><strong>No constraints</strong><span>Add flow balance, capability limit, timing, routing, or policy constraints.</span></div></div>`;
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
  renderEdgeBuilder();
  renderEdgeTypeHelp();
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
    };
    els.graphCanvas.setPointerCapture(event.pointerId);
    render();
    return;
  }

  if (edgeTarget) {
    const edgeId = edgeTarget.dataset.edgeId;
    selected = { kind: "edge", id: edgeId };
    render();
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
  dragState = null;
  render();
}

function handleInspectorInput(event) {
  const nodeField = event.target.dataset.nodeField;
  const edgeField = event.target.dataset.edgeField;
  const edgeFlowField = event.target.dataset.edgeFlowField;
  const nodeListField = event.target.dataset.nodeListField;
  const resourceReqField = event.target.dataset.resourceReqField;

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
      saveState();
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
    if (nodeField !== "type") saveState();
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
    if (edgeField === "type") renderInspector();
  }

  if (edgeField && selected.kind === "edge") {
    applyMutation(
      {
        action: "update_edge",
        target_id: selected.id,
        payload: { [edgeField]: event.target.value },
        reason: `Inspector updated edge ${edgeField}`,
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    renderCanvas();
    renderValidation();
    updateStatus();
  }

  if (edgeFlowField && selected.kind === "edge") {
    const edge = graph.edges.find((item) => item.id === selected.id);
    if (!edge) return;
    const flows = normalizeFlows(edge.flows);
    const index = Number(event.target.dataset.edgeFlowIndex);
    const current = flows[index] || createFlow({});
    current[edgeFlowField] = event.target.value;
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

  if (resourceReqField && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    const requirements = normalizeResourceRequirements(node.resources_required);
    const index = Number(event.target.dataset.resourceReqIndex);
    const current = requirements[index] || { name: "", quantity: "" };
    current[resourceReqField] = event.target.value;
    if (resourceReqField === "name") current.resource_id = findResourceIdByName(event.target.value) || "";
    requirements[index] = current;
    applyMutation(
      {
        action: "update_node",
        target_id: selected.id,
        payload: { resources_required: requirements },
        reason: "Inspector updated node resource requirement",
        confidence: "high",
      },
      { rerender: false, log: false }
    );
    inferOntologyFromGraph();
    renderValidation();
  }
}

function handleInspectorClick(event) {
  const deleteNodeId = event.target.closest("[data-delete-node]")?.dataset.deleteNode;
  const deleteEdgeId = event.target.closest("[data-delete-edge]")?.dataset.deleteEdge;
  const addIoField = event.target.closest("[data-add-io]")?.dataset.addIo;
  const removeIoButton = event.target.closest("[data-remove-io]");
  const addResourceReq = event.target.closest("[data-add-resource-req]");
  const removeResourceReq = event.target.closest("[data-remove-resource-req]")?.dataset.removeResourceReq;
  const addEdgeFlow = event.target.closest("[data-add-edge-flow]");
  const removeEdgeFlow = event.target.closest("[data-remove-edge-flow]")?.dataset.removeEdgeFlow;
  const toggleAddNodeForm = event.target.closest("[data-toggle-add-node-form]");
  const toggleAddEdgeForm = event.target.closest("[data-toggle-add-edge-form]");
  const createNodeButton = event.target.closest("[data-create-node]");
  const suggestNodeDescriptionButton = event.target.closest("[data-suggest-node-description]");
  const approveNodeDescriptionButton = event.target.closest("[data-approve-node-description]");

  if (toggleAddNodeForm) {
    addNodeFormOpen = !addNodeFormOpen;
    renderInspector();
    saveState();
    return;
  }

  if (toggleAddEdgeForm) {
    addEdgeFormOpen = !addEdgeFormOpen;
    renderEdgeBuilder();
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

  if (addResourceReq && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    const firstResource = graph.resources[0];
    const requirements = normalizeResourceRequirements(node.resources_required);
    requirements.push({
      resource_id: firstResource?.id || "",
      name: firstResource?.name || "",
      quantity: "1",
    });
    applyMutation({
      action: "update_node",
      target_id: selected.id,
      payload: { resources_required: requirements },
      reason: "Inspector added resource requirement",
      confidence: "high",
    });
  }

  if (removeResourceReq !== undefined && selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    if (!node) return;
    const requirements = normalizeResourceRequirements(node.resources_required);
    requirements.splice(Number(removeResourceReq), 1);
    applyMutation({
      action: "update_node",
      target_id: selected.id,
      payload: { resources_required: requirements },
      reason: "Inspector removed resource requirement",
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

function handleResourceInput(event) {
  const item = event.target.closest("[data-resource-id]");
  if (!item || !event.target.dataset.resourceField) return;
  applyMutation(
    {
      action: "update_resource",
      target_id: item.dataset.resourceId,
      payload: { [event.target.dataset.resourceField]: event.target.value },
      reason: "Resource edited in inspector",
      confidence: "high",
    },
    { rerender: false, log: false }
  );
  inferOntologyFromGraph();
  renderInspector();
  renderValidation();
  renderOntology();
}

function handleConstraintInput(event) {
  const item = event.target.closest("[data-constraint-id]");
  if (!item || !event.target.dataset.constraintField) return;
  const constraint = graph.constraints.find((entry) => entry.id === item.dataset.constraintId);
  if (!constraint) return;
  const field = event.target.dataset.constraintField;
  const payload = {};
  if (field === "type") {
    payload.type = event.target.value;
    payload.fields = {
      ...createConstraintFields(event.target.value, constraint.fields?.target || ""),
      value: constraint.fields?.value || "",
    };
  } else {
    const value = field === "target" && event.type === "change" ? normalizeConstraintTarget(event.target.value) : event.target.value;
    payload.fields = { ...(constraint.fields || {}), [field]: value };
    if (field === "target" && value !== event.target.value) event.target.value = value;
  }
  const nextConstraint = { ...constraint, ...payload, fields: payload.fields || constraint.fields || {} };
  payload.expression = constraintExpression(nextConstraint);
  applyMutation(
    {
      action: "update_constraint",
      target_id: item.dataset.constraintId,
      payload,
      reason: "Constraint edited in inspector",
      confidence: "high",
    },
    { rerender: false, log: false }
  );
  inferOntologyFromGraph();
  renderValidation();
  renderOntology();
}

function selectedTargetCandidates() {
  if (selected.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selected.id);
    return node ? [node.name, node.id] : [];
  }
  if (selected.kind === "edge") {
    const edge = graph.edges.find((item) => item.id === selected.id);
    if (!edge) return [];
    const from = graph.nodes.find((node) => node.id === edge.from_node)?.name || edge.from_node;
    const to = graph.nodes.find((node) => node.id === edge.to_node)?.name || edge.to_node;
    return [edge.id, `${from} to ${to}`, `${from} -> ${to}`];
  }
  return [];
}

function constraintMatchesSelection(constraint) {
  const target = slug(constraint.fields?.target || "");
  if (!target) return false;
  return selectedTargetCandidates().some((candidate) => slug(candidate) === target);
}

function constraintTargetOptions() {
  return [
    ...graph.nodes.flatMap((node) => [node.name, node.id]),
    ...graph.edges.map((edge) => edge.id),
    ...graph.resources.flatMap((resource) => [resource.name, resource.id]),
    "Graph",
  ].filter(Boolean);
}

function normalizeConstraintTarget(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const target = constraintTargetOptions().find((candidate) => slug(candidate) === slug(raw));
  if (target) return target;
  const partial = constraintTargetOptions().find((candidate) => slug(candidate).startsWith(slug(raw)));
  return partial || raw;
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

function addEdgeFromInspector() {
  const from = els.edgeFromSelect.value;
  const to = els.edgeToSelect.value;
  if (!from || !to || from === to) {
    toast("Choose two different nodes");
    return;
  }
  const type = els.edgeTypeSelect.value;
  const condition = els.edgeConditionInput.value.trim();
  const flowName = els.edgeFlowNameInput.value.trim();
  const flowKind = els.edgeFlowKindSelect.value || "information";
  const id = uniqueId(`e_${slug(from)}_${slug(to)}`);
  const explicitFlows = flowName ? [createFlow({ name: flowName, kind: flowKind })] : [];
  const inferredFlows = explicitFlows.length ? explicitFlows : inferEdgeFlowsFromNodes({ from_node: from, to_node: to });
  applyMutation({
    action: "add_edge",
    target_id: null,
    payload: { id, from_node: from, to_node: to, type, condition, flows: inferredFlows },
    reason: "Inspector added edge",
    confidence: "high",
  });
  selected = { kind: "edge", id };
  els.edgeConditionInput.value = "";
  els.edgeFlowNameInput.value = "";
  render();
}

function addResource() {
  const id = uniqueId(`r_resource_${graph.resources.length + 1}`);
  resourcesOpen = true;
  applyMutation({
    action: "add_resource",
    target_id: null,
    payload: { id, name: `Resource ${graph.resources.length + 1}`, type: "human", attributes: {} },
    reason: "Inspector added resource",
    confidence: "high",
  });
  render();
}

function addConstraint() {
  const id = uniqueId(`c_constraint_${graph.constraints.length + 1}`);
  constraintsOpen = true;
  const constraint = createConstraint({
    id,
    type: "flow_balance",
    fields: createConstraintFields("flow_balance", selected.kind === "node" ? graph.nodes.find((node) => node.id === selected.id)?.name || "" : ""),
  });
  applyMutation({
    action: "add_constraint",
    target_id: null,
    payload: constraint,
    reason: "Inspector added constraint",
    confidence: "medium",
  });
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
      node.attributes = { ...(node.attributes || {}), ...(payload.attributes || {}) };
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
      constraint.fields = { ...(constraint.fields || {}), ...(payload.fields || {}) };
      constraint.expression = payload.expression || constraintExpression(constraint);
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
  if (settings.rerender) render();
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

function validateGraph() {
  const items = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const incoming = countBy(graph.edges, "to_node");
  const outgoing = countBy(graph.edges, "from_node");

  graph.edges.forEach((edge) => {
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

  graph.nodes.forEach((node) => {
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
      graph.edges
        .filter((edge) => edge.from_node === node.id)
        .forEach((edge) => {
          if (!edge.condition) {
            items.push({ level: "warn", title: "Decision branch condition missing", detail: `${edge.id} should explain when that branch is used.` });
          }
        });
    }
  });

  graph.constraints.forEach((constraint) => {
    const fields = constraint.fields || {};
    if (!fields.target) {
      items.push({ level: "warn", title: "Constraint target missing", detail: `${constraint.id} should name the node, edge, resource, or boundary it constrains.` });
    }
    if ((constraint.type === "capability_limit" || constraint.type === "timing" || constraint.type === "routing_rule" || constraint.type === "policy_rule") && !fields.value) {
      items.push({ level: "warn", title: "Constraint value missing", detail: `${constraint.id} needs a plain-language value or rule.` });
    }
    if (constraint.type === "flow_balance" && !fields.metric) {
      items.push({ level: "warn", title: "Flow balance item missing", detail: `${constraint.id} should identify what must balance, transform, accumulate, or be lost.` });
    }
  });

  items.push(...profileValidationItems());

  if (!allowCycles && hasCycle(graph)) {
    items.push({
      level: "warn",
      title: "Cycle detected",
      detail: "The graph contains a cycle. Enable cycles only when rework loops are intentional.",
    });
  }

  return { items };
}

function profileValidationItems() {
  const items = [];
  const style = graph.modeling_style || "none";
  const flowKinds = new Set(graph.edges.flatMap((edge) => normalizeFlows(edge.flows).map((flow) => flow.kind)));
  const constraintTypes = new Set(graph.constraints.map((constraint) => constraint.type));
  const hasAllocation = graph.edges.some((edge) => edge.type === "allocation");

  if (style === "business_process") {
    if (!flowKinds.has("information") && !flowKinds.has("approval")) {
      items.push({ level: "warn", title: "Business process flow unclear", detail: "Business process style usually needs information or approval flows." });
    }
    if (!constraintTypes.has("policy_rule") && graph.nodes.some((node) => node.type === "decision")) {
      items.push({ level: "warn", title: "Policy rule missing", detail: "Decision-heavy business processes should capture the policy behind routing." });
    }
  }

  if (style === "value_stream") {
    if (!flowKinds.has("parts")) {
      items.push({ level: "warn", title: "Value stream material flow missing", detail: "Value stream style should identify the part, material, or inventory flow." });
    }
    if (!constraintTypes.has("timing")) {
      items.push({ level: "warn", title: "Value stream timing missing", detail: "Add cycle time, wait time, lead time, or transfer time constraints." });
    }
  }

  if (style === "system_flow") {
    if (!["energy", "data", "parts"].some((kind) => flowKinds.has(kind))) {
      items.push({ level: "warn", title: "System flow payload missing", detail: "System flow style should include energy, data, material, or interface payloads." });
    }
    if (!constraintTypes.has("flow_balance")) {
      items.push({ level: "warn", title: "System balance missing", detail: "Add flow balance constraints for conserved, transformed, stored, or lost quantities." });
    }
  }

  if (style === "team_topology") {
    if (!graph.resources.length) {
      items.push({ level: "warn", title: "Team topology resources missing", detail: "Add teams, roles, or people as resources for assignment mapping." });
    }
    if (!hasAllocation && !constraintTypes.has("capability_limit")) {
      items.push({ level: "warn", title: "Assignment mapping missing", detail: "Use allocation edges or capability limits to show ownership and capacity." });
    }
  }

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
    if (node.resources_required.length) {
      lines.push(
        `- Resources Required: [${normalizeResourceRequirements(node.resources_required)
          .map((ref) => `${ref.name || ref.resource_id}${ref.quantity ? ` x ${ref.quantity}` : ""}`)
          .join(", ")}]`
      );
    }
    if (node.notes) lines.push(`- Notes: ${node.notes}`);
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
  });
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Resources");
  lines.push("");
  graph.resources.forEach((resource) => {
    lines.push(`- ${resource.id}: ${resource.name} (${resource.type})`);
  });
  if (!graph.resources.length) lines.push("- None");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Constraints");
  lines.push("");
  graph.constraints.forEach((constraint) => {
    lines.push(`- ${constraint.id}: ${ontologyLabel("constraint_types", constraint.type)} - ${constraint.expression || constraintExpression(constraint) || "TBD"}`);
  });
  if (!graph.constraints.length) lines.push("- None");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Assumptions");
  lines.push("");
  graph.assumptions.forEach((assumption) => {
    lines.push(`- ${assumption.id}: ${assumption.text}`);
  });
  if (!graph.assumptions.length) lines.push("- None");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Open Questions");
  lines.push("");
  openQuestions.forEach((question) => lines.push(`- ${question}`));
  if (!openQuestions.length) lines.push("- None");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Validation Status");
  lines.push("");
  lines.push(`- Errors: ${validation.filter((item) => item.level === "error").length}`);
  lines.push(`- Warnings: ${validation.filter((item) => item.level === "warn").length}`);
  validation.forEach((item) => lines.push(`- ${item.level.toUpperCase()}: ${item.title} - ${item.detail}`));
  if (!validation.length) lines.push("- Structure complete");
  lines.push("");
  lines.push("---");
  lines.push("");
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
  lines.push("## Graph JSON");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(graph, null, 2));
  lines.push("```");
  return lines.join("\n");
}

function exportEnvelope() {
  return {
    graph,
    layout,
    selected,
    mutation_log: mutationLog,
    open_questions: openQuestions,
    chat_messages: chatMessages,
    ontology: graph.ontology,
    notation_profile: currentNotationProfile(),
    validation: validateGraph().items,
    exported_at: new Date().toISOString(),
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
  const json = JSON.stringify(exportEnvelope(), null, 2);
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

async function copyGraphJson() {
  const text = JSON.stringify(exportEnvelope(), null, 2);
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
  selected = { kind: "node", id: "n_request_complete" };
  pendingPlan = null;
  mutationLog = [];
  openQuestions = [];
  allowCycles = true;
  addNodeFormOpen = false;
  addEdgeFormOpen = false;
  resourcesOpen = false;
  constraintsOpen = false;
  chatMessages = [];
  undoStack = [];
  clarificationContext = null;
  canvasView = { x: 0, y: 0, zoom: 1 };
  renderPlan();
  render();
  toast("Sample graph restored");
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
    attributes: payload.attributes || {},
    description: typeof payload.description === "string" ? payload.description : "",
    description_status: normalizeNodeDescriptionStatus(payload.description_status, payload.description || ""),
    notes: payload.notes || "",
  };
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
  return {
    id: payload.id || uniqueId(`e_${slug(payload.from_node)}_${slug(payload.to_node)}`),
    from_node: payload.from_node,
    to_node: payload.to_node,
    type,
    condition: payload.condition || "",
    flows,
  };
}

function createFlow(payload) {
  const kind = FLOW_KINDS.includes(payload.kind) ? payload.kind : inferFlowKind(payload.name || "");
  return {
    id: payload.id || uniqueId(`f_${slug(payload.name || kind || "flow")}`),
    name: payload.name || "",
    kind,
    quantity: payload.quantity !== undefined ? String(payload.quantity) : "",
    unit: payload.unit || "",
    properties: payload.properties || {},
  };
}

function createResource(payload) {
  return {
    id: payload.id || uniqueId(`r_${slug(payload.name || "resource")}`),
    name: payload.name || "Resource",
    type: RESOURCE_TYPES.includes(payload.type) ? payload.type : "human",
    attributes: payload.attributes || {},
  };
}

function createConstraint(payload) {
  const type = normalizeConstraintType(payload.type);
  const constraint = {
    id: payload.id || uniqueId(`c_${slug(payload.type || "constraint")}`),
    type,
    fields: payload.fields || migrateConstraintFields(payload),
    expression: payload.expression || "",
  };
  constraint.expression = constraint.expression || constraintExpression(constraint);
  return {
    ...constraint,
  };
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
    .filter(({ raw }) => raw.name || raw.kind || raw.quantity || raw.unit)
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
    width = 2.8;
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

function migrateConstraintFields(payload) {
  const expression = payload.expression || "";
  const type = normalizeConstraintType(payload.type);
  return { ...createConstraintFields(type, ""), value: expression };
}

function createConstraintFields(type, target = "") {
  const template = CONSTRAINT_TEMPLATES[normalizeConstraintType(type)] || CONSTRAINT_TEMPLATES.flow_balance;
  return {
    target,
    metric: template.metric,
    operator: template.operator,
    value: template.value,
    unit: template.unit,
    notes: template.notes,
  };
}

function constraintExpression(constraint) {
  const fields = constraint.fields || {};
  const target = fields.target ? `${fields.target}: ` : "";
  const metric = fields.metric || (constraint.type === "timing" ? "duration" : "flow");
  const rule = operatorLabel(fields.operator || "equals");
  const value = fields.value ? ` ${fields.value}` : "";
  const unit = fields.unit ? ` ${fields.unit}` : "";
  if (constraint.type === "flow_balance") return `${target}${metric} ${rule}${value}${unit}; account for transformation, storage, loss, or scrap.`;
  if (constraint.type === "capability_limit") return `${target}${metric} ${rule}${value}${unit}.`;
  if (constraint.type === "timing") return `${target}${metric} ${rule}${value}${unit}.`;
  if (constraint.type === "routing_rule") return `${target}${metric} ${rule}${value}${unit}.`;
  if (constraint.type === "policy_rule") return `${target}${metric} ${rule}${value}${unit}.`;
  return `${target}${metric} ${rule}${value}${unit}`.trim();
}

function inferConstraintTarget(constraint) {
  const haystack = `${constraint.expression || ""} ${constraint.fields?.value || ""} ${constraint.fields?.notes || ""}`.toLowerCase();
  const nodeMatch = graph.nodes
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .find((node) => haystack.includes(node.name.toLowerCase()));
  if (nodeMatch) return nodeMatch.name;
  const resourceMatch = graph.resources
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .find((resource) => haystack.includes(resource.name.toLowerCase()));
  if (resourceMatch) return resourceMatch.name;
  return "";
}

function operatorLabel(operator) {
  const labels = {
    equals: "equals",
    at_most: "at most",
    at_least: "at least",
    after: "after",
    before: "before",
    requires: "requires",
    routes_to: "routes to",
    allowed_when: "allowed when",
    blocked_when: "blocked when",
    lasts: "lasts",
    custom: "custom rule",
  };
  return labels[operator] || titleCase(operator);
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
