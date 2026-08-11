// Pure event-origin helpers for Canvas layout persistence. React Flow emits
// the same move notifications for user input and programmatic restore, so
// persistence must be decided from provenance rather than changed values.
// Drag-stop nodes and user-armed controls are accepted; unarmed null-event
// initialization/fitView notifications are rejected.
import type { LayoutPosition } from '../../shared/models.js';

export interface PositionedCanvasNode {
  id: string;
  position: LayoutPosition;
}

export function positionsFromDraggedNodes(
  draggedNodes: PositionedCanvasNode[]
): Record<string, LayoutPosition> {
  const positions = Object.create(null) as Record<string, LayoutPosition>;
  for (const node of draggedNodes) positions[node.id] = node.position;
  return positions;
}

export function shouldPersistViewport(
  event: MouseEvent | TouchEvent | null,
  controlViewportChangeArmed: boolean
): boolean {
  return event !== null || controlViewportChangeArmed;
}
