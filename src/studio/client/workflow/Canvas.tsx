// Renders the derived graph (derive.ts) as a React Flow canvas. The world
// document plus layout are the source of truth (plan Decisions -> "Graph
// model"); this component never holds authoritative graph state of its own
// -- it re-derives on every doc/layout change and reports interactions
// (position drags, connections, selection) upward through callbacks for
// the caller to apply to the world document.
//
// Renders no execution status and exposes no run/stop/continue control,
// per REQ Non-Goals and agent-world-studio-mvp.md §19.
import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeChange,
  type NodeMouseHandler,
  type OnConnect,
  type OnMoveEnd,
  type Viewport
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorldDocument, Layout, LayoutPosition, ValidationError } from '../../shared/models.js';
import { deriveGraph, HUMAN_NODE_ID, type GraphNode } from './derive.js';
import { HUMAN_SOURCE_KEY, parseValidationPointer } from './model.js';
import { WorkflowNodeCard } from './WorkflowNodeCard.js';
import { HumanEntryNode } from './HumanEntryNode.js';
import { RoutingEdge } from './RoutingEdge.js';

const nodeTypes = {
  workflowNode: WorkflowNodeCard,
  humanEntry: HumanEntryNode
};

const edgeTypes = {
  routing: RoutingEdge
};

export interface CanvasProps {
  doc: WorldDocument;
  layout: Layout;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onNodePositionsChange?: (positions: Record<string, LayoutPosition>) => void;
  onConnect?: (source: string, target: string) => void;
  onDisconnect?: (source: string, target: string) => void;
  onViewportChange?: (viewport: Viewport) => void;
  validationErrors?: ValidationError[];
}

function toRFNode(node: GraphNode, selected: boolean, errorMessages: string[] | undefined): RFNode {
  return {
    id: node.id,
    type: node.kind,
    position: node.position,
    selected,
    data: {
      agentId: node.agentId,
      agentRole: node.agentRole,
      instructionPreview: node.instructionPreview,
      isEntry: node.isEntry,
      errorMessages
    }
  };
}

function groupErrorsByNode(validationErrors: ValidationError[]): Map<string, string[]> {
  const byNode = new Map<string, string[]>();
  for (const err of validationErrors) {
    const target = parseValidationPointer(err.pointer);
    if (target.kind !== 'node' || !target.id) continue;
    const existing = byNode.get(target.id) ?? [];
    existing.push(err.message);
    byNode.set(target.id, existing);
  }
  return byNode;
}

export function Canvas({
  doc,
  layout,
  selectedNodeId,
  onSelectNode,
  onNodePositionsChange,
  onConnect,
  onDisconnect,
  onViewportChange,
  validationErrors = []
}: CanvasProps): JSX.Element {
  const { nodes: graphNodes, edges: graphEdges } = useMemo(() => deriveGraph(doc, layout), [doc, layout]);
  const errorsByNode = useMemo(() => groupErrorsByNode(validationErrors), [validationErrors]);

  const rfNodes: RFNode[] = useMemo(
    () => graphNodes.map(n => toRFNode(n, n.id === selectedNodeId, errorsByNode.get(n.id))),
    [graphNodes, selectedNodeId, errorsByNode]
  );

  const rfEdges: RFEdge[] = useMemo(
    () =>
      graphEdges.map(e => {
        const originalSource = e.source === HUMAN_NODE_ID ? HUMAN_SOURCE_KEY : e.source;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.kind === 'routing' ? 'routing' : 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
          style: e.kind === 'requires' ? { strokeDasharray: '6 4' } : undefined,
          data: { kind: e.kind, originalSource, onDisconnect }
        };
      }),
    [graphEdges, onDisconnect]
  );

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (node.type === 'humanEntry') return;
    onSelectNode(node.id);
  };

  const handlePaneClick = (): void => onSelectNode(null);

  const handleNodesChange = (changes: NodeChange[]): void => {
    if (!onNodePositionsChange) return;
    const positions: Record<string, LayoutPosition> = {};
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        positions[change.id] = change.position;
      }
    }
    if (Object.keys(positions).length > 0) onNodePositionsChange(positions);
  };

  const handleConnect: OnConnect = connection => {
    if (!onConnect || !connection.source || !connection.target) return;
    if (connection.target === HUMAN_NODE_ID) return;
    onConnect(connection.source, connection.target);
  };

  const handleMoveEnd: OnMoveEnd = (_event, viewport) => {
    onViewportChange?.(viewport);
  };

  return (
    <div className="studio-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onMoveEnd={handleMoveEnd}
        defaultViewport={layout.viewport}
        fitView={!layout.viewport}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
