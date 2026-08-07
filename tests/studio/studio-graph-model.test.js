/*
  Pure-function coverage for graph derivation and anchor geometry: routing
  vs. `requires` edges, entry and `human` marking, fallback positioning,
  and closest four-border anchor selection across node movement and sizes.
  Loaded via ./_workflow.js (in-memory esbuild bundle) since this module has
  no React dependency and needs no browser.
*/
const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWorkflow } = require('./_workflow.js');

function baseWorld() {
  return {
    world: { id: 'w', name: 'w' },
    workflow: {
      type: 'custom-dag',
      entry: 'n1',
      entryAgent: 'pm',
      nodes: {
        n1: { agent: 'pm', instruction: 'start the flow' },
        n2: { agent: 'dev', instruction: 'build it' },
        n3: { agent: 'qa', requires: ['n2'], instruction: 'review it' }
      },
      edges: {
        human: ['n1'],
        n1: ['n2'],
        n2: ['n3']
      }
    },
    agents: {
      pm: { role: 'product_manager', promptPath: 'prompts/pm.md' },
      dev: { role: 'engineer', promptPath: 'prompts/dev.md' },
      qa: { role: 'qa_reviewer', promptPath: 'prompts/qa.md' }
    }
  };
}

const EMPTY_LAYOUT = { version: 1, nodes: {} };

test('routing edges and requires prerequisites derive distinctly', () => {
  const { deriveGraph } = loadWorkflow();
  const graph = deriveGraph(baseWorld(), EMPTY_LAYOUT);

  const routingEdges = graph.edges.filter(e => e.kind === 'routing');
  const requiresEdges = graph.edges.filter(e => e.kind === 'requires');

  assert.equal(routingEdges.length, 3);
  assert.equal(requiresEdges.length, 1);
  assert.equal(requiresEdges[0].source, 'n2');
  assert.equal(requiresEdges[0].target, 'n3');
  assert.ok(!requiresEdges.some(re => routingEdges.some(oe => oe.id === re.id)));
});

test('the entry node and the human source derive correctly', () => {
  const { deriveGraph, HUMAN_NODE_ID } = loadWorkflow();
  const graph = deriveGraph(baseWorld(), EMPTY_LAYOUT);

  const entryNode = graph.nodes.find(n => n.id === 'n1');
  assert.equal(entryNode.isEntry, true);
  assert.ok(graph.nodes.every(n => n.id === 'n1' || n.isEntry === false));

  const humanNode = graph.nodes.find(n => n.id === HUMAN_NODE_ID);
  assert.ok(humanNode, 'human source should derive as a distinct node');
  assert.equal(humanNode.kind, 'humanEntry');
  assert.ok(graph.edges.some(e => e.kind === 'routing' && e.source === HUMAN_NODE_ID && e.target === 'n1'));
});

test('a world with no human routing source derives no human entry node', () => {
  const { deriveGraph, HUMAN_NODE_ID } = loadWorkflow();
  const world = baseWorld();
  delete world.workflow.edges.human;
  const graph = deriveGraph(world, EMPTY_LAYOUT);
  assert.ok(!graph.nodes.some(n => n.id === HUMAN_NODE_ID));
});

test('nodes absent from the layout still receive positions', () => {
  const { deriveGraph } = loadWorkflow();
  const world = baseWorld();
  const partialLayout = { version: 1, nodes: { n2: { x: 500, y: 500 } } };

  const graph = deriveGraph(world, partialLayout);
  for (const node of graph.nodes) {
    assert.ok(typeof node.position.x === 'number' && typeof node.position.y === 'number');
  }
  const n2 = graph.nodes.find(n => n.id === 'n2');
  assert.deepEqual(n2.position, { x: 500, y: 500 });
});

test('fallback positions are deterministic for the same input', () => {
  const { deriveGraph } = loadWorkflow();
  const world = baseWorld();
  const first = deriveGraph(world, EMPTY_LAYOUT);
  const second = deriveGraph(world, EMPTY_LAYOUT);
  assert.deepEqual(
    first.nodes.map(n => n.position),
    second.nodes.map(n => n.position)
  );
});

