// Automatic layout via ELK.js, invoked only on an explicit user action
// (plan Decisions -> "Layout": never automatic on load, since that would
// silently overwrite hand-arranged positions the REQ requires to survive a
// restart). Uses the browser-safe bundled ELK build (no Web Worker), which
// is the variant elkjs recommends for bundlers.
//
// Both routing and `requires` edges are fed into the layered algorithm
// (decided empirically in Phase 6, once elkjs was installed): `requires`
// expresses "must complete before," so treating it as a layout edge only
// ever pushes a prerequisite into an earlier layer than the node that
// depends on it -- the same direction a reader expects from a dashed
// arrow. Excluding it risks a prerequisite rendering to the right of (after)
// the node it gates, which would read backwards. Tried against
// `world.example.json`: with `requires` included, `final`'s two
// prerequisites (`qa_review`, `security_review`) resolve to the same layer
// as `final`'s other routing predecessors, producing a single clean
// left-to-right layering; excluding them made no visible difference for
// that example specifically because its `requires` already mirror existing
// routing edges, but the inclusion is the safer default for graphs where
// they don't. Output uses a null-prototype dictionary so every schema-valid
// node id, including `__proto__`, is persisted as data.
import type { WorldDocument, Layout, LayoutPosition } from '../../shared/models.js';
import { deriveGraph } from './derive.js';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 90;

// Loaded on demand rather than at module scope: ELK's bundled layout engine
// is large, and this function only runs when the user explicitly invokes
// layout, so there is no reason to grow the initial page load for it.
export async function computeAutoLayout(doc: WorldDocument, layout: Layout): Promise<Record<string, LayoutPosition>> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  const { nodes, edges } = deriveGraph(doc, layout);

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100'
    },
    children: nodes.map(n => ({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] }))
  };

  const result = await elk.layout(elkGraph);
  const positions = Object.create(null) as Record<string, LayoutPosition>;
  for (const child of result.children ?? []) {
    if (typeof child.x === 'number' && typeof child.y === 'number') {
      positions[child.id] = { x: child.x, y: child.y };
    }
  }
  return positions;
}
