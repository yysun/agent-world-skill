// Custom React Flow node rendering the `human` routing source as a distinct
// entry affordance with four border handles for dynamic edge attachment.
// It remains a routing source, never a workflow node or valid edge target.
import { Handle, Position } from '@xyflow/react';
import { ANCHOR_SIDES, type AnchorSide } from './anchors.js';

const HANDLE_POSITIONS: Record<AnchorSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left
};

export function HumanEntryNode(): JSX.Element {
  return (
    <div className="studio-node studio-node--human">
      Human
      {ANCHOR_SIDES.map(side => (
        <Handle key={side} id={side} type="source" position={HANDLE_POSITIONS[side]} />
      ))}
    </div>
  );
}
