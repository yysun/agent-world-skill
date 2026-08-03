// Custom React Flow node renderer for a workflow node: identifier, assigned
// agent, agent role, and an instruction preview (REQ Acceptance Criteria ->
// Rendering), plus an entry badge when this node is the workflow entry.
// Deliberately renders no execution status (idle/running/completed/...):
// those belong to run observation, out of scope for this story (REQ
// Non-Goals).
import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface WorkflowNodeData {
  agentId?: string;
  agentRole?: string;
  instructionPreview?: string;
  isEntry?: boolean;
  errorMessages?: string[];
  [key: string]: unknown;
}

export function WorkflowNodeCard({ id, data }: NodeProps): JSX.Element {
  const nodeData = data as WorkflowNodeData;
  const hasError = !!nodeData.errorMessages?.length;
  return (
    <div className={`studio-node${nodeData.isEntry ? ' studio-node--entry' : ''}${hasError ? ' studio-node--error' : ''}`}>
      <Handle type="target" position={Position.Top} />
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
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
