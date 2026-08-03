// Referential-integrity operations on a WorldDocument (plan Decisions ->
// "Editing semantics": integrity is maintained at edit time, not left to
// validation). Every function returns a new document; none mutate their
// input, so React state can treat the result as a fresh value. No React
// dependency: safe to unit test directly.
//
// Node deletion cascades (it carries no content of its own beyond what the
// caller authored on the node itself: edges and `requires` are pure
// references). Agent deletion never cascades to workflow nodes -- a node
// carries an authored instruction, so deleting an agent that is still
// assigned is refused rather than silently destroying nodes.
import type { WorldDocument, WorldSection, AgentConfig } from '../../shared/models.js';
import { nodesAssignedToAgent } from './model.js';

export type DeleteAgentResult =
  | { ok: true; doc: WorldDocument }
  | { ok: false; blockingNodeIds: string[] };

function cloneDoc(doc: WorldDocument): WorldDocument {
  return structuredClone(doc);
}

/** Picks a deterministic fallback entry when the current entry node is deleted or renamed away. */
function firstRemainingNodeId(doc: WorldDocument): string | undefined {
  return Object.keys(doc.workflow.nodes)[0];
}

/** Builds a minimal, schema-valid world document for a project that has none yet. */
export function createInitialWorldDocument(nodeId: string, agentId: string, promptPath: string): WorldDocument {
  return {
    world: { id: 'world', name: 'world' },
    workflow: {
      type: 'custom-dag',
      entry: nodeId,
      entryAgent: agentId,
      nodes: { [nodeId]: { agent: agentId } },
      edges: {}
    },
    agents: { [agentId]: { promptPath } }
  };
}

export function addNode(doc: WorldDocument, nodeId: string, agentId: string, instruction?: string): WorldDocument {
  const next = cloneDoc(doc);
  next.workflow.nodes[nodeId] = instruction ? { agent: agentId, instruction } : { agent: agentId };
  return next;
}

export function addAgent(doc: WorldDocument, agentId: string, promptPath: string): WorldDocument {
  const next = cloneDoc(doc);
  next.agents[agentId] = { promptPath };
  return next;
}

/** Removes `nodeId` from every routing edge it appears in, as both source and target, and from every `requires` list. */
function stripNodeReferences(next: WorldDocument, nodeId: string): void {
  delete next.workflow.edges[nodeId];
  for (const source of Object.keys(next.workflow.edges)) {
    next.workflow.edges[source] = next.workflow.edges[source].filter(target => target !== nodeId);
  }
  for (const node of Object.values(next.workflow.nodes)) {
    if (!node.requires) continue;
    const filtered = node.requires.filter(id => id !== nodeId);
    if (filtered.length > 0) node.requires = filtered;
    else delete node.requires;
  }
}

function reassignEntryIfNeeded(next: WorldDocument, removedNodeId: string): void {
  if (next.workflow.entry !== removedNodeId) return;
  const fallback = firstRemainingNodeId(next);
  if (!fallback) return;
  next.workflow.entry = fallback;
  next.workflow.entryAgent = next.workflow.nodes[fallback].agent;
}

export function deleteNode(doc: WorldDocument, nodeId: string): WorldDocument {
  const next = cloneDoc(doc);
  if (!(nodeId in next.workflow.nodes)) return next;
  delete next.workflow.nodes[nodeId];
  stripNodeReferences(next, nodeId);
  reassignEntryIfNeeded(next, nodeId);
  return next;
}

export function renameNode(doc: WorldDocument, oldId: string, newId: string): WorldDocument {
  const next = cloneDoc(doc);
  const node = next.workflow.nodes[oldId];
  if (!node || oldId === newId) return next;

  delete next.workflow.nodes[oldId];
  next.workflow.nodes[newId] = node;

  if (oldId in next.workflow.edges) {
    next.workflow.edges[newId] = next.workflow.edges[oldId];
    delete next.workflow.edges[oldId];
  }
  for (const source of Object.keys(next.workflow.edges)) {
    next.workflow.edges[source] = next.workflow.edges[source].map(target => (target === oldId ? newId : target));
  }
  for (const n of Object.values(next.workflow.nodes)) {
    if (n.requires) n.requires = n.requires.map(id => (id === oldId ? newId : id));
  }
  if (next.workflow.entry === oldId) next.workflow.entry = newId;

  return next;
}

