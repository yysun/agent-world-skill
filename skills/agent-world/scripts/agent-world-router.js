#!/usr/bin/env node
/*
  Generic Agent World router.

  The router is deliberately not an agent executor. It loads agents and the
  workflow graph from .agent-world/world.json, persists messages, parses handoff
  mentions / host actions, and returns the next instruction for the host executor.

  Recent changes:
  - Switched world config loading to strict JSON plus external prompt files.
  - Added file-based request/result handoff so stdout can stay status-only.
  - Mention parsing now normalizes documented @mention forms before DAG routing.
  - World TO / completion tags and mainAgent fallback feed the same workflow checks.
  - Moved generated handoff files under .agent-world/handoffs/requests and
    .agent-world/handoffs/responses.
  - Added per-agent global or agent-only context selection for host instructions.
  - Mention labels now resolve longest-match-first so @agent Capitalized handoffs route.
  - Unresolved handoff mentions block instead of stalling the run silently.
  - A new human message supersedes a run's outstanding routing errors.
  - Stop-token detection ignores fenced code blocks.
  - Edge enforcement is derived from workflow.type, not configured beside it; free-mention is the
    one pattern with no graph, and a contradicting enforceEdges is a configuration error.
  - free-mention worlds must declare no edges, no requires, and exactly one node per agent, so a
    resolved mention can never queue no turn and report no block.
  - allowedNextNodes is the single source for both mention resolution and the prompt's allowed-next
    list, so a graph-less world offers its peers instead of rendering "(none)".
  - An unresolved paragraph-start mention is checked before auto-mention, so it can no longer be
    swallowed by a reply to the previous sender.
  - Human mentions overridden by the workflow entry are reported as ignoredMentions.
  - Agent-scope context is addressee-based and guarantees each requires node's latest message.
  - Added opt-in workflow.parallelDispatch batching plus per-agent subagent dispatch settings.
  - Rejected the legacy array-edge/join config dialect; workflow.nodes is now required.
*/

const fs = require('fs');
const path = require('path');

const ROUTER_COMMAND = 'node "$ROUTER"';
const DEFAULT_STATE_PATH = process.env.AGENT_WORLD_STATE || path.join(process.cwd(), '.agent-world', 'agent-world-state.json');
const DEFAULT_CONFIG_PATH = process.env.AGENT_WORLD_CONFIG || path.join(process.cwd(), '.agent-world', 'world.json');
const DEFAULT_CONTEXT_SCOPE = 'global';
const DEFAULT_CONTEXT_LIMIT = 18;
const CONTEXT_SCOPES = new Set(['global', 'agent']);
let activeStatePath = DEFAULT_STATE_PATH;

function now() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function readPrompt(configDir, agent) {
  const promptPath = agent.promptPath;
  if (!promptPath) {
    throw new Error(`Invalid Agent World config:\n- agents.${agent.id} is missing promptPath`);
  }
  const absolutePromptPath = path.resolve(configDir, promptPath);
  if (!fs.existsSync(absolutePromptPath)) {
    throw new Error(`Invalid Agent World config:\n- agents.${agent.id}.promptPath not found: ${promptPath}`);
  }
  return fs.readFileSync(absolutePromptPath, 'utf8').trimEnd();
}

function normalizeAgents(parsed, configPath) {
  const configDir = path.dirname(configPath);
  const rawAgents = parsed.agents || {};
  const entries = Array.isArray(rawAgents)
    ? rawAgents.map(agent => [agent.id || agent.name, agent])
    : Object.entries(rawAgents);

  const agents = {};
  for (const [id, agentConfig] of entries) {
    if (!id) throw new Error(`Agent entry is missing id/name in ${configPath}`);
    const agent = { ...agentConfig };
    agent.id = agent.id || id;
    agent.name = agent.name || agent.id;
    agent.role = agent.role || agent.id;
    agent.contextScope = agent.contextScope === undefined ? DEFAULT_CONTEXT_SCOPE : agent.contextScope;
    agent.systemPrompt = readPrompt(configDir, agent);
    agents[agent.id] = agent;
  }
  return agents;
}

const FREE_MENTION_TYPE = 'free-mention';

// Canonical workflow pattern ids. The schema enum is the other copy; exported so a test can assert
// the two never drift apart.
const CANONICAL_WORKFLOW_TYPES = new Set([
  'broadcast',
  FREE_MENTION_TYPE,
  'direct-handoff',
  'multi-agent-fan-out',
  'fan-in-collector',
  'sequential-pipeline',
  'intent-router',
  'fsm-state-token',
  'debate-ping-pong-loop',
  'orchestrator-worker',
  'custom-dag'
]);

// Edge enforcement is a property of the pattern, not a separate switch. free-mention is the one
// pattern with no graph, so it is the one pattern that does not enforce edges.
function enforcementForType(type) {
  return type !== FREE_MENTION_TYPE;
}

const LEGACY_EDGE_HELP = 'Define workflow.nodes as an object keyed by node id and workflow.edges as an object mapping each source node id (or "human") to an array of target node ids. Express joins with a node-level "requires" array, not an edge-level "join" key.';

