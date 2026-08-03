// Typed accessors over the in-memory WorldDocument, which is the single
// source of truth for the editor (see plan Decisions -> "Graph model").
// These are thin, non-mutating reads shared by derive.ts (canvas
// projection) and mutate.ts (referential-integrity edits) so both read the
// document the same way. No React dependency: safe to unit test directly.
import type { WorldDocument, WorkflowNode, AgentConfig, WorldSection } from '../../shared/models.js';

export const HUMAN_SOURCE_KEY = 'human';

/** Mirrors world.schema.json's `$defs.id` pattern, enforced at the field before any save round-trip. */
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

export function listNodeIds(doc: WorldDocument): string[] {
  return Object.keys(doc.workflow.nodes);
}

export function getNode(doc: WorldDocument, nodeId: string): WorkflowNode | undefined {
  return doc.workflow.nodes[nodeId];
}

export function listAgentIds(doc: WorldDocument): string[] {
  return Object.keys(doc.agents);
}

export function getAgent(doc: WorldDocument, agentId: string): AgentConfig | undefined {
  return doc.agents[agentId];
}

export function listRoutingSources(doc: WorldDocument): string[] {
  return Object.keys(doc.workflow.edges);
}

export function getRoutingTargets(doc: WorldDocument, source: string): string[] {
  return doc.workflow.edges[source] ?? [];
}

export function getRequires(doc: WorldDocument, nodeId: string): string[] {
  return doc.workflow.nodes[nodeId]?.requires ?? [];
}

export function getWorldSettings(doc: WorldDocument): WorldSection {
  return doc.world;
}

export function getEntry(doc: WorldDocument): string {
  return doc.workflow.entry;
}

export function getEntryAgent(doc: WorldDocument): string {
  return doc.workflow.entryAgent;
}

export function hasHumanSource(doc: WorldDocument): boolean {
  return HUMAN_SOURCE_KEY in doc.workflow.edges;
}

export function nodesAssignedToAgent(doc: WorldDocument, agentId: string): string[] {
  return Object.entries(doc.workflow.nodes)
    .filter(([, node]) => node.agent === agentId)
    .map(([nodeId]) => nodeId);
}

export interface NodeReferences {
  /** Routing edges where this node is the source, as `source -> target` labels. */
  outgoingEdges: string[];
  /** Routing edges where this node is a target, as `source -> target` labels. */
  incomingEdges: string[];
  /** Other node ids whose `requires` names this node. */
  requiredBy: string[];
}

/** Everything a node-deletion confirmation must name so the user knows what else will be removed. */
export function describeNodeReferences(doc: WorldDocument, nodeId: string): NodeReferences {
  const outgoingEdges = (doc.workflow.edges[nodeId] ?? []).map(target => `${nodeId} -> ${target}`);
  const incomingEdges: string[] = [];
  for (const [source, targets] of Object.entries(doc.workflow.edges)) {
    if (source !== nodeId && targets.includes(nodeId)) incomingEdges.push(`${source} -> ${nodeId}`);
  }
  const requiredBy = Object.entries(doc.workflow.nodes)
    .filter(([id, node]) => id !== nodeId && (node.requires ?? []).includes(nodeId))
    .map(([id]) => id);
  return { outgoingEdges, incomingEdges, requiredBy };
}

export type ValidationTargetKind = 'node' | 'agent' | 'world' | 'unknown';

export interface ValidationTarget {
  kind: ValidationTargetKind;
  id?: string;
}

/**
 * Maps a ValidationError's dotted pointer (e.g. `workflow.nodes.n2.agent`,
 * `agents.pm.contextScope`, `world.turnLimit`) to the node, agent, or world
 * settings it names, so the interface can surface the error against that
 * element rather than only listing it. Pointers come from two sources with
 * a common shape: ajv schema errors (validator.ts#validateSchema) and the
 * router's graph-reference errors (agent-world-router.js, re-parsed by
 * validator.ts#parseGraphError) -- both start with `workflow.nodes.<id>`,
 * `workflow.edges.<id>`, `agents.<id>`, or `world`.
 */
export function parseValidationPointer(pointer: string): ValidationTarget {
  const parts = pointer.split('.');
  if (parts[0] === 'workflow' && (parts[1] === 'nodes' || parts[1] === 'edges') && parts[2]) {
    return { kind: 'node', id: parts[2] };
  }
  if (parts[0] === 'agents' && parts[1]) {
    return { kind: 'agent', id: parts[1] };
  }
  if (parts[0] === 'world') {
    return { kind: 'world' };
  }
  return { kind: 'unknown' };
}
