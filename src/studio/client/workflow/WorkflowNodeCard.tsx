// Custom React Flow renderer for a workflow node: identifier, assigned
// agent, role, instruction preview, entry/error state, and one connection
// handle on each border for dynamic closest-anchor edge routing.
// Deliberately renders no execution status (idle/running/completed/...):
// those belong to run observation, out of scope for this story (REQ
// Non-Goals).
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ANCHOR_SIDES, type AnchorSide } from './anchors.js';

export interface WorkflowNodeData {
  agentId?: string;
  agentRole?: string;
  instructionPreview?: string;
  isEntry?: boolean;
  errorMessages?: string[];
  [key: string]: unknown;
}

const HANDLE_POSITIONS: Record<AnchorSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left
};

export function WorkflowNodeCard({ id, data }: NodeProps): JSX.Element {
  const nodeData = data as WorkflowNodeData;
  const hasError = !!nodeData.errorMessages?.length;
  return (
    <div className={`studio-node${nodeData.isEntry ? ' studio-node--entry' : ''}${hasError ? ' studio-node--error' : ''}`}>
      {ANCHOR_SIDES.map(side => (
        <Handle key={side} id={side} type="source" position={HANDLE_POSITIONS[side]} />
      ))}
      {nodeData.isEntry && <span className="studio-node__entry-badge">Entry</span>}
      <div className="studio-node__id">{id}</div>
      <div className="studio-node__agent">{nodeData.agentId ?? '(unassigned)'}</div>
      {nodeData.agentRole && <div className="studio-node__role">{nodeData.agentRole}</div>}
      {nodeData.instructionPreview && <div className="studio-node__instruction">{nodeData.instructionPreview}</div>}
      {hasError && (
        <div className="studio-node__error" role="alert">
          {nodeData.errorMessages!.join('; ')}
        </div>
      )}
    </div>
  );
}