function assertSupportedWorkflowShape(raw) {
  const errors = [];

  if (Array.isArray(raw.edges)) {
    errors.push('workflow.edges must be an object, not an array of from/to entries');
  } else if (raw.edges && typeof raw.edges === 'object') {
    for (const [source, targets] of Object.entries(raw.edges)) {
      if (targets && !Array.isArray(targets) && typeof targets === 'object') {
        errors.push(`workflow.edges.${source} must be an array of target node ids`);
      }
    }
  }

  for (const edge of Array.isArray(raw.edges) ? raw.edges : []) {
    if (edge && typeof edge === 'object' && edge.join !== undefined) {
      errors.push('workflow edges no longer support a "join" key');
      break;
    }
  }

  if (!raw.nodes || typeof raw.nodes !== 'object' || Array.isArray(raw.nodes)) {
    errors.push('workflow.nodes is required and must be an object keyed by node id');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Agent World config:\n- ${errors.join('\n- ')}\n\n${LEGACY_EDGE_HELP}`);
  }
}

function normalizeWorkflow(parsed, agents) {
  const raw = parsed.workflow || {};
  const routing = parsed.routing || {};
  const workflow = {
    type: raw.type || null,
    entry: raw.entry || null,
    entryAgent: raw.entryAgent || routing.noMentionFromHumanGoesTo || parsed.world && parsed.world.entryAgent,
    enforceEdges: enforcementForType(raw.type),
    parallelDispatch: raw.parallelDispatch === true,
    nodes: {},
    edges: {}
  };

  assertSupportedWorkflowShape(raw);

  workflow.nodes = raw.nodes;
  workflow.edges = raw.edges || {};

  if (!workflow.entry) workflow.entry = workflow.entryAgent;
  if (!workflow.entryAgent && workflow.entry && workflow.nodes[workflow.entry]) {
    workflow.entryAgent = workflow.nodes[workflow.entry].agent;
  }
  return workflow;
}

// loadConfig supplies `config.declaredEnforceEdges`. Calling this directly without it runs every
// graph and free-mention shape rule but skips the enforcement-mismatch check.
function validateConfig(config) {
  const errors = [];
  const agents = config.agents || {};
  const workflow = config.workflow || {};
  const nodes = workflow.nodes || {};
  const edges = workflow.edges || {};
  const declaredEnforceEdges = config.declaredEnforceEdges;
  const typeIsCanonical = CANONICAL_WORKFLOW_TYPES.has(workflow.type);

  if (!typeIsCanonical) {
    errors.push(`workflow.type must be one of the canonical workflow pattern ids, got ${workflow.type ? `"${workflow.type}"` : '(none)'}`);
  }

  // Enforcement is derived from the pattern. Stating it is allowed only when it agrees; a
  // contradiction used to load and silently negate the pattern's own eval contract. Skipped when the
  // type is unknown, so the message names the field the author must actually fix.
  if (typeIsCanonical && declaredEnforceEdges !== undefined) {
    const required = enforcementForType(workflow.type);
    if (declaredEnforceEdges !== required) {
      errors.push(`workflow.enforceEdges must be ${required} for workflow.type "${workflow.type}", or omitted; edge enforcement is derived from the pattern`);
    }
  }

  // free-mention is defined by having no graph at all. Each shape below would otherwise let a
  // resolved mention queue no turn and report no block.
  if (workflow.type === FREE_MENTION_TYPE) {
    for (const source of Object.keys(edges)) {
      errors.push(`workflow.edges.${source} is not allowed in a free-mention world; workflow.edges must be {}`);
    }

    for (const [nodeId, node] of Object.entries(nodes)) {
      if (node && asArray(node.requires).length > 0) {
        errors.push(`workflow.nodes.${nodeId}.requires is not allowed in a free-mention world; there are no edges to order prerequisites against`);
      }
    }

    const nodeCountByAgent = new Map();
    for (const node of Object.values(nodes)) {
      if (!node || !node.agent) continue;
      nodeCountByAgent.set(node.agent, (nodeCountByAgent.get(node.agent) || 0) + 1);
    }
    for (const agentId of Object.keys(agents)) {
      const count = nodeCountByAgent.get(agentId) || 0;
      if (count === 0) {
        errors.push(`agents.${agentId} has no workflow node; every agent in a free-mention world must map to exactly one node`);
      } else if (count > 1) {
        errors.push(`agents.${agentId} is referenced by ${count} workflow nodes; every agent in a free-mention world must map to exactly one node`);
      }
    }

    if (Object.keys(agents).length < 2) {
      errors.push('agents must contain at least two agents in a free-mention world; a lone agent has no peer to mention');
    }

    // turnLimitReached treats a non-finite or non-positive value as "no limit" in every pattern, but
    // free-mention is the one with no graph to bound it, so it is guarded here.
    const turnLimit = config.world && config.world.turnLimit;
    if (!Number.isInteger(turnLimit) || turnLimit < 1) {
      errors.push(`world.turnLimit must be an integer greater than 0 in a free-mention world; it is the only structural stop the pattern has, got ${JSON.stringify(turnLimit)}`);
    }
  }

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!CONTEXT_SCOPES.has(agent.contextScope)) {
      errors.push(`agents.${agentId}.contextScope must be one of: ${[...CONTEXT_SCOPES].join(', ')}`);
    }
    if (agent.contextLimit !== undefined && (!Number.isInteger(agent.contextLimit) || agent.contextLimit < 1)) {
      errors.push(`agents.${agentId}.contextLimit must be an integer greater than 0`);
    }
    if (agent.tools !== undefined && !Array.isArray(agent.tools)) {
      errors.push(`agents.${agentId}.tools must be an array of tool names`);
    }
  }

  if (workflow.entry && !nodes[workflow.entry]) {
    errors.push(`workflow.entry "${workflow.entry}" does not match a workflow node`);
  }

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node || !node.agent) {
      errors.push(`workflow.nodes.${nodeId} is missing agent`);
      continue;
    }

    if (!agents[node.agent]) {
      errors.push(`workflow.nodes.${nodeId}.agent "${node.agent}" is not defined in agents`);
    }

    for (const requiredNode of asArray(node.requires)) {
      if (!nodes[requiredNode]) {
        errors.push(`workflow.nodes.${nodeId}.requires references missing node "${requiredNode}"`);
      }
    }
  }

  for (const [fromNode, toNodes] of Object.entries(edges)) {
    if (fromNode !== 'human' && !nodes[fromNode]) {
      errors.push(`workflow.edges.${fromNode} references missing source node "${fromNode}"`);
    }

    for (const toNode of asArray(toNodes)) {
      if (!nodes[toNode]) {
        errors.push(`workflow.edges.${fromNode} references missing target node "${toNode}"`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Agent World config:\n- ${errors.join('\n- ')}`);
  }

  return config;
}

