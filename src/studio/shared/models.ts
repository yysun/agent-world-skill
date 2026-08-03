// Shared data shapes for the Agent World Studio server and client.
// These mirror .agent-world/world.json (raw, unnormalized) and the persisted
// layout file. They intentionally do NOT mirror the router's normalized
// runtime config (skills/agent-world/scripts/agent-world-router.js
// loadConfig output), because the Studio API round-trips the raw file
// content, not router-injected defaults.

export interface WorkflowNode {
  agent: string;
  instruction?: string;
  requires?: string[];
}

export type WorkflowEdges = Record<string, string[]>;

export interface AgentConfig {
  name?: string;
  role?: string;
  promptPath: string;
  contextScope?: 'global' | 'agent';
}

export interface WorldSection {
  id: string;
  name: string;
  entryAgent?: string;
  mainAgent?: string;
  stopToken?: string;
  turnLimit?: number;
  mode?: 'host_driven_router_only' | 'host_delegated';
}

export interface WorkflowSection {
  type: string;
  entry: string;
  entryAgent: string;
  enforceEdges?: boolean;
  nodes: Record<string, WorkflowNode>;
  edges: WorkflowEdges;
}

export interface RoutingSection {
  noMentionFromHumanGoesTo?: string;
  stopToken?: string;
}

// Raw shape of .agent-world/world.json. additionalProperties:false in the
// schema at every level, so this must not gain fields the schema omits.
export interface WorldDocument {
  $schema?: string;
  world: WorldSection;
  workflow: WorkflowSection;
  routing?: RoutingSection;
  agents: Record<string, AgentConfig>;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

export interface Layout {
  version: number;
  nodes: Record<string, LayoutPosition>;
  viewport?: { x: number; y: number; zoom: number };
}

export const EMPTY_LAYOUT: Layout = { version: 1, nodes: {} };

export interface ValidationError {
  pointer: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
