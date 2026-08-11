// Converts a WorldDocument plus a Layout into the plain graph shape the
// canvas renders (Canvas.tsx maps this into React Flow's own node/edge
// types). Kept free of React and of React Flow's types so it is testable
// without a browser (plan Decisions -> "Testing").
//
// Routing edges and `requires` prerequisites are tagged with a
// discriminating `kind` and never merged into one collection, per
// agent-world-studio-mvp.md §17 (solid routing arrow vs dashed prerequisite
// arrow). Own-property layout reads keep schema-valid identifiers such as
// `__proto__` from being mistaken for inherited object properties. The
// `human` routing source is represented as a distinct
// `humanEntry` node rather than a workflow node (plan Decisions -> "Graph
// model"). Nodes absent from the layout receive a deterministic fallback
// position so a never-laid-out world still renders legibly.
import type { WorldDocument, Layout, LayoutPosition } from '../../shared/models.js';
import { HUMAN_SOURCE_KEY, hasHumanSource } from './model.js';

export const HUMAN_NODE_ID = '__human__';

export type GraphNodeKind = 'workflowNode' | 'humanEntry';
export type GraphEdgeKind = 'routing' | 'requires';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  position: LayoutPosition;
  isEntry: boolean;
  agentId?: string;
  agentRole?: string;
  instructionPreview?: string;
}

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
}

export interface DerivedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const FALLBACK_COLUMNS = 4;
const FALLBACK_COLUMN_WIDTH = 220;
const FALLBACK_ROW_HEIGHT = 140;
const INSTRUCTION_PREVIEW_LENGTH = 80;

function instructionPreview(instruction: string | undefined): string {
  if (!instruction) return '';
  const trimmed = instruction.trim();
  return trimmed.length > INSTRUCTION_PREVIEW_LENGTH
    ? `${trimmed.slice(0, INSTRUCTION_PREVIEW_LENGTH - 3)}...`
    : trimmed;
}

/** Deterministic for a given index: same world always lays out the same way before the user runs layout. */
function fallbackPosition(index: number): LayoutPosition {
  return {
    x: (index % FALLBACK_COLUMNS) * FALLBACK_COLUMN_WIDTH,
    y: Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_ROW_HEIGHT
  };
}

function persistedPosition(layout: Layout, nodeId: string): LayoutPosition | undefined {
  return Object.prototype.hasOwnProperty.call(layout.nodes, nodeId) ? layout.nodes[nodeId] : undefined;
}

export function deriveGraph(doc: WorldDocument, layout: Layout): DerivedGraph {
  const nodeIds = Object.keys(doc.workflow.nodes);

  const nodes: GraphNode[] = nodeIds.map((nodeId, index) => {
    const node = doc.workflow.nodes[nodeId];
    const agent = doc.agents[node.agent];
    return {
      id: nodeId,
      kind: 'workflowNode',
      position: persistedPosition(layout, nodeId) ?? fallbackPosition(index),
      isEntry: nodeId === doc.workflow.entry,
      agentId: node.agent,
      agentRole: agent?.role,
      instructionPreview: instructionPreview(node.instruction)
    };
  });

  if (hasHumanSource(doc)) {
    nodes.push({
      id: HUMAN_NODE_ID,
      kind: 'humanEntry',
      position: persistedPosition(layout, HUMAN_NODE_ID) ?? { x: -FALLBACK_COLUMN_WIDTH, y: 0 },
      isEntry: false
    });
  }

  const edges: GraphEdge[] = [];
  for (const [source, targets] of Object.entries(doc.workflow.edges)) {
    const edgeSource = source === HUMAN_SOURCE_KEY ? HUMAN_NODE_ID : source;
    for (const target of targets) {
      edges.push({ id: `routing-${source}-${target}`, kind: 'routing', source: edgeSource, target });
    }
  }
  for (const [nodeId, node] of Object.entries(doc.workflow.nodes)) {
    for (const requiredId of node.requires ?? []) {
      edges.push({ id: `requires-${requiredId}-${nodeId}`, kind: 'requires', source: requiredId, target: nodeId });
    }
  }

  return { nodes, edges };
}
