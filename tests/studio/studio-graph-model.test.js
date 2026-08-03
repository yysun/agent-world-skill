/*
  Pure-function coverage for src/studio/client/workflow/derive.ts: routing
  vs. `requires` edge derivation, entry and `human`-source marking, and
  deterministic fallback positioning for nodes absent from the layout.
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