function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing Agent World config: ${configPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid Agent World JSON config at ${configPath}: ${err.message}`);
  }
  const agents = normalizeAgents(parsed, configPath);
  const workflow = normalizeWorkflow(parsed, agents);

  const world = {
    id: 'agent-world',
    name: 'agent-world',
    entryAgent: workflow.entryAgent,
    stopToken: parsed.routing && parsed.routing.stopToken || '<world>pass</world>',
    turnLimit: 30,
    mode: 'host_driven_router_only',
    ...(parsed.world || {})
  };

  if (!workflow.entryAgent) workflow.entryAgent = world.entryAgent || Object.keys(agents)[0];
  if (!workflow.entry) workflow.entry = workflow.entryAgent;
  world.entryAgent = workflow.entryAgent;
  if (parsed.routing && parsed.routing.stopToken) world.stopToken = parsed.routing.stopToken;

  return validateConfig({
    configPath,
    world,
    workflow,
    agents,
    // Carried here rather than on `workflow`, which hydrateState copies wholesale into the state file.
    declaredEnforceEdges: parsed.workflow && parsed.workflow.enforceEdges
  });
}

function newState(config) {
  return {
    version: 2,
    configPath: config.configPath,
    createdAt: now(),
    updatedAt: now(),
    counters: { message: 0, turn: 0, action: 0, run: 0, blocked: 0 },
    currentRunId: null,
    world: config.world,
    workflow: config.workflow,
    agents: config.agents,
    messages: [],
    pendingTurns: [],
    pendingHostActions: [],
    pendingRoutingErrors: [],
    completedTurns: [],
    completedHostActions: [],
    done: false,
    final: null
  };
}

function hydrateState(state, config) {
  state.version = 2;
  state.configPath = config.configPath;
  state.world = config.world;
  state.workflow = config.workflow;
  state.agents = config.agents;
  state.counters = state.counters || { message: 0, turn: 0, action: 0 };
  state.counters.run = state.counters.run || 0;
  state.counters.blocked = state.counters.blocked || 0;
  state.currentRunId = state.currentRunId || null;
  state.messages = state.messages || [];
  state.pendingTurns = state.pendingTurns || [];
  state.pendingHostActions = state.pendingHostActions || [];
  state.pendingRoutingErrors = state.pendingRoutingErrors || [];
  state.completedTurns = state.completedTurns || [];
  state.completedHostActions = state.completedHostActions || [];

  const legacyItems = [
    ...state.messages,
    ...state.pendingTurns,
    ...state.pendingHostActions,
    ...state.pendingRoutingErrors,
    ...state.completedTurns,
    ...state.completedHostActions
  ];
  if (!state.currentRunId && legacyItems.length > 0) {
    state.currentRunId = nextId(state, 'run');
  }
  if (state.currentRunId) {
    for (const item of legacyItems) {
      if (!item.runId) item.runId = state.currentRunId;
    }
  }
  return state;
}

function loadState(config) {
  if (!fs.existsSync(activeStatePath)) {
    const state = newState(config);
    saveState(state);
    return state;
  }
  return hydrateState(JSON.parse(fs.readFileSync(activeStatePath, 'utf8')), config);
}

function saveState(state) {
  state.updatedAt = now();
  ensureDir(activeStatePath);
  fs.writeFileSync(activeStatePath, JSON.stringify(state, null, 2));
}

function nextId(state, type) {
  state.counters[type] = (state.counters[type] || 0) + 1;
  return `${type}_${String(state.counters[type]).padStart(4, '0')}`;
}

function startRun(state) {
  const runId = nextId(state, 'run');
  state.currentRunId = runId;
  state.done = false;
  state.final = null;
  return runId;
}

function currentRunId(state) {
  return state.currentRunId || startRun(state);
}

function isCurrentRun(state, item) {
  return item && item.runId === state.currentRunId;
}

function hasCurrentRunPendingWork(state) {
  if (!state.currentRunId) return false;
  return state.pendingTurns.some(turn => isCurrentRun(state, turn) && turn.status === 'pending')
    || state.pendingHostActions.some(action => isCurrentRun(state, action) && action.status === 'pending');
}

function ensureRunForUserMessage(state) {
  if (!state.currentRunId || state.done || !hasCurrentRunPendingWork(state)) {
    return startRun(state);
  }
  return state.currentRunId;
}

function stripCodeFences(content) {
  return String(content || '').replace(/```[\s\S]*?```/g, '');
}

function normalizeMentionLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function agentMentionAliases(state) {
  const aliases = new Map();
  for (const [id, agent] of Object.entries(state.agents || {})) {
    const idAlias = normalizeMentionLabel(id);
    if (idAlias) aliases.set(idAlias, id);

    const nameAlias = normalizeMentionLabel(agent.name);
    if (nameAlias && !aliases.has(nameAlias)) aliases.set(nameAlias, id);
  }
  return aliases;
}

function resolveMentionTarget(state, rawTarget) {
  const alias = normalizeMentionLabel(rawTarget);
  if (!alias) return null;
  return agentMentionAliases(state).get(alias) || null;
}

function resolveMentionTargetFromLine(state, line) {
  for (const candidate of mentionLabelCandidatesFromLine(line)) {
    const target = resolveMentionTarget(state, candidate);
    if (target) return target;
  }
  return null;
}

function unresolvedMentionTokensFromLine(state, line) {
  const candidates = mentionLabelCandidatesFromLine(line);
  if (candidates.length === 0) return null;
  if (resolveMentionTargetFromLine(state, line)) return null;
  return candidates[candidates.length - 1];
}

function mentionLabelCandidatesFromLine(line) {
  let rest = String(line || '').trimStart();
  const greeting = rest.match(/^(hey|hi|hello|to)\b[\s,:-]+/i);
  if (greeting) rest = rest.slice(greeting[0].length);

  const mention = rest.match(/^@([A-Za-z][A-Za-z0-9_.-]*)(?:[ \t]+([A-Z][A-Za-z0-9_.-]*))?/);
  if (!mention) return [];

  // Longest match first: a two-word display name such as "@Madame Pedagogue" wins when it
  // resolves, otherwise fall back to the single-word id so "@architect Please design." routes.
  const candidates = [];
  if (mention[2]) candidates.push(`${mention[1]} ${mention[2]}`);
  candidates.push(mention[1]);
  return candidates;
}


function extractWorldToMentions(content, state) {
  const match = String(content || '').match(/<world>\s*TO\s*:\s*([^<]+?)\s*<\/world>/i);
  if (!match) return [];

  const mentions = [];
  const seen = new Set();
  for (const rawTarget of match[1].split(',')) {
    const target = resolveMentionTarget(state, rawTarget);
    if (target && !seen.has(target)) {
      seen.add(target);
      mentions.push(target);
    }
  }
  return mentions;
}

function hasWorldCompletionTag(content, state) {
  // Detection ignores fenced blocks so an agent quoting the protocol cannot end the run.
  // state.final is still recorded from the original, unstripped message.
  const text = stripCodeFences(content);
  if (state.world.stopToken && text.includes(state.world.stopToken)) return true;
  return /<world>\s*(STOP|DONE|PASS)\s*<\/world>/i.test(text);
}

function stripLeadingMentionLines(content, state) {
  return String(content || '')
    .split(/\r?\n/)
    .filter(line => !resolveMentionTargetFromLine(state, line))
    .join('\n')
    .replace(/^\s+/, '')
    .trimEnd();
}

function extractParagraphMentions(content, state, sender = null) {
  const toMentions = extractWorldToMentions(content, state);
  if (toMentions.length > 0) return toMentions.filter(target => target !== sender);

  const text = stripCodeFences(content);
  const mentions = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const target = resolveMentionTargetFromLine(state, line);
    if (target && target !== sender && !seen.has(target)) {
      seen.add(target);
      mentions.push(target);
    }
  }
  return mentions;
}

function extractUnresolvedMentions(content, state) {
  const tokens = [];
  const seen = new Set();
  for (const line of stripCodeFences(content).split(/\r?\n/)) {
    const token = unresolvedMentionTokensFromLine(state, line);
    if (token && !seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

function withoutMeta(obj) {
  const copy = { ...obj };
  delete copy.id;
  delete copy.actionId;
  delete copy.requestedBy;
  delete copy.requested_by;
  delete copy.kind;
  delete copy.reason;
  delete copy.approval;
  return copy;
}

function extractHostActions(content, state, sender, metadata = {}) {
  const actions = [];
  const regex = /```agent-world-host-action\s*([\s\S]*?)```/g;
  for (const match of String(content || '').matchAll(regex)) {
    const raw = match[1].trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parsed = {
        kind: 'invalid_host_action',
        reason: 'The agent emitted an agent-world-host-action block that was not valid JSON.',
        approval: 'none',
        payload: { raw, parseError: err.message }
      };
    }

    const actionId = parsed.id || parsed.actionId || nextId(state, 'action');
    actions.push({
      id: actionId,
      type: 'host_action',
      runId: metadata.runId || currentRunId(state),
      requestedBy: sender,
      kind: parsed.kind || 'unknown',
      reason: parsed.reason || '',
      approval: parsed.approval || 'ask_if_risky',
      payload: parsed.payload !== undefined ? parsed.payload : withoutMeta(parsed),
      raw,
      sourceSender: sender,
      workflowNode: metadata.workflowNode || null,
      status: 'pending',
      createdAt: now()
    });
  }
  return actions;
}

function appendMessage(state, sender, content, metadata = {}) {
  const msg = {
    id: nextId(state, 'message'),
    runId: metadata.runId || currentRunId(state),
    sender,
    content: String(content || '').trimEnd(),
    metadata,
    createdAt: now(),
    processedForRouting: false
  };
  state.messages.push(msg);
  return msg;
}

function workflowNode(state, nodeId) {
  return nodeId && state.workflow.nodes ? state.workflow.nodes[nodeId] : null;
}

function completedWorkflowNodes(state) {
  return new Set(
    state.completedTurns
      .filter(turn => isCurrentRun(state, turn))
      .map(turn => turn.workflowNode)
      .filter(Boolean)
  );
}

function nodePrereqsMet(state, nodeId) {
  const node = workflowNode(state, nodeId);
  const required = node && Array.isArray(node.requires) ? node.requires : [];
  if (required.length === 0) return true;
  const completed = completedWorkflowNodes(state);
  return required.every(id => completed.has(id));
}

function agentForNode(state, nodeId) {
  const node = workflowNode(state, nodeId);
  return node ? node.agent : null;
}

function nodesForMentionTargets(state, sourceNode, mentions) {
  return allowedNextNodes(state, sourceNode)
    .filter(nodeId => mentions.includes(agentForNode(state, nodeId)) && nodePrereqsMet(state, nodeId));
}

// With enforcement off there is no graph: every peer is reachable. A null source node excludes
// nothing, which is what keeps a free-mention turn node-carrying even on a legacy null-node turn.
function allowedNextNodes(state, sourceNode) {
  if (state.workflow.enforceEdges === false) {
    return Object.keys(state.workflow.nodes || {}).filter(nodeId => nodeId !== sourceNode);
  }
  if (!sourceNode || !state.workflow.edges) return [];
  return state.workflow.edges[sourceNode] || [];
}

function turnLimitReached(state) {
  const limit = Number(state.world.turnLimit || 30);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  const completed = state.completedTurns.filter(turn => isCurrentRun(state, turn)).length;
  return completed >= limit;
}

function supersedePendingRoutingErrors(state) {
  // A new top-level request is the documented recovery path out of a blocked run.
  for (const error of state.pendingRoutingErrors) {
    if (isCurrentRun(state, error) && error.status === 'pending') {
      error.status = 'superseded';
      error.supersededAt = now();
    }
  }
}

function queueRoutingError(state, error) {
  const runId = currentRunId(state);
  const duplicate = state.pendingRoutingErrors.some(item => (
    item.status === 'pending'
    && item.runId === runId
    && item.reason === error.reason
    && item.sourceMessageId === error.sourceMessageId
  ));
  if (duplicate) return null;

  const blocked = {
    id: nextId(state, 'blocked'),
    type: 'blocked',
    runId,
    status: 'pending',
    createdAt: now(),
    ...error
  };
  state.pendingRoutingErrors.push(blocked);
  return blocked;
}

function queueTurn(state, agent, sourceMessageId, reason = 'mention', workflowNodeId = null, extra = {}) {
  if (!state.agents[agent]) return null;
  if (state.done) return null;
  if (turnLimitReached(state)) {
    const limit = Number(state.world.turnLimit || 30);
    queueRoutingError(state, {
      reason: `Workflow stopped: turn limit ${limit} reached.`,
      code: 'turn_limit_reached',
      sourceMessageId,
      limit,
      completedTurns: state.completedTurns.filter(turn => isCurrentRun(state, turn)).length
    });
    return null;
  }
  const alreadyPending = state.pendingTurns.some(turn => (
    turn.status === 'pending' &&
    turn.runId === state.currentRunId &&
    turn.agent === agent &&
    (turn.workflowNode || null) === (workflowNodeId || null)
  ));
  if (alreadyPending) return null;
  const turn = {
    id: nextId(state, 'turn'),
    type: 'agent_turn',
    runId: currentRunId(state),
    agent,
    workflowNode: workflowNodeId,
    sourceMessageId,
    reason,
    status: 'pending',
    dispatched: false,
    createdAt: now(),
    ...extra
  };
  state.pendingTurns.push(turn);
  return turn;
}

function queueWorkflowNode(state, nodeId, sourceMessageId, reason, extra = {}) {
  const agent = agentForNode(state, nodeId);
  if (!agent) return null;
  return queueTurn(state, agent, sourceMessageId, reason, nodeId, extra);
}

function autoReplyMentionTarget(state, msg) {
  const sourceMessageId = msg.metadata && msg.metadata.sourceMessageId;
  const sourceMessage = sourceMessageId ? messageById(state, sourceMessageId) : null;
  if (!sourceMessage || sourceMessage.sender === msg.sender) return null;
  if (!state.agents[sourceMessage.sender]) return null;

  const currentNode = msg.metadata && msg.metadata.workflowNode;
  if (!currentNode && state.workflow.enforceEdges) return sourceMessage.sender;
  return nodesForMentionTargets(state, currentNode || null, [sourceMessage.sender]).length > 0
    ? sourceMessage.sender
    : null;
}

function processMessageForRouting(state, msg) {
  if (msg.processedForRouting) return;
  msg.processedForRouting = true;

  if (hasWorldCompletionTag(msg.content, state)) {
    state.done = true;
    state.final = stripLeadingMentionLines(msg.content, state);
    return;
  }

  const isAgent = Boolean(state.agents[msg.sender]);
  const hostActions = isAgent ? extractHostActions(msg.content, state, msg.sender, { ...(msg.metadata || {}), runId: msg.runId }) : [];
  if (hostActions.length > 0) {
    state.pendingHostActions.push(...hostActions);
    return;
  }

  let mentions = extractParagraphMentions(msg.content, state, isAgent ? msg.sender : null);

  if (msg.sender === 'human') {
    const explicitMentions = [...mentions];
    if (mentions.length === 0 && state.world.mainAgent) {
      const mainAgent = resolveMentionTarget(state, state.world.mainAgent);
      if (mainAgent) mentions = [mainAgent];
    }

    if (mentions.length > 0 && state.workflow.nodes) {
      const humanEdges = state.workflow.edges && state.workflow.edges.human;
      const candidates = Object.entries(state.workflow.nodes)
        .filter(([nodeId, node]) => mentions.includes(node.agent))
        .filter(([nodeId]) => {
          if (Array.isArray(humanEdges)) return humanEdges.includes(nodeId);
          return nodeId === state.workflow.entry || nodePrereqsMet(state, nodeId);
        })
        .map(([nodeId]) => nodeId);
      if (candidates.length > 0) {
        for (const nodeId of candidates) queueWorkflowNode(state, nodeId, msg.id, 'human_mention_workflow_node');
        return;
      }
    }
    if (state.workflow.entry) {
      // The DAG wins, but never silently: tell the host which explicit mentions it overrode.
      // Only the human's own mentions count here; a world.mainAgent fallback was never typed.
      const ignoredMentions = explicitMentions.filter(target => agentForNode(state, state.workflow.entry) !== target);
      queueWorkflowNode(state, state.workflow.entry, msg.id, 'entry_workflow_node',
        ignoredMentions.length > 0 ? { ignoredMentions } : {});
      return;
    }
    const targets = mentions.length > 0 ? mentions : [state.workflow.entryAgent || state.world.entryAgent];
    for (const target of targets) queueTurn(state, target, msg.id, mentions.length > 0 ? 'human_mention' : 'entry_agent');
    return;
  }

  if (isAgent) {
    const currentNode = msg.metadata && msg.metadata.workflowNode;
    const allowedNext = allowedNextNodes(state, currentNode || null);

    // Only a message that resolved no mention can block, so skip the body scan otherwise.
    const unresolved = mentions.length === 0 ? extractUnresolvedMentions(msg.content, state) : [];

    // Whether an unresolved paragraph-start mention will actually surface as a block. Auto-reply is
    // suppressed only when it will: otherwise substituting the previous sender is still the right
    // move, and suppressing it would strand the turn with neither a route nor an error. The
    // enforced-world exception is that a turn carrying no workflow node has no allowed-next set to
    // check, so it keeps auto-replying rather than stalling; see mention-routing-rules.md.
    const blockWouldFire = unresolved.length > 0
      && (!state.workflow.enforceEdges || (Boolean(currentNode) && allowedNext.length > 0));

    if (mentions.length === 0 && !blockWouldFire) {
      const replyTarget = autoReplyMentionTarget(state, msg);
      if (replyTarget) mentions = [replyTarget];
    }

    const routedNodes = nodesForMentionTargets(state, currentNode || null, mentions);
    if (routedNodes.length > 0) {
      const reason = state.workflow.enforceEdges ? 'workflow_edge' : 'agent_mention';
      for (const nodeId of routedNodes) queueWorkflowNode(state, nodeId, msg.id, reason);
      return;
    }

    // A handoff that names nobody must surface, not stall the run at idle. This check is independent
    // of edge enforcement; only its allowed-next precondition is enforced-world-specific, which keeps
    // an enforced terminal node returning idle exactly as before.
    if (blockWouldFire) {
      queueRoutingError(state, {
        reason: `Agent @${msg.sender} used a paragraph-start mention of ${unresolved.map(token => `@${token}`).join(', ')}, which matches no agent in this world.`,
        code: 'unknown_mention_target',
        sourceMessageId: msg.id,
        sourceAgent: msg.sender,
        sourceNode: currentNode || null,
        unresolvedMentions: unresolved,
        allowedNext
      });
      return;
    }

    if (state.workflow.enforceEdges && currentNode) {
      const invalidMentions = mentions.filter(target => !allowedNext.some(nodeId => agentForNode(state, nodeId) === target));
      if (invalidMentions.length > 0) {
        const invalidTargets = invalidMentions.map(target => ({
          agent: target,
          nodes: Object.entries(state.workflow.nodes || {})
            .filter(([, node]) => node.agent === target)
            .map(([nodeId]) => nodeId)
        }));
        const invalidTargetText = invalidTargets
          .map(target => target.nodes.length > 0 ? target.nodes.join(', ') : `@${target.agent}`)
          .join(', ');
        queueRoutingError(state, {
          reason: `Agent @${msg.sender} mentioned ${invalidMentions.map(target => `@${target}`).join(', ')}, but no workflow edge allows ${currentNode} -> ${invalidTargetText}.`,
          code: 'workflow_edge_blocked',
          sourceMessageId: msg.id,
          sourceAgent: msg.sender,
          sourceNode: currentNode,
          mentions: invalidMentions,
          targetNodes: invalidTargets,
          allowedNext
        });
      }
      return;
    }

    for (const target of mentions) {
      if (target !== msg.sender) queueTurn(state, target, msg.id, 'agent_mention');
    }
    return;
  }

  if (msg.sender === 'host') {
    const replyTo = msg.metadata && msg.metadata.replyTo;
    const workflowNodeId = msg.metadata && msg.metadata.workflowNode;
    if (replyTo) queueTurn(state, replyTo, msg.id, 'host_action_result', workflowNodeId);
  }
}

function compactMessages(messages) {
  return messages.map(message => ({
    id: message.id,
    runId: message.runId,
    sender: message.sender,
    content: message.content,
    metadata: message.metadata || {}
  }));
}

function contextLimitForAgent(agent) {
  const configured = agent && agent.contextLimit;
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CONTEXT_LIMIT;
}

function messageAddressesAgent(state, message, agentId) {
  if (message.sender === agentId) return false;
  return extractParagraphMentions(message.content, state, message.sender).includes(agentId);
}

function requiredNodeMessages(state, turn, runMessages) {
  const node = workflowNode(state, turn.workflowNode);
  const required = node && Array.isArray(node.requires) ? node.requires : [];
  const selected = [];
  for (const requiredNode of required) {
    const last = [...runMessages]
      .reverse()
      .find(message => message.metadata && message.metadata.workflowNode === requiredNode);
    if (last) selected.push(last);
  }
  return selected;
}

function compactContext(state, turn, limit) {
  const runMessages = state.messages.filter(message => isCurrentRun(state, message));
  const agent = state.agents[turn.agent];
  const scope = agent && agent.contextScope || DEFAULT_CONTEXT_SCOPE;
  const cap = limit === undefined ? contextLimitForAgent(agent) : limit;

  if (scope === 'global') return compactMessages(runMessages.slice(-cap));

  // Agent scope is addressee-based: an agent must see what was sent to it, not only what it
  // wrote. A node with `requires` additionally gets each required node's latest message, so a
  // fan-in collector never loses a lane it was gated on.
  const sourceMessage = runMessages.find(message => message.id === turn.sourceMessageId) || null;
  const guaranteed = new Set();
  if (sourceMessage) guaranteed.add(sourceMessage.id);
  for (const message of requiredNodeMessages(state, turn, runMessages)) guaranteed.add(message.id);

  const optional = runMessages.filter(message => (
    !guaranteed.has(message.id)
    && (message.sender === turn.agent || messageAddressesAgent(state, message, turn.agent))
  ));

  // Guaranteed messages are never dropped to satisfy the cap: losing a lane a node was gated on
  // is worse than exceeding the budget. Only the optional fill is capped.
  const remaining = Math.max(0, cap - guaranteed.size);
  const selectedIds = new Set(guaranteed);
  for (const message of remaining > 0 ? optional.slice(-remaining) : []) selectedIds.add(message.id);

  return compactMessages(runMessages.filter(message => selectedIds.has(message.id)));
}

function contextMarkdown(context) {
  return context
    .map(message => `---\nfrom: ${message.sender}\nid: ${message.id}\n${message.content}`)
    .join('\n');
}

function messageById(state, id) {
  return state.messages.find(message => message.id === id) || null;
}

function relativeCommandBase() {
  return ROUTER_COMMAND;
}

function workflowHints(state, turn) {
  const node = workflowNode(state, turn.workflowNode);
  const nextNodes = allowedNextNodes(state, turn.workflowNode || null);
  return {
    node: turn.workflowNode || null,
    next: nextNodes.map(nodeId => ({
      node: nodeId,
      agent: agentForNode(state, nodeId),
      requires: workflowNode(state, nodeId) && workflowNode(state, nodeId).requires || []
    })),
    instruction: node && node.instruction || ''
  };
}

function dispatchSettings(agent) {
  const settings = {};
  if (agent.model) settings.model = agent.model;
  if (agent.subagentType) settings.subagentType = agent.subagentType;
  if (Array.isArray(agent.tools)) settings.tools = agent.tools;
  if (Number.isInteger(agent.contextLimit) && agent.contextLimit > 0) settings.contextLimit = agent.contextLimit;
  return settings;
}

function buildAgentInstruction(state, turn) {
  const agent = state.agents[turn.agent];
  const systemPrompt = agent.systemPrompt;
  const context = compactContext(state, turn);
  const ignoredMentions = Array.isArray(turn.ignoredMentions) ? turn.ignoredMentions : [];
  const routedFrom = messageById(state, turn.sourceMessageId);
  const workflow = workflowHints(state, turn);
  const handoff = handoffFilePair(`turn-${turn.id}`);
  const promptForHost = `You are executing exactly one Agent World turn as @${agent.name}.

The router selected @${agent.name} from .agent-world/world.json. The router only provides this dynamic instruction: the selected agent's system prompt, workflow node, allowed next workflow nodes, and persisted context. Your job is to run that prompt once and produce @${agent.name}'s message.

Use this as your system prompt for this one turn:

${systemPrompt}

Workflow node:
${workflow.node || '(none)'}

Workflow instruction:
${workflow.instruction || '(none)'}

Allowed next workflow nodes:
${workflow.next.length > 0 ? workflow.next.map(item => `- ${item.node}: @${item.agent}`).join('\n') : '(none)'}

Routed-from message:
${routedFrom ? `from: ${routedFrom.sender}\nid: ${routedFrom.id}\n${routedFrom.content}` : '(missing)'}
${ignoredMentions.length > 0 ? `\nOverridden mentions:\nThe workflow does not allow the human to enter at ${ignoredMentions.map(target => `@${target}`).join(', ')}, so routing came here instead. Tell the user their mention was overridden.\n` : ''}

Conversation context:
${contextMarkdown(context)}

Now produce ONLY @${agent.name}'s next message. Do not explain the protocol. Do not call tools during this agent turn. If you hand off, mention the target agent at the start of its own paragraph and stop after that handoff. If external work is needed, emit an agent-world-host-action JSON block.`;

  return {
    type: 'agent_instruction',
    world: state.world.name,
    runId: turn.runId,
    turnId: turn.id,
    agent: agent.name,
    role: agent.role,
    contextScope: agent.contextScope,
    contextLimit: contextLimitForAgent(agent),
    dispatch: dispatchSettings(agent),
    reason: turn.reason,
    ignoredMentions,
    workflow,
    routedFrom: routedFrom ? {
      id: routedFrom.id,
      sender: routedFrom.sender,
      content: routedFrom.content
    } : null,
    systemPrompt,
    context,
    hostInstruction: promptForHost,
    responseContract: {
      produce: `one markdown message as @${agent.name}`,
      doNot: [
        'do not answer the original user directly as the host executor',
        'do not run tools during an agent_instruction',
        'do not skip the file-based complete command',
        'do not put the real completion payload on stdout'
      ],
      requestJson: {
        command: 'complete',
        turnId: turn.id,
        content: `one markdown message as @${agent.name}`
      },
      requestPath: handoff.requestPath,
      resultPath: handoff.resultPath,
      completeByRunning: `${relativeCommandBase()} file --request ${handoff.requestPath} --result ${handoff.resultPath}`
    }
  };
}