test('each node carries its identifier, agent, agent role, and an instruction preview', () => {
  const { deriveGraph } = loadWorkflow();
  const graph = deriveGraph(baseWorld(), EMPTY_LAYOUT);
  const n1 = graph.nodes.find(n => n.id === 'n1');
  assert.equal(n1.agentId, 'pm');
  assert.equal(n1.agentRole, 'product_manager');
  assert.equal(n1.instructionPreview, 'start the flow');
});

test('closest anchors use facing left and right sides for horizontal nodes', () => {
  const { closestAnchorPair } = loadWorkflow();
  const source = { kind: 'workflowNode', position: { x: 0, y: 0 } };
  const target = { kind: 'workflowNode', position: { x: 500, y: 0 } };

  assert.deepEqual(closestAnchorPair(source, target), { source: 'right', target: 'left' });
  assert.deepEqual(closestAnchorPair(target, source), { source: 'left', target: 'right' });
});

test('closest anchors switch between vertical and horizontal sides as a node moves', () => {
  const { closestAnchorPair } = loadWorkflow();
  const source = { kind: 'workflowNode', position: { x: 0, y: 0 } };
  const below = { kind: 'workflowNode', position: { x: 0, y: 300 } };
  const beside = { kind: 'workflowNode', position: { x: 300, y: 0 } };

  assert.deepEqual(closestAnchorPair(source, below), { source: 'bottom', target: 'top' });
  assert.deepEqual(closestAnchorPair(source, beside), { source: 'right', target: 'left' });
});

test('human entry participates in closest-anchor selection with its smaller geometry', () => {
  const { closestAnchorPair } = loadWorkflow();
  const human = { kind: 'humanEntry', position: { x: 0, y: 28 } };
  const workflow = { kind: 'workflowNode', position: { x: 250, y: 0 } };

  assert.deepEqual(closestAnchorPair(human, workflow), { source: 'right', target: 'left' });
});

test('measured dimensions override fallbacks when content changes node height', () => {
  const { closestAnchorPair } = loadWorkflow();
  const source = {
    kind: 'workflowNode',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 240 }
  };
  const target = {
    kind: 'workflowNode',
    position: { x: 260, y: 170 },
    dimensions: { width: 200, height: 90 }
  };

  assert.deepEqual(closestAnchorPair(source, target), { source: 'right', target: 'left' });
});

test('anchor tie selection is deterministic', () => {
  const { closestAnchorPair } = loadWorkflow();
  const source = { kind: 'workflowNode', position: { x: 0, y: 0 } };
  const target = { kind: 'workflowNode', position: { x: 0, y: 0 } };

  assert.deepEqual(closestAnchorPair(source, target), { source: 'top', target: 'top' });
});

test('all four named border anchors are available to node renderers', () => {
  const { ANCHOR_SIDES } = loadWorkflow();
  assert.deepEqual(ANCHOR_SIDES, ['top', 'right', 'bottom', 'left']);
});

test('controlled node projection echoes measured geometry across position rebuilds', () => {
  const { toRFNode } = loadWorkflow();
  const graphNode = {
    id: 'n1',
    kind: 'workflowNode',
    position: { x: 20, y: 30 },
    isEntry: true
  };
  const measured = { width: 200, height: 140 };

  const first = toRFNode(graphNode, false, undefined, measured);
  const moved = toRFNode({ ...graphNode, position: { x: 400, y: 500 } }, false, undefined, measured);

  assert.equal(first.measured, measured);
  assert.equal(moved.measured, measured);
  assert.deepEqual(moved.position, { x: 400, y: 500 });
});

test('Human canvas connections translate back to the persisted routing source', () => {
  const { HUMAN_NODE_ID, HUMAN_SOURCE_KEY, toPersistedRoutingSource } = loadWorkflow();

  assert.equal(toPersistedRoutingSource(HUMAN_NODE_ID), HUMAN_SOURCE_KEY);
  assert.equal(toPersistedRoutingSource('pro'), 'pro');
});
