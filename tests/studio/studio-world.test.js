/*
  World reading, schema/graph validation, and atomic save/reject behavior.
*/
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { makeProject, startStudio, stopStudio, handshake, defaultWorld } = require('./_helpers.js');

const skillRoot = path.resolve(__dirname, '..', '..', 'skills', 'agent-world');
const router = require(path.join(skillRoot, 'scripts', 'agent-world-router.js'));

async function withStudio(project, fn) {
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    await fn({ handle, cookie });
  } finally {
    await stopStudio(handle);
  }
}

test('reading a world returns nodes, edges, agents, settings, and layout', async () => {
  const world = {
    world: { id: 'w', name: 'w', turnLimit: 5, stopToken: '<world>pass</world>', mode: 'host_delegated' },
    workflow: {
      type: 'custom-dag',
      entry: 'n1',
      entryAgent: 'pm',
      nodes: {
        n1: { agent: 'pm', instruction: 'start' },
        n2: { agent: 'dev', requires: ['n1'], instruction: 'build' }
      },
      edges: { n1: ['n2'] }
    },
    agents: {
      pm: { name: 'PM', role: 'product_manager', promptPath: 'prompts/pm.md', contextScope: 'global' },
      dev: { name: 'Dev', role: 'engineer', promptPath: 'prompts/dev.md', contextScope: 'agent' }
    }
  };
  const project = makeProject({ world, prompts: { pm: 'pm prompt', dev: 'dev prompt' } });
  fs.writeFileSync(
    path.join(project, '.agent-world', 'world.layout.json'),
    JSON.stringify({ version: 1, nodes: { n1: { x: 1, y: 2 } }, viewport: { x: 0, y: 0, zoom: 1 } })
  );

  await withStudio(project, async ({ handle, cookie }) => {
    const res = await fetch(`${handle.origin}/api/world`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.exists, true);
    assert.equal(body.world.workflow.nodes.n2.requires[0], 'n1');
    assert.deepEqual(body.world.workflow.edges.n1, ['n2']);
    assert.equal(body.world.agents.dev.contextScope, 'agent');
    assert.equal(body.world.world.turnLimit, 5);
    assert.equal(body.layout.nodes.n1.x, 1);
    assert.equal(body.layout.viewport.zoom, 1);
  });
});

test('a project with no world file reports the world absent, not an error', async () => {
  const project = makeProject({ withWorld: false });
  await withStudio(project, async ({ handle, cookie }) => {
    const res = await fetch(`${handle.origin}/api/world`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.exists, false);
    assert.equal(body.world, null);
    assert.deepEqual(body.layout.nodes, {});
  });
});

test('schema violations are reported against the offending field', async () => {
  const project = makeProject();
  await withStudio(project, async ({ handle, cookie }) => {
    const world = defaultWorld();
    world.world.turnLimit = 'not-a-number';
    const res = await fetch(`${handle.origin}/api/validate`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.valid, false);
    assert.ok(body.errors.some(e => e.pointer.includes('turnLimit')), JSON.stringify(body.errors));
  });
});