function buildHostActionInstruction(state, action) {
  const handoff = handoffFilePair(`action-${action.id}`);
  return {
    type: 'host_action',
    world: state.world.name,
    runId: action.runId,
    actionId: action.id,
    requestedBy: action.requestedBy,
    workflowNode: action.workflowNode,
    kind: action.kind,
    reason: action.reason,
    approval: action.approval,
    payload: action.payload,
    hostInstruction: 'You are the host executor. Perform this host action using native tools only if safe and approved. Then report a concise JSON result back to the router. Do not invent success.',
    responseContract: {
      produce: 'JSON host action result',
      suggestedShape: {
        status: 'succeeded | failed | skipped | denied',
        summary: 'what happened',
        artifacts: [],
        stdoutPreview: '',
        stderrPreview: ''
      },
      requestJson: {
        command: 'complete',
        actionId: action.id,
        content: {
          status: 'succeeded | failed | skipped | denied',
          summary: 'what happened',
          artifacts: [],
          stdoutPreview: '',
          stderrPreview: ''
        }
      },
      requestPath: handoff.requestPath,
      resultPath: handoff.resultPath,
      completeByRunning: `${relativeCommandBase()} file --request ${handoff.requestPath} --result ${handoff.resultPath}`
    }
  };
}

function buildBlockedInstruction(state, blocked) {
  return {
    type: 'blocked',
    world: state.world.name,
    runId: blocked.runId,
    reason: blocked.reason,
    code: blocked.code || 'routing_blocked',
    sourceAgent: blocked.sourceAgent || null,
    sourceNode: blocked.sourceNode || null,
    mentions: blocked.mentions || [],
    unresolvedMentions: blocked.unresolvedMentions || [],
    targetNodes: blocked.targetNodes || [],
    allowedNext: blocked.allowedNext || [],
    limit: blocked.limit,
    completedTurns: blocked.completedTurns,
    hostInstruction: 'Report this routing block to the user. Do not continue the Agent World loop until the user gives a new top-level request or fixes the workflow.'
  };
}

