#!/usr/bin/env node
/*
  Generic Agent World router.

  The router is deliberately not an agent executor. It loads agents and the
  workflow graph from agent-world.yaml, persists messages, parses handoff
  mentions / host actions, and returns the next instruction for the host executor.
*/

const fs = require('fs');
const path = require('path');

const ROUTER_COMMAND = 'node "$ROUTER"';
const DEFAULT_STATE_PATH = process.env.AGENT_WORLD_STATE || path.join(process.cwd(), '.agent-world', 'agent-world-state.json');
const DEFAULT_CONFIG_PATH = process.env.AGENT_WORLD_CONFIG || path.join(process.cwd(), 'agent-world.yaml');

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

function yamlIndent(line) {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    return body.split(',').map(item => parseScalar(item.trim()));
  }
  return value;
}

function parseYaml(text) {
  const lines = text.replace(/\t/g, '  ').split(/\r?\n/);
  let index = 0;

  function skipBlank() {
    while (index < lines.length && (/^\s*$/.test(lines[index]) || /^\s*#/.test(lines[index]))) index++;
  }

  function parseKeyValue(trimmed, lineNumber) {
    const match = trimmed.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) throw new Error(`Unsupported YAML syntax near line ${lineNumber}: ${trimmed}`);
    return { key: match[1], rest: match[2] || '' };
  }

  function collectBlockScalar(parentIndent, folded) {
    const block = [];
    while (index < lines.length) {
      const blockLine = lines[index];
      if (/^\s*$/.test(blockLine)) {
        block.push('');
        index++;
        continue;
      }
      const blockIndent = yamlIndent(blockLine);
      if (blockIndent <= parentIndent) break;
      block.push(blockLine.slice(Math.min(blockIndent, parentIndent + 2)));
      index++;
    }
    return folded ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trimEnd();
  }

  function parseBlock(indent) {
    skipBlank();
    if (index >= lines.length) return {};
    const trimmed = lines[index].trim();
    if (yamlIndent(lines[index]) === indent && trimmed.startsWith('- ')) return parseSeq(indent);
    return parseMap(indent);
  }

  function parseValue(rest, currentIndent) {
    if (rest === '|' || rest === '>') return collectBlockScalar(currentIndent, rest === '>');
    if (rest !== '') return parseScalar(rest);
    return parseBlock(currentIndent + 2);
  }

  function parseSeq(indent) {
    const out = [];
    while (index < lines.length) {
      skipBlank();
      if (index >= lines.length) break;
      const line = lines[index];
      const currentIndent = yamlIndent(line);
      const trimmed = line.trim();
      if (currentIndent < indent) break;
      if (currentIndent !== indent || !trimmed.startsWith('- ')) break;

      const rest = trimmed.slice(2).trim();
      index++;

      if (rest === '') {
        out.push(parseBlock(indent + 2));
        continue;
      }

      if (/^[A-Za-z0-9_-]+:/.test(rest)) {
        const item = {};
        const first = parseKeyValue(rest, index);
        item[first.key] = parseValue(first.rest, indent);

        while (index < lines.length) {
          skipBlank();
          if (index >= lines.length) break;
          const childLine = lines[index];
          const childIndent = yamlIndent(childLine);
          const childTrimmed = childLine.trim();
          if (childIndent <= indent) break;
          if (childIndent !== indent + 2 || childTrimmed.startsWith('- ')) break;
          const child = parseKeyValue(childTrimmed, index + 1);
          index++;
          item[child.key] = parseValue(child.rest, childIndent);
        }

        out.push(item);
        continue;
      }

      out.push(parseScalar(rest));
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    while (index < lines.length) {
      skipBlank();
      if (index >= lines.length) break;

      const line = lines[index];
      const currentIndent = yamlIndent(line);
      if (currentIndent < indent) break;
      if (currentIndent > indent) {
        throw new Error(`Invalid YAML indentation near line ${index + 1}: ${line}`);
      }

      const { key, rest } = parseKeyValue(line.trim(), index + 1);
      index++;
      out[key] = parseValue(rest, currentIndent);
    }
    return out;
  }

  return parseBlock(0);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function readPrompt(configDir, agent) {
  if (agent.systemPrompt) return agent.systemPrompt;
  if (agent.promptText) return agent.promptText;

  const promptPath = agent.prompt || agent.promptPath || agent.systemPromptPath;
  if (promptPath) {
    const absolutePromptPath = path.resolve(configDir, promptPath);
    if (fs.existsSync(absolutePromptPath)) {
      return fs.readFileSync(absolutePromptPath, 'utf8').trimEnd();
    }
  }

  return `You are @${agent.name || agent.id}, the ${agent.role || 'agent'} in a host-driven Agent World workflow.

Follow the workflow node instruction, use paragraph-start @mentions for handoffs, and do not execute tools during an agent turn. If host work is needed, emit an agent-world-host-action JSON block.`;
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
    agent.systemPrompt = readPrompt(configDir, agent);
    agents[agent.id] = agent;
  }
  return agents;
}

function normalizeWorkflow(parsed, agents) {
  const raw = parsed.workflow || {};
  const routing = parsed.routing || {};
  const workflow = {
    type: raw.type || 'mention_graph',
    entry: raw.entry || null,
    entryAgent: raw.entryAgent || routing.noMentionFromHumanGoesTo || parsed.world && parsed.world.entryAgent,
    enforceEdges: raw.enforceEdges !== false,
    nodes: {},
    edges: {}
  };

  if (raw.nodes) {
    workflow.nodes = raw.nodes;
    workflow.edges = raw.edges || {};
    return workflow;
  }

  for (const agentId of Object.keys(agents)) {
    workflow.nodes[agentId] = {
      agent: agentId,
      instruction: ''
    };
  }

  let joinCounter = 0;
  for (const edge of Array.isArray(raw.edges) ? raw.edges : []) {
    const fromNodes = asArray(edge.from);
    let toNodes = asArray(edge.to);

    if (edge.join === 'all') {
      toNodes = toNodes.map(to => {
        joinCounter += 1;
        const nodeId = `${to}_join_${joinCounter}`;
        workflow.nodes[nodeId] = {
          agent: to,
          requires: fromNodes,
          instruction: `Join after ${fromNodes.join(', ')} complete.`
        };
        return nodeId;
      });
    }

    for (const from of fromNodes) {
      workflow.edges[from] = [...(workflow.edges[from] || []), ...toNodes];
    }
  }

  if (!workflow.entry) workflow.entry = workflow.entryAgent;
  if (!workflow.entryAgent && workflow.entry && workflow.nodes[workflow.entry]) {
    workflow.entryAgent = workflow.nodes[workflow.entry].agent;
  }
  return workflow;
}

function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing Agent World config: ${configPath}`);
  }
  const parsed = parseYaml(fs.readFileSync(configPath, 'utf8'));
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

  return {
    configPath,
    world,
    workflow,
    agents
  };
}

function newState(config) {
  return {
    version: 2,
    configPath: config.configPath,
    createdAt: now(),
    updatedAt: now(),
    counters: { message: 0, turn: 0, action: 0 },
    world: config.world,
    workflow: config.workflow,
    agents: config.agents,
    messages: [],
    pendingTurns: [],
    pendingHostActions: [],
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
  state.pendingTurns = state.pendingTurns || [];
  state.pendingHostActions = state.pendingHostActions || [];
  state.completedTurns = state.completedTurns || [];
  state.completedHostActions = state.completedHostActions || [];
  return state;
}

function loadState(config) {
  if (!fs.existsSync(DEFAULT_STATE_PATH)) {
    const state = newState(config);
    saveState(state);
    return state;
  }
  return hydrateState(JSON.parse(fs.readFileSync(DEFAULT_STATE_PATH, 'utf8')), config);
}

function saveState(state) {
  state.updatedAt = now();
  ensureDir(DEFAULT_STATE_PATH);
  fs.writeFileSync(DEFAULT_STATE_PATH, JSON.stringify(state, null, 2));
}

function nextId(state, type) {
  state.counters[type] = (state.counters[type] || 0) + 1;
  return `${type}_${String(state.counters[type]).padStart(4, '0')}`;
}

function stripCodeFences(content) {
  return String(content || '').replace(/```[\s\S]*?```/g, '');
}

function agentNames(state) {
  return new Set(Object.keys(state.agents));
}

function extractParagraphMentions(content, state) {
  const names = agentNames(state);
  const text = stripCodeFences(content);
  const mentions = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*@([A-Za-z][A-Za-z0-9_-]*)\b/);
    if (match && names.has(match[1]) && !seen.has(match[1])) {
      seen.add(match[1]);
      mentions.push(match[1]);
    }
  }
  return mentions;
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
      requestedBy: parsed.requestedBy || parsed.requested_by || sender,
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
  return new Set(state.completedTurns.map(turn => turn.workflowNode).filter(Boolean));
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
  if (!sourceNode || !state.workflow.nodes || !state.workflow.edges) return [];
  const nextNodes = state.workflow.edges[sourceNode] || [];
  return nextNodes.filter(nodeId => mentions.includes(agentForNode(state, nodeId)) && nodePrereqsMet(state, nodeId));
}

function queueTurn(state, agent, sourceMessageId, reason = 'mention', workflowNodeId = null) {
  if (!state.agents[agent]) return null;
  if (state.done) return null;
  const alreadyPending = state.pendingTurns.some(turn => (
    turn.status === 'pending' &&
    turn.agent === agent &&
    (turn.workflowNode || null) === (workflowNodeId || null)
  ));
  if (alreadyPending) return null;
  const turn = {
    id: nextId(state, 'turn'),
    type: 'agent_turn',
    agent,
    workflowNode: workflowNodeId,
    sourceMessageId,
    reason,
    status: 'pending',
    createdAt: now()
  };
  state.pendingTurns.push(turn);
  return turn;
}

function queueWorkflowNode(state, nodeId, sourceMessageId, reason) {
  const agent = agentForNode(state, nodeId);
  if (!agent) return null;
  return queueTurn(state, agent, sourceMessageId, reason, nodeId);
}

function processMessageForRouting(state, msg) {
  if (msg.processedForRouting) return;
  msg.processedForRouting = true;

  if (msg.content.includes(state.world.stopToken)) {
    state.done = true;
    state.final = msg.content;
    return;
  }

  const isAgent = Boolean(state.agents[msg.sender]);
  const hostActions = isAgent ? extractHostActions(msg.content, state, msg.sender, msg.metadata) : [];
  if (hostActions.length > 0) {
    state.pendingHostActions.push(...hostActions);
    return;
  }

  const mentions = extractParagraphMentions(msg.content, state);

  if (msg.sender === 'human') {
    if (mentions.length > 0 && state.workflow.nodes) {
      const humanEdges = state.workflow.edges && state.workflow.edges.human;
      const candidates = Object.entries(state.workflow.nodes)
        .filter(([nodeId, node]) => mentions.includes(node.agent) && (!Array.isArray(humanEdges) || humanEdges.includes(nodeId)))
        .map(([nodeId]) => nodeId);
      if (candidates.length > 0) {
        for (const nodeId of candidates) queueWorkflowNode(state, nodeId, msg.id, 'human_mention_workflow_node');
        return;
      }
    }
    if (state.workflow.entry) {
      queueWorkflowNode(state, state.workflow.entry, msg.id, 'entry_workflow_node');
      return;
    }
    const targets = mentions.length > 0 ? mentions : [state.workflow.entryAgent || state.world.entryAgent];
    for (const target of targets) queueTurn(state, target, msg.id, mentions.length > 0 ? 'human_mention' : 'entry_agent');
    return;
  }

  if (isAgent) {
    const currentNode = msg.metadata && msg.metadata.workflowNode;
    const routedNodes = nodesForMentionTargets(state, currentNode, mentions);
    if (routedNodes.length > 0) {
      for (const nodeId of routedNodes) queueWorkflowNode(state, nodeId, msg.id, 'workflow_edge');
      return;
    }

    if (state.workflow.enforceEdges && currentNode) return;

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

function compactContext(state, limit = 18) {
  return state.messages.slice(-limit).map(message => ({
    id: message.id,
    sender: message.sender,
    content: message.content,
    metadata: message.metadata || {}
  }));
}

function contextMarkdown(state, limit = 18) {
  return compactContext(state, limit)
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
  const nextNodes = turn.workflowNode && state.workflow.edges ? state.workflow.edges[turn.workflowNode] || [] : [];
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

function buildAgentInstruction(state, turn) {
  const agent = state.agents[turn.agent];
  const systemPrompt = agent.systemPrompt;
  const context = compactContext(state);
  const routedFrom = messageById(state, turn.sourceMessageId);
  const workflow = workflowHints(state, turn);
  const promptForHost = `You are executing exactly one Agent World turn as @${agent.name}.

The router selected @${agent.name} from agent-world.yaml. The router only provides this dynamic instruction: the selected agent's system prompt, workflow node, allowed next workflow nodes, and persisted context. Your job is to run that prompt once and produce @${agent.name}'s message.

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

Conversation context:
${contextMarkdown(state)}

Now produce ONLY @${agent.name}'s next message. Do not explain the protocol. Do not call tools during this agent turn. If you hand off, mention the target agent at the start of its own paragraph and stop after that handoff. If external work is needed, emit an agent-world-host-action JSON block.`;

  return {
    type: 'agent_instruction',
    world: state.world.name,
    turnId: turn.id,
    agent: agent.name,
    role: agent.role,
    reason: turn.reason,
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
        'do not skip the complete command'
      ],
      completeByRunning: `${relativeCommandBase()} complete --turn ${turn.id} --stdin`
    }
  };
}