export function renameAgent(doc: WorldDocument, oldId: string, newId: string): WorldDocument {
  const next = cloneDoc(doc);
  const agent = next.agents[oldId];
  if (!agent || oldId === newId) return next;

  delete next.agents[oldId];
  next.agents[newId] = agent;
  for (const node of Object.values(next.workflow.nodes)) {
    if (node.agent === oldId) node.agent = newId;
  }
  if (next.workflow.entryAgent === oldId) next.workflow.entryAgent = newId;

  return next;
}

/** Refuses (rather than cascades) when any workflow node is still assigned to `agentId`. */
export function deleteAgent(doc: WorldDocument, agentId: string): DeleteAgentResult {
  const blockingNodeIds = nodesAssignedToAgent(doc, agentId);
  if (blockingNodeIds.length > 0) {
    return { ok: false, blockingNodeIds };
  }
  const next = cloneDoc(doc);
  delete next.agents[agentId];
  return { ok: true, doc: next };
}

export function connectEdge(doc: WorldDocument, source: string, target: string): WorldDocument {
  const next = cloneDoc(doc);
  const existing = next.workflow.edges[source] ?? [];
  next.workflow.edges[source] = existing.includes(target) ? existing : [...existing, target];
  return next;
}

export function disconnectEdge(doc: WorldDocument, source: string, target: string): WorldDocument {
  const next = cloneDoc(doc);
  if (!next.workflow.edges[source]) return next;
  next.workflow.edges[source] = next.workflow.edges[source].filter(t => t !== target);
  return next;
}

/** Sets the workflow entry node and keeps entryAgent consistent with that node's assigned agent. */
export function setEntry(doc: WorldDocument, nodeId: string): WorldDocument {
  const next = cloneDoc(doc);
  const node = next.workflow.nodes[nodeId];
  if (!node) return next;
  next.workflow.entry = nodeId;
  next.workflow.entryAgent = node.agent;
  return next;
}

export function setNodeAgent(doc: WorldDocument, nodeId: string, agentId: string): WorldDocument {
  const next = cloneDoc(doc);
  const node = next.workflow.nodes[nodeId];
  if (!node) return next;
  node.agent = agentId;
  return next;
}

export function setNodeInstruction(doc: WorldDocument, nodeId: string, instruction: string): WorldDocument {
  const next = cloneDoc(doc);
  const node = next.workflow.nodes[nodeId];
  if (!node) return next;
  if (instruction) node.instruction = instruction;
  else delete node.instruction;
  return next;
}

export function setRequires(doc: WorldDocument, nodeId: string, requires: string[]): WorldDocument {
  const next = cloneDoc(doc);
  const node = next.workflow.nodes[nodeId];
  if (!node) return next;
  if (requires.length > 0) node.requires = requires;
  else delete node.requires;
  return next;
}

export function updateWorldSettings(doc: WorldDocument, patch: Partial<WorldSection>): WorldDocument {
  const next = cloneDoc(doc);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete (next.world as unknown as Record<string, unknown>)[key];
    else (next.world as unknown as Record<string, unknown>)[key] = value;
  }
  return next;
}

export function updateAgentSettings(doc: WorldDocument, agentId: string, patch: Partial<AgentConfig>): WorldDocument {
  const next = cloneDoc(doc);
  const agent = next.agents[agentId];
  if (!agent) return next;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete (agent as unknown as Record<string, unknown>)[key];
    else (agent as unknown as Record<string, unknown>)[key] = value;
  }
  return next;
}