function nextInstruction(state) {
  if (state.done) {
    return {
      type: 'done',
      world: state.world.name,
      runId: state.currentRunId,
      final: state.final,
      hostInstruction: 'Return the final answer to the user. Do not continue the Agent World loop.'
    };
  }

  const pendingBlocked = state.pendingRoutingErrors.find(error => isCurrentRun(state, error) && error.status === 'pending');
  if (pendingBlocked) return buildBlockedInstruction(state, pendingBlocked);

  const pendingAction = state.pendingHostActions.find(action => isCurrentRun(state, action) && action.status === 'pending');
  if (pendingAction) return buildHostActionInstruction(state, pendingAction);

  const pendingTurns = state.pendingTurns.filter(turn => isCurrentRun(state, turn) && turn.status === 'pending');

  if (state.workflow.parallelDispatch && pendingTurns.length > 0 && !turnLimitReached(state)) {
    const undispatched = pendingTurns.filter(turn => !turn.dispatched);
    if (undispatched.length === 0) {
      return {
        type: 'idle',
        world: state.world.name,
        runId: state.currentRunId,
        awaitingTurns: pendingTurns.map(turn => turn.id),
        hostInstruction: 'Every pending Agent World turn has already been dispatched. Complete the outstanding turns before asking for more work.'
      };
    }
    if (undispatched.length > 1) {
      for (const turn of undispatched) turn.dispatched = true;
      return {
        type: 'agent_instruction_batch',
        world: state.world.name,
        runId: state.currentRunId,
        turns: undispatched.map(turn => buildAgentInstruction(state, turn)),
        hostInstruction: 'Dispatch every turn in this batch in parallel, one independent subagent per turn. Complete each turn through its own responseContract paths; completions may arrive in any order.'
      };
    }
    undispatched[0].dispatched = true;
    return buildAgentInstruction(state, undispatched[0]);
  }

  const pendingTurn = pendingTurns[0];
  if (pendingTurn && turnLimitReached(state)) {
    pendingTurn.status = 'blocked';
    pendingTurn.blockedAt = now();
    const limit = Number(state.world.turnLimit || 30);
    const blocked = queueRoutingError(state, {
      reason: `Workflow stopped: turn limit ${limit} reached.`,
      code: 'turn_limit_reached',
      sourceMessageId: pendingTurn.sourceMessageId,
      limit,
      completedTurns: state.completedTurns.filter(turn => isCurrentRun(state, turn)).length
    });
    return buildBlockedInstruction(state, blocked || state.pendingRoutingErrors.find(error => isCurrentRun(state, error) && error.status === 'pending'));
  }
  if (pendingTurn) return buildAgentInstruction(state, pendingTurn);

  return {
    type: 'idle',
    world: state.world.name,
    runId: state.currentRunId,
    hostInstruction: 'No pending Agent World work. You may ask for the next request.'
  };
}

