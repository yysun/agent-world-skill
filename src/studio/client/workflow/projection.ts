// Pure React Flow projection helpers. They keep measured presentation
// geometry attached to controlled node objects across drag-driven rebuilds
// and translate the synthetic Human canvas id back to the persisted routing
// key without changing workflow semantics.
import type { Node as RFNode } from '@xyflow/react';
import { HUMAN_NODE_ID, type GraphNode } from './derive.js';
import { HUMAN_SOURCE_KEY } from './model.js';
import type { NodeDimensions } from './anchors.js';

export function toRFNode(
  node: GraphNode,
  selected: boolean,
  errorMessages: string[] | undefined,
  measured: NodeDimensions | undefined
): RFNode {
  return {
    id: node.id,
    type: node.kind,
    position: node.position,
    measured,
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

export function toPersistedRoutingSource(sourceId: string): string {
  return sourceId === HUMAN_NODE_ID ? HUMAN_SOURCE_KEY : sourceId;
}