function buildHostActionInstruction(state, action) {
  return {
    type: 'host_action',
    world: state.world.name,
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
      completeByRunning: `${relativeCommandBase()} complete --action ${action.id} --stdin`
    }
  };
}

function nextInstruction(state) {
  if (state.done) {
    return {
      type: 'done',
      world: state.world.name,
      final: state.final,
      hostInstruction: 'Return the final answer to the user. Do not continue the Agent World loop.'
    };
  }

  const pendingAction = state.pendingHostActions.find(action => action.status === 'pending');
  if (pendingAction) return buildHostActionInstruction(state, pendingAction);

  const pendingTurn = state.pendingTurns.find(turn => turn.status === 'pending');
  if (pendingTurn) return buildAgentInstruction(state, pendingTurn);

  return {
    type: 'idle',
    world: state.world.name,
    hostInstruction: 'No pending Agent World work. You may ask for the next request.'
  };
}

function completeTurn(state, turnId, content) {
  const turn = state.pendingTurns.find(item => item.id === turnId);
  if (!turn) throw new Error(`Unknown turn: ${turnId}`);
  if (turn.status !== 'pending') throw new Error(`Turn is not pending: ${turnId}`);
  turn.status = 'completed';
  turn.completedAt = now();
  state.completedTurns.push({ ...turn });

  const msg = appendMessage(state, turn.agent, content, { turnId, workflowNode: turn.workflowNode || null });
  processMessageForRouting(state, msg);
  return msg;
}