function completeTurn(state, turnId, content) {
  const turn = state.pendingTurns.find(item => item.id === turnId);
  if (!turn) throw new Error(`Unknown turn: ${turnId}`);
  if (turn.status !== 'pending') throw new Error(`Turn is not pending: ${turnId}`);
  state.currentRunId = turn.runId;
  turn.status = 'completed';
  turn.dispatched = false;
  turn.completedAt = now();
  state.completedTurns.push({ ...turn });

  const msg = appendMessage(state, turn.agent, content, {
    runId: turn.runId,
    turnId,
    sourceMessageId: turn.sourceMessageId,
    workflowNode: turn.workflowNode || null
  });
  processMessageForRouting(state, msg);
  return msg;
}

function completeAction(state, actionId, content) {
  const action = state.pendingHostActions.find(item => item.id === actionId);
  if (!action) throw new Error(`Unknown action: ${actionId}`);
  if (action.status !== 'pending') throw new Error(`Action is not pending: ${actionId}`);
  state.currentRunId = action.runId;
  action.status = 'completed';
  action.completedAt = now();
  state.completedHostActions.push({ ...action });

  let resultText = String(content || '').trimEnd();
  if (!resultText) resultText = '{"status":"succeeded","summary":"Host action completed."}';

  const hostMessage = `@${action.requestedBy}\n[HOST_ACTION_RESULT ${action.id}]\n${resultText}`;
  const msg = appendMessage(state, 'host', hostMessage, {
    runId: action.runId,
    actionId,
    replyTo: action.requestedBy,
    workflowNode: action.workflowNode || null
  });
  processMessageForRouting(state, msg);
  return msg;
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, obj) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '').replace('Z', 'Z');
}