test('a missing edge target is reported against the edge', async () => {
  const project = makeProject();
  await withStudio(project, async ({ handle, cookie }) => {
    const world = defaultWorld();
    world.workflow.edges = { n1: ['ghost'] };
    const res = await fetch(`${handle.origin}/api/validate`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    const body = await res.json();
    assert.equal(body.valid, false);
    assert.ok(body.errors.some(e => e.message.includes('n1') && e.message.includes('ghost')), JSON.stringify(body.errors));
  });
});

test('an undefined node agent is reported against the node', async () => {
  const project = makeProject();
  await withStudio(project, async ({ handle, cookie }) => {
    const world = defaultWorld();
    world.workflow.nodes.n2 = { agent: 'nobody' };
    const res = await fetch(`${handle.origin}/api/validate`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    const body = await res.json();
    assert.equal(body.valid, false);
    assert.ok(body.errors.some(e => e.message.includes('n2') && e.message.includes('nobody')), JSON.stringify(body.errors));
  });
});

test('a missing prerequisite is reported against the node', async () => {
  const project = makeProject();
  await withStudio(project, async ({ handle, cookie }) => {
    const world = defaultWorld();
    world.workflow.nodes.n1.requires = ['no_such_node'];
    const res = await fetch(`${handle.origin}/api/validate`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    const body = await res.json();
    assert.equal(body.valid, false);
    assert.ok(body.errors.some(e => e.message.includes('n1') && e.message.includes('no_such_node')), JSON.stringify(body.errors));
  });
});

test('saving a valid world is atomic, leaves no temp file, and is router-loadable', async () => {
  const project = makeProject();
  await withStudio(project, async ({ handle, cookie }) => {
    const world = defaultWorld();
    world.world.turnLimit = 9;
    const res = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.hash && body.hash.length === 64);

    const agentWorldDir = path.join(project, '.agent-world');
    assert.equal(fs.existsSync(path.join(agentWorldDir, 'world.json.tmp')), false);
    assert.doesNotThrow(() => router.loadConfig(path.join(agentWorldDir, 'world.json')));
  });
});

test('a schema-invalid save leaves the project untouched with no temp file', async () => {
  const project = makeProject();
  const worldPath = path.join(project, '.agent-world', 'world.json');
  await withStudio(project, async ({ handle, cookie }) => {
    const before = fs.readFileSync(worldPath, 'utf8');
    const world = defaultWorld();
    world.world.turnLimit = 'bad';
    const res = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors.length > 0);
    assert.equal(fs.readFileSync(worldPath, 'utf8'), before);
    assert.equal(fs.existsSync(worldPath + '.tmp'), false);
  });
});

test('a graph-invalid save leaves the project untouched with no temp file', async () => {
  const project = makeProject();
  const worldPath = path.join(project, '.agent-world', 'world.json');
  await withStudio(project, async ({ handle, cookie }) => {
    const before = fs.readFileSync(worldPath, 'utf8');
    const world = defaultWorld();
    world.workflow.edges = { n1: ['ghost'] };
    const res = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    assert.equal(res.status, 400);
    assert.equal(fs.readFileSync(worldPath, 'utf8'), before);
    assert.equal(fs.existsSync(worldPath + '.tmp'), false);
  });
});

test('the first save into an empty project is router-loadable', async () => {
  const project = makeProject({ withWorld: false });
  fs.mkdirSync(path.join(project, '.agent-world', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(project, '.agent-world', 'prompts', 'pm.md'), 'pm prompt');

  await withStudio(project, async ({ handle, cookie }) => {
    const world = defaultWorld();
    const res = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    assert.equal(res.status, 200);
    const worldPath = path.join(project, '.agent-world', 'world.json');
    assert.equal(fs.existsSync(worldPath), true);
    assert.doesNotThrow(() => router.loadConfig(worldPath));
  });
});

test('round-tripping preserves fields no editor exposes and introduces no injected default', async () => {
  const world = defaultWorld();
  world.workflow.enforceEdges = true;
  world.routing = { noMentionFromHumanGoesTo: 'pm' };
  world.agents.pm.contextScope = 'agent';
  const project = makeProject({ world });

  await withStudio(project, async ({ handle, cookie }) => {
    const getRes = await fetch(`${handle.origin}/api/world`, { headers: { Cookie: cookie } });
    const { world: readWorld } = await getRes.json();

    const putRes = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world: readWorld })
    });
    assert.equal(putRes.status, 200);

    const written = JSON.parse(fs.readFileSync(path.join(project, '.agent-world', 'world.json'), 'utf8'));
    assert.equal(written.workflow.enforceEdges, true);
    assert.equal(written.routing.noMentionFromHumanGoesTo, 'pm');
    assert.equal(written.agents.pm.contextScope, 'agent');
    // The original file never set world.stopToken/mode; loadConfig injects
    // defaults for those at read time, but they must not leak into the
    // written file simply from round-tripping the raw JSON.
    assert.equal('stopToken' in written.world, false);
    assert.equal('mode' in written.world, false);
  });
});

test('concurrent validations do not clobber each other', async () => {
  const project = makeProject();
  await withStudio(project, async ({ handle, cookie }) => {
    // The client validates as the user edits, so several requests can be in
    // flight within the same millisecond. Each needs its own scratch file:
    // when they shared one, the first to finish deleted the file the others
    // were still reading, and they failed with "Missing Agent World config:
    // ...world.json.validate-<pid>-<ms>.tmp" instead of a real result.
    const results = await Promise.all(
      Array.from({ length: 24 }, () =>
        fetch(`${handle.origin}/api/validate`, {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ world: defaultWorld() })
        }).then(res => res.json())
      )
    );
    for (const body of results) {
      assert.equal(body.valid, true, JSON.stringify(body.errors));
    }
    // Every scratch file is cleaned up, whatever the interleaving was.
    const leftovers = fs.readdirSync(path.join(project, '.agent-world')).filter(name => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  });
});
