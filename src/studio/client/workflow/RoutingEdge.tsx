// Custom edge renderer for routing edges: draws the solid path (per §17)
// plus an explicit "x" disconnect button at the midpoint (REQ Acceptance
// Criteria -> Graph editing: "disconnect a routing edge"). Deliberately not
// wired through keyboard delete -- React Flow's default delete-key
// handling only acts on edges that echo `selected` back through the
// controlled `edges` prop, which this app does not track, and a visible
// button is also more discoverable than a keyboard shortcut. `requires`
// prerequisites use the plain built-in edge (dashed, no button): they are
// edited through the node property panel instead (plan Decisions ->
// "Editing semantics").
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

export interface RoutingEdgeData {
  onDisconnect?: (source: string, target: string) => void;
  originalSource?: string;
  [key: string]: unknown;
}

export function RoutingEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  target,
  markerEnd,
  data
}: EdgeProps): JSX.Element {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });
  const edgeData = data as RoutingEdgeData | undefined;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="studio-edge-disconnect"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all'
          }}
          onClick={() => edgeData?.onDisconnect?.(edgeData.originalSource ?? '', target)}
          aria-label={`Disconnect ${edgeData?.originalSource ?? ''} to ${target}`}
        >
          x
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