function handoffFilePair(label) {
  const stamp = timestampSlug();
  const suffix = label ? `-${label}` : '';
  return {
    requestPath: `.agent-world/handoffs/requests/request-${stamp}${suffix}.json`,
    resultPath: `.agent-world/handoffs/responses/result-${stamp}${suffix}.json`
  };
}

function defaultResultPath() {
  return path.join(process.cwd(), '.agent-world', 'handoffs', 'responses', `result-${timestampSlug()}.json`);
}

function requestContent(request) {
  const value = request.content !== undefined
    ? request.content
    : request.message !== undefined
      ? request.message
      : request.input !== undefined
        ? request.input
        : '';

  return typeof value === 'string' ? value : JSON.stringify(value);
}

function instructionAndSave(state) {
  // nextInstruction can mark batched turns dispatched, so build it before persisting.
  const instruction = nextInstruction(state);
  saveState(state);
  return instruction;
}

function executeRouterCommand(config, cmd, args = {}, content = '') {
  if (cmd === 'reset') {
    if (fs.existsSync(activeStatePath)) fs.rmSync(activeStatePath, { force: true });
    const state = newState(config);
    return { type: 'reset', statePath: activeStatePath, configPath: config.configPath, next: instructionAndSave(state) };
  }

  if (cmd === 'init') {
    const state = loadState(config);
    return { type: 'ready', statePath: activeStatePath, configPath: config.configPath, world: state.world.name, next: instructionAndSave(state) };
  }

  const state = loadState(config);

  if (cmd === 'user' || cmd === 'ingest') {
    if (!String(content).trim()) throw new Error('No user message provided.');
    ensureRunForUserMessage(state);
    supersedePendingRoutingErrors(state);
    const msg = appendMessage(state, 'human', content);
    processMessageForRouting(state, msg);
    return instructionAndSave(state);
  }

  if (cmd === 'next') {
    return instructionAndSave(state);
  }

  if (cmd === 'complete') {
    if (args.turn) {
      completeTurn(state, args.turn, content);
      return instructionAndSave(state);
    }
    if (args.action) {
      completeAction(state, args.action, content);
      return instructionAndSave(state);
    }
    throw new Error('complete requires turnId/turn or actionId/action.');
  }

  if (cmd === 'state') return state;

  if (cmd === 'transcript') {
    return {
      type: 'transcript',
      world: state.world.name,
      messages: state.messages.map(message => ({
        id: message.id,
        runId: message.runId,
        sender: message.sender,
        content: message.content,
        metadata: message.metadata
      }))
    };
  }

  throw new Error(`Unknown command: ${cmd}`);
}

