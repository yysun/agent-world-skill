/*
  Pure-function coverage for src/studio/client/workflow/mutate.ts: the
  referential-integrity operations (add/delete/rename node and agent,
  connect/disconnect edge, set entry) and round-trip preservation of fields
  the panels never expose. Loaded via ./_workflow.js (in-memory esbuild
  bundle) since this module has no React dependency and needs no browser.
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
      enforceEdges: true,
      nodes: {
        n1: { agent: 'pm', instruction: 'start' },
        n2: { agent: 'dev', instruction: 'build' },
        n3: { agent: 'dev', requires: ['n2'], instruction: 'review' }
      },
      edges: {
        human: ['n1'],
        n1: ['n2'],
        n2: ['n3']
      }
    },
    routing: { noMentionFromHumanGoesTo: 'pm' },
    agents: {
      pm: { role: 'product_manager', promptPath: 'prompts/pm.md' },
      dev: { role: 'engineer', promptPath: 'prompts/dev.md' },
      unused: { role: 'spare', promptPath: 'prompts/unused.md' }
    }
  };
}

test('a new node starts referentially clean', () => {
  const { addNode } = loadWorkflow();
  const world = baseWorld();
  const next = addNode(world, 'n4', 'dev', 'do the new thing');

  assert.equal(next.workflow.nodes.n4.agent, 'dev');
  assert.equal(next.workflow.nodes.n4.instruction, 'do the new thing');
  assert.deepEqual(next.workflow.edges, world.workflow.edges);
  assert.deepEqual(next.workflow.nodes.n1, world.workflow.nodes.n1);
});

test('a new agent starts unassigned', () => {
  const { addAgent } = loadWorkflow();
  const world = baseWorld();
  const next = addAgent(world, 'sec', 'prompts/sec.md');

  assert.equal(next.agents.sec.promptPath, 'prompts/sec.md');
  assert.deepEqual(next.workflow.nodes, world.workflow.nodes);
  assert.deepEqual(next.agents.pm, world.agents.pm);
});

test('deleting a node removes every reference to it', () => {
  const { deleteNode } = loadWorkflow();
  const world = baseWorld();
  const next = deleteNode(world, 'n2');

  assert.ok(!('n2' in next.workflow.nodes));
  assert.ok(!('n2' in next.workflow.edges));
  assert.ok(!next.workflow.edges.n1.includes('n2'));
  assert.ok(!(next.workflow.nodes.n3.requires ?? []).includes('n2'));
});

test('deleting the entry node reassigns the entry', () => {
  const { deleteNode } = loadWorkflow();
  const world = baseWorld();
  const next = deleteNode(world, 'n1');

  assert.ok(next.workflow.entry in next.workflow.nodes);
  assert.equal(next.workflow.entryAgent, next.workflow.nodes[next.workflow.entry].agent);
});

test('renaming a node rewrites edges, requires, and the entry', () => {
  const { renameNode } = loadWorkflow();
  const world = baseWorld();
  const next = renameNode(world, 'n2', 'build');

  assert.ok(!('n2' in next.workflow.nodes));
  assert.equal(next.workflow.nodes.build.instruction, 'build');
  assert.deepEqual(next.workflow.edges.n1, ['build']);
  assert.deepEqual(next.workflow.edges.build, ['n3']);
  assert.deepEqual(next.workflow.nodes.n3.requires, ['build']);
});

test('renaming the entry node reassigns entry', () => {
  const { renameNode } = loadWorkflow();
  const world = baseWorld();
  const next = renameNode(world, 'n1', 'start');
  assert.equal(next.workflow.entry, 'start');
});

test('renaming an agent rewrites every assignment', () => {
  const { renameAgent } = loadWorkflow();
  const world = baseWorld();
  const next = renameAgent(world, 'dev', 'engineer2');

  assert.equal(next.workflow.nodes.n2.agent, 'engineer2');
  assert.equal(next.workflow.nodes.n3.agent, 'engineer2');
  assert.ok(!('dev' in next.agents));
  assert.ok('engineer2' in next.agents);
  for (const node of Object.values(next.workflow.nodes)) {
    assert.notEqual(node.agent, 'dev');
  }
});

test('renaming the entry agent reassigns entryAgent', () => {
  const { renameAgent } = loadWorkflow();
  const world = baseWorld();
  const next = renameAgent(world, 'pm', 'product_owner');
  assert.equal(next.workflow.entryAgent, 'product_owner');
});

test('deleting an assigned agent is refused', () => {
  const { deleteAgent } = loadWorkflow();
  const world = baseWorld();
  const result = deleteAgent(world, 'dev');

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockingNodeIds.sort(), ['n2', 'n3']);
});

test('deleting an unreferenced agent succeeds', () => {
  const { deleteAgent } = loadWorkflow();
  const world = baseWorld();
  const result = deleteAgent(world, 'unused');

  assert.equal(result.ok, true);
  assert.ok(!('unused' in result.doc.agents));
  assert.deepEqual(result.doc.workflow.nodes, world.workflow.nodes);
});

test('connecting and disconnecting a routing edge', () => {
  const { connectEdge, disconnectEdge } = loadWorkflow();
  const world = baseWorld();

  const connected = connectEdge(world, 'n1', 'n3');
  assert.ok(connected.workflow.edges.n1.includes('n3'));

  const disconnected = disconnectEdge(connected, 'n1', 'n2');
  assert.ok(!disconnected.workflow.edges.n1.includes('n2'));
  assert.ok(disconnected.workflow.edges.n1.includes('n3'));
});

test('connecting an existing edge does not duplicate it', () => {
  const { connectEdge } = loadWorkflow();
  const world = baseWorld();
  const next = connectEdge(world, 'n1', 'n2');
  assert.deepEqual(next.workflow.edges.n1, ['n2']);
});

test('setting the entry updates both entry and entryAgent', () => {
  const { setEntry } = loadWorkflow();
  const world = baseWorld();
  const next = setEntry(world, 'n3');
  assert.equal(next.workflow.entry, 'n3');
  assert.equal(next.workflow.entryAgent, 'dev');
});

test('mutations preserve fields the panels do not expose', () => {
  const { addNode, connectEdge, renameAgent } = loadWorkflow();
  let world = baseWorld();

  world = addNode(world, 'n4', 'pm');
  world = connectEdge(world, 'n3', 'n4');
  world = renameAgent(world, 'pm', 'product_owner');

  assert.equal(world.workflow.type, 'custom-dag');
  assert.equal(world.workflow.enforceEdges, true);
  assert.equal(world.routing.noMentionFromHumanGoesTo, 'pm');
  assert.deepEqual(world.workflow.edges.human, ['n1']);
  assert.ok(!('additionalField' in world));
});

test('deleteNode, renameNode, updateWorldSettings, and updateAgentSettings preserve fields the panels do not expose', () => {
  const { deleteNode, renameNode, updateWorldSettings, updateAgentSettings } = loadWorkflow();
  let world = baseWorld();

  world = deleteNode(world, 'n2');
  world = renameNode(world, 'n3', 'review');
  world = updateWorldSettings(world, { name: 'renamed-world' });
  world = updateAgentSettings(world, 'dev', { role: 'senior_engineer' });

  assert.equal(world.workflow.type, 'custom-dag');
  assert.equal(world.workflow.enforceEdges, true);
  assert.equal(world.routing.noMentionFromHumanGoesTo, 'pm');
  assert.deepEqual(world.workflow.edges.human, ['n1']);
  assert.equal(world.world.name, 'renamed-world');
  assert.equal(world.agents.dev.role, 'senior_engineer');
});
