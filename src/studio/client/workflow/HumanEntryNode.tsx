// Custom React Flow node rendering the `human` routing source as a
// distinct entry affordance (plan Decisions -> "Graph model"), never as a
// workflow node -- it has no agent, instruction, or `requires` of its own.
import { Handle, Position } from '@xyflow/react';

export function HumanEntryNode(): JSX.Element {
  return (
    <div className="studio-node studio-node--human">
      Human
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