function withStatePath(statePath, fn) {
  const previous = activeStatePath;
  activeStatePath = statePath || DEFAULT_STATE_PATH;
  try {
    return fn();
  } finally {
    activeStatePath = previous;
  }
}

function runFileRequest(args) {
  if (!args.request) {
    throw new Error('file mode requires --request .agent-world/handoffs/requests/request-<timestamp>.json');
  }
  const requestPath = path.resolve(args.request);
  const request = readJsonFile(requestPath);
  const resultPath = path.resolve(args.result || request.resultPath || defaultResultPath());
  const configPath = path.resolve(request.configPath || request.config || DEFAULT_CONFIG_PATH);
  const statePath = path.resolve(request.statePath || request.state || DEFAULT_STATE_PATH);
  const cmd = request.command || request.cmd;
  if (!cmd) throw new Error('request JSON is missing command.');

  const result = withStatePath(statePath, () => {
    const config = loadConfig(configPath);
    return executeRouterCommand(config, cmd, {
      turn: request.turnId || request.turn,
      action: request.actionId || request.action
    }, requestContent(request));
  });

  writeJsonFile(resultPath, result);
  process.stdout.write(`agent-world-router: wrote ${path.basename(resultPath)}\n`);
}

function help(config) {
  console.log(`Agent World Router

Commands:
  file --request .agent-world/handoffs/requests/request-<timestamp>.json --result .agent-world/handoffs/responses/result-<timestamp>.json
                               Read structured request JSON and write structured result JSON

Compatibility commands below write structured JSON to stdout. Do not use them
for the Agent World host handoff.

  init                         Create state if missing
  reset                        Delete state and create fresh state
  user --stdin                 Ingest a user message and return next instruction
  next                         Return next instruction
  complete --turn <id> --stdin Complete an agent turn and return next instruction
  complete --action <id> --stdin Complete a host action and return next instruction
  state                        Print raw state
  transcript                   Print messages only

Config path:
  ${config.configPath}

State path:
  ${DEFAULT_STATE_PATH}

Host loop:
  1. Resolve ROUTER relative to the skill folder: scripts/agent-world-router.js
  2. Run from the project/world cwd containing .agent-world/world.json
  3. Write .agent-world/handoffs/requests/request-<timestamp>.json with command and content.
  4. Run node "$ROUTER" file --request .agent-world/handoffs/requests/request-<timestamp>.json --result .agent-world/handoffs/responses/result-<timestamp>.json
  5. Read .agent-world/handoffs/responses/result-<timestamp>.json and execute exactly one returned instruction as the host executor.
  6. Write the next timestamped request file to complete the turn or host action.
  7. Repeat until type=done.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  if (cmd === 'file' || args.request) {
    runFileRequest(args);
    return;
  }

  const config = loadConfig(args.config || DEFAULT_CONFIG_PATH);

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    help(config);
    return;
  }

  if (cmd === 'reset') {
    printJson(executeRouterCommand(config, cmd));
    return;
  }

  if (cmd === 'init') {
    printJson(executeRouterCommand(config, cmd));
    return;
  }

  if (cmd === 'user' || cmd === 'ingest') {
    const content = args.stdin ? await readStdin() : args.message || args.m || '';
    printJson(executeRouterCommand(config, cmd, args, content));
    return;
  }

  if (cmd === 'next') {
    printJson(executeRouterCommand(config, cmd));
    return;
  }

  if (cmd === 'complete') {
    const content = args.stdin ? await readStdin() : args.message || args.m || '';
    printJson(executeRouterCommand(config, cmd, args, content));
    return;
  }

  if (cmd === 'state') {
    printJson(executeRouterCommand(config, cmd));
    return;
  }

  if (cmd === 'transcript') {
    printJson(executeRouterCommand(config, cmd));
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(JSON.stringify({ type: 'error', error: err.message, stack: err.stack }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  CANONICAL_WORKFLOW_TYPES,
  loadConfig,
  validateConfig
};