function completeAction(state, actionId, content) {
  const action = state.pendingHostActions.find(item => item.id === actionId);
  if (!action) throw new Error(`Unknown action: ${actionId}`);
  if (action.status !== 'pending') throw new Error(`Action is not pending: ${actionId}`);
  action.status = 'completed';
  action.completedAt = now();
  state.completedHostActions.push({ ...action });

  let resultText = String(content || '').trimEnd();
  if (!resultText) resultText = '{"status":"succeeded","summary":"Host action completed."}';

  const hostMessage = `@${action.requestedBy}\n[HOST_ACTION_RESULT ${action.id}]\n${resultText}`;
  const msg = appendMessage(state, 'host', hostMessage, {
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

function help(config) {
  console.log(`Agent World Router

Commands:
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
  2. Run from the project/world cwd containing agent-world.yaml
  3. printf '%s' "$USER_MESSAGE" | node "$ROUTER" user --stdin
  4. Execute exactly one returned agent_instruction as the host executor.
  5. Pipe the response to complete --turn <id> --stdin.
  6. Repeat until type=done.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  const config = loadConfig(args.config || DEFAULT_CONFIG_PATH);

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    help(config);
    return;
  }

  if (cmd === 'reset') {
    if (fs.existsSync(DEFAULT_STATE_PATH)) fs.rmSync(DEFAULT_STATE_PATH, { force: true });
    const state = newState(config);
    saveState(state);
    printJson({ type: 'reset', statePath: DEFAULT_STATE_PATH, configPath: config.configPath, next: nextInstruction(state) });
    return;
  }

  if (cmd === 'init') {
    const state = loadState(config);
    saveState(state);
    printJson({ type: 'ready', statePath: DEFAULT_STATE_PATH, configPath: config.configPath, world: state.world.name, next: nextInstruction(state) });
    return;
  }

  const state = loadState(config);

  if (cmd === 'user' || cmd === 'ingest') {
    const content = args.stdin ? await readStdin() : args.message || args.m || '';
    if (!String(content).trim()) throw new Error('No user message provided. Use --stdin or --message.');
    const msg = appendMessage(state, 'human', content);
    processMessageForRouting(state, msg);
    saveState(state);
    printJson(nextInstruction(state));
    return;
  }

  if (cmd === 'next') {
    saveState(state);
    printJson(nextInstruction(state));
    return;
  }

  if (cmd === 'complete') {
    const content = args.stdin ? await readStdin() : args.message || args.m || '';
    if (args.turn) {
      completeTurn(state, args.turn, content);
      saveState(state);
      printJson(nextInstruction(state));
      return;
    }
    if (args.action) {
      completeAction(state, args.action, content);
      saveState(state);
      printJson(nextInstruction(state));
      return;
    }
    throw new Error('complete requires --turn <id> or --action <id>.');
  }

  if (cmd === 'state') {
    printJson(state);
    return;
  }

  if (cmd === 'transcript') {
    printJson({
      type: 'transcript',
      world: state.world.name,
      messages: state.messages.map(message => ({
        id: message.id,
        sender: message.sender,
        content: message.content,
        metadata: message.metadata
      }))
    });
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch(err => {
  console.error(JSON.stringify({ type: 'error', error: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
