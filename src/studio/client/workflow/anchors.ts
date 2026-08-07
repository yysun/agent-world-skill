// Pure geometry helpers for Studio edge attachment. Nodes expose one handle
// on each border; edge projections call closestAnchorPair after layout or
// drag changes, using React Flow measurements when available and stable
// startup fallbacks before the first dimension observation.
import type { LayoutPosition } from '../../shared/models.js';
import type { GraphNodeKind } from './derive.js';

export const ANCHOR_SIDES = ['top', 'right', 'bottom', 'left'] as const;

export type AnchorSide = (typeof ANCHOR_SIDES)[number];

export interface NodeDimensions {
  width: number;
  height: number;
}

interface NodeGeometry {
  kind: GraphNodeKind;
  position: LayoutPosition;
  dimensions?: NodeDimensions;
}

export interface AnchorPair {
  source: AnchorSide;
  target: AnchorSide;
}

// These mirror the dimensions used by the Studio's node CSS and ELK layout.
// Keeping the calculation independent of React Flow makes it deterministic
// during controlled drag updates and straightforward to unit test.
const FALLBACK_NODE_DIMENSIONS: Record<GraphNodeKind, NodeDimensions> = {
  workflowNode: { width: 200, height: 90 },
  humanEntry: { width: 106, height: 34 }
};

function anchorPoint(node: NodeGeometry, side: AnchorSide): LayoutPosition {
  const { width, height } = node.dimensions ?? FALLBACK_NODE_DIMENSIONS[node.kind];
  const centerX = node.position.x + width / 2;
  const centerY = node.position.y + height / 2;

  switch (side) {
    case 'top':
      return { x: centerX, y: node.position.y };
    case 'right':
      return { x: node.position.x + width, y: centerY };
    case 'bottom':
      return { x: centerX, y: node.position.y + height };
    case 'left':
      return { x: node.position.x, y: centerY };
  }
}

/** Selects the shortest of all 16 side-to-side midpoint combinations. */
export function closestAnchorPair(source: NodeGeometry, target: NodeGeometry): AnchorPair {
  let closest: AnchorPair = { source: 'bottom', target: 'top' };
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const sourceSide of ANCHOR_SIDES) {
    const sourcePoint = anchorPoint(source, sourceSide);
    for (const targetSide of ANCHOR_SIDES) {
      const targetPoint = anchorPoint(target, targetSide);
      const dx = sourcePoint.x - targetPoint.x;
      const dy = sourcePoint.y - targetPoint.y;
      const distance = dx * dx + dy * dy;
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = { source: sourceSide, target: targetSide };
      }
    }
  }

  return closest;
}
