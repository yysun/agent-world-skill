/*
  Independent atomic layout persistence/restore, malformed and stale layout
  recovery, prompt read/write, path-traversal rejection (both "../" and a
  symbolic link), and no-filesystem-effect for invalid payloads.
*/
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { makeProject, startStudio, stopStudio, handshake, defaultWorld } = require('./_helpers.js');

test('layout persists separately from workflow semantics and world.json carries none of it', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const worldPath = path.join(project, '.agent-world', 'world.json');
    const worldBefore = fs.readFileSync(worldPath, 'utf8');
    const res = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layout: { version: 1, nodes: { n1: { x: 42, y: 7 } }, viewport: { x: 0, y: 0, zoom: 1.5 } },
        expectedRevision: null
      })
    });
    assert.equal(res.status, 200);

    const layoutPath = path.join(project, '.agent-world', 'world.layout.json');
    const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
    assert.equal(layout.nodes.n1.x, 42);
    assert.equal(layout.viewport.zoom, 1.5);

    assert.equal(fs.readFileSync(worldPath, 'utf8'), worldBefore, 'layout autosave must not rewrite world.json');
    const worldOnDisk = JSON.parse(fs.readFileSync(worldPath, 'utf8'));
    assert.equal('layout' in worldOnDisk, false);
    assert.equal('viewport' in worldOnDisk, false);
    assert.equal('nodes' in worldOnDisk.world, false);
    assert.equal(fs.readdirSync(path.dirname(layoutPath)).some(name => name.startsWith('world.layout.json.') && name.endsWith('.tmp')), false);
  } finally {
    await stopStudio(handle);
  }
});

test('layout survives a server restart', async () => {
  const project = makeProject();
  let handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const res = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layout: { version: 1, nodes: { n1: { x: 5, y: 6 } }, viewport: { x: 1, y: 1, zoom: 2 } },
        expectedRevision: null
      })
    });
    assert.equal(res.status, 200);
  } finally {
    await stopStudio(handle);
  }

  handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const res = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } });
    const body = await res.json();
    assert.equal(body.layout.nodes.n1.x, 5);
    assert.equal(body.layout.viewport.zoom, 2);
    assert.match(body.revision, /^[a-f0-9]{64}$/);
  } finally {
    await stopStudio(handle);
  }
});

test('malformed and incompatible layout roots fall back to empty while retaining their raw revision', async () => {
  const project = makeProject();
  const layoutPath = path.join(project, '.agent-world', 'world.layout.json');
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    for (const raw of ['{broken', JSON.stringify({ version: 2, nodes: { n1: { x: 1, y: 2 } } })]) {
      fs.writeFileSync(layoutPath, raw);
      const res = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.layout, { version: 1, nodes: {} });
      assert.equal(body.revision, crypto.createHash('sha256').update(raw).digest('hex'));
    }
  } finally {
    await stopStudio(handle);
  }
});

test('restore keeps valid current entries and drops malformed, stale, and invalid viewport entries', async () => {
  const project = makeProject();
  const layoutPath = path.join(project, '.agent-world', 'world.layout.json');
  const raw = JSON.stringify({
    version: 1,
    nodes: { n1: { x: 8, y: 9 }, ghost: { x: 3, y: 4 }, bad: { x: 'no', y: 1 } },
    viewport: { x: 0, y: 0, zoom: 0 }
  });
  fs.writeFileSync(layoutPath, raw);
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const res = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } });
    const body = await res.json();
    assert.deepEqual(body.layout.nodes, { n1: { x: 8, y: 9 } });
    assert.equal('viewport' in body.layout, false);
    assert.equal(body.revision, crypto.createHash('sha256').update(raw).digest('hex'));
  } finally {
    await stopStudio(handle);
  }
});

test('layout write retains a position for an unsaved node until the matching world is saved', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const putRes = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: { version: 1, nodes: { n2: { x: 20, y: 30 } } }, expectedRevision: null })
    });
    assert.equal(putRes.status, 200);

    let getBody = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } }).then(res => res.json());
    assert.deepEqual(getBody.layout.nodes, {}, 'unknown node stays on disk but is hidden before world save');

    const world = defaultWorld();
    world.workflow.nodes.n2 = { agent: 'pm' };
    const worldRes = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    assert.equal(worldRes.status, 200);

    getBody = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } }).then(res => res.json());
    assert.deepEqual(getBody.layout.nodes.n2, { x: 20, y: 30 });
  } finally {
    await stopStudio(handle);
  }
});

test('a filtered external position survives a viewport save until its world node arrives', async () => {
  const project = makeProject();
  const layoutPath = path.join(project, '.agent-world', 'world.layout.json');
  fs.writeFileSync(
    layoutPath,
    JSON.stringify({ version: 1, nodes: { n1: { x: 1, y: 2 }, n2: { x: 20, y: 30 } } })
  );
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const first = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } }).then(res => res.json());
    assert.deepEqual(first.layout.nodes, { n1: { x: 1, y: 2 } }, 'n2 is hidden until world contains it');

    const putRes = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layout: { ...first.layout, viewport: { x: 3, y: 4, zoom: 1.5 } },
        expectedRevision: first.revision
      })
    });
    assert.equal(putRes.status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(layoutPath, 'utf8')).nodes.n2, { x: 20, y: 30 });

    const world = defaultWorld();
    world.workflow.nodes.n2 = { agent: 'pm' };
    world.workflow.edges.n1 = ['n2'];
    fs.writeFileSync(path.join(project, '.agent-world', 'world.json'), JSON.stringify(world, null, 2));

    const reconciled = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } }).then(res => res.json());
    assert.deepEqual(reconciled.layout.nodes.n2, { x: 20, y: 30 });
  } finally {
    await stopStudio(handle);
  }
});

test('a filtered external position survives pending layout work when its world node arrives first', async () => {
  const project = makeProject();
  const layoutPath = path.join(project, '.agent-world', 'world.layout.json');
  fs.writeFileSync(
    layoutPath,
    JSON.stringify({ version: 1, nodes: { n1: { x: 1, y: 2 }, n2: { x: 50, y: 60 } } })
  );
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const filtered = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } }).then(res => res.json());
    assert.equal(filtered.layout.nodes.n2, undefined);

    const world = defaultWorld();
    world.workflow.nodes.n2 = { agent: 'pm' };
    world.workflow.edges.n1 = ['n2'];
    fs.writeFileSync(path.join(project, '.agent-world', 'world.json'), JSON.stringify(world, null, 2));

    const putRes = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layout: { ...filtered.layout, viewport: { x: 7, y: 8, zoom: 2 } },
        expectedRevision: filtered.revision
      })
    });
    assert.equal(putRes.status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(layoutPath, 'utf8')).nodes.n2, { x: 50, y: 60 });
  } finally {
    await stopStudio(handle);
  }
});

test('explicit replace mode honors Keep Studio Version instead of merging external positions', async () => {
  const project = makeProject();
  const layoutPath = path.join(project, '.agent-world', 'world.layout.json');
  fs.writeFileSync(layoutPath, JSON.stringify({ version: 1, nodes: { n1: { x: 90, y: 91 } } }));
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const external = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } }).then(res => res.json());
    const putRes = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layout: { version: 1, nodes: {}, viewport: { x: 1, y: 2, zoom: 1 } },
        expectedRevision: external.revision,
        mode: 'replace'
      })
    });
    assert.equal(putRes.status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(layoutPath, 'utf8')).nodes, {});
  } finally {
    await stopStudio(handle);
  }
});

test('invalid layout writes are rejected without touching the file', async () => {
  const project = makeProject();
  const layoutPath = path.join(project, '.agent-world', 'world.layout.json');
  fs.writeFileSync(layoutPath, JSON.stringify({ version: 1, nodes: {} }));
  const before = fs.readFileSync(layoutPath, 'utf8');
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const current = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } }).then(res => res.json());
    const res = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: { version: 1, nodes: { n1: { x: 'bad', y: 1 } } }, expectedRevision: current.revision })
    });
    assert.equal(res.status, 400);
    assert.equal(fs.readFileSync(layoutPath, 'utf8'), before);
  } finally {
    await stopStudio(handle);
  }
});

test('a stale raw revision gets 409 and cannot overwrite an external layout change', async () => {
  const project = makeProject();
  const layoutPath = path.join(project, '.agent-world', 'world.layout.json');
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const initial = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } }).then(res => res.json());
    assert.equal(initial.revision, null);
    const external = JSON.stringify({ version: 1, nodes: { n1: { x: 99, y: 88 } } });
    fs.writeFileSync(layoutPath, external);

    const res = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: { version: 1, nodes: { n1: { x: 1, y: 2 } } }, expectedRevision: initial.revision })
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.currentRevision, crypto.createHash('sha256').update(external).digest('hex'));
    assert.equal(fs.readFileSync(layoutPath, 'utf8'), external);
  } finally {
    await stopStudio(handle);
  }
});

test('concurrent writes from the same revision serialize so only one can win', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const request = x => fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: { version: 1, nodes: { n1: { x, y: x } } }, expectedRevision: null })
    });
    const responses = await Promise.all([request(1), request(2)]);
    assert.deepEqual(responses.map(res => res.status).sort(), [200, 409]);
  } finally {
    await stopStudio(handle);
  }
});

test('retrying an already-committed identical layout is idempotent instead of a false conflict', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const candidate = { version: 1, nodes: { n1: { x: 44, y: 55 } } };
    const request = () => fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: candidate, expectedRevision: null })
    });
    const first = await request();
    assert.equal(first.status, 200);
    const firstBody = await first.json();

    const retry = await request();
    assert.equal(retry.status, 200);
    const retryBody = await retry.json();
    assert.equal(retryBody.revision, firstBody.revision);
  } finally {
    await stopStudio(handle);
  }
});

test('malformed JSON sent to the layout endpoint returns a clear 400', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const res = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{not-json'
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.errors[0].message, 'Invalid JSON request body.');
  } finally {
    await stopStudio(handle);
  }
});

test('layout round-trip preserves the schema-valid node id __proto__ as data', async () => {
  const world = defaultWorld();
  Object.defineProperty(world.workflow.nodes, '__proto__', {
    value: { agent: 'pm' },
    enumerable: true,
    configurable: true,
    writable: true
  });
  const project = makeProject({ world });
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const layout = JSON.parse('{"version":1,"nodes":{"__proto__":{"x":17,"y":19}}}');
    const putRes = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout, expectedRevision: null })
    });
    assert.equal(putRes.status, 200);

    const body = await fetch(`${handle.origin}/api/layout`, { headers: { Cookie: cookie } }).then(res => res.json());
    assert.equal(Object.prototype.hasOwnProperty.call(body.layout.nodes, '__proto__'), true);
    assert.deepEqual(body.layout.nodes.__proto__, { x: 17, y: 19 });
  } finally {
    await stopStudio(handle);
  }
});

test('prompt files are read and written by agent id, and the write is delivered over SSE', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);

    const getRes = await fetch(`${handle.origin}/api/prompts/pm`, { headers: { Cookie: cookie } });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.content, 'You are the PM.\n');

    const eventsPromise = (async () => {
      const res = await fetch(`${handle.origin}/api/events`, { headers: { Cookie: cookie } });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.includes('file.changed')) break;
      }
      reader.cancel().catch(() => {});
      return text;
    })();

    await new Promise(resolve => setTimeout(resolve, 200));
    const putRes = await fetch(`${handle.origin}/api/prompts/pm`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Updated PM prompt.' })
    });
    assert.equal(putRes.status, 200);

    const promptPath = path.join(project, '.agent-world', 'prompts', 'pm.md');
    assert.equal(fs.readFileSync(promptPath, 'utf8'), 'Updated PM prompt.');

    const eventText = await eventsPromise;
    assert.match(eventText, /"type":"file\.changed"/);
    assert.match(eventText, /pm\.md/);
  } finally {
    await stopStudio(handle);
  }
});

test('path traversal through a relative promptPath is rejected without reading or writing outside the project', async () => {
  const world = defaultWorld();
  world.workflow.nodes.n2 = { agent: 'evil' };
  world.agents.evil = { promptPath: '../../../etc/escape.md' };
  const project = makeProject({ world, prompts: { pm: 'pm prompt' } });

  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const getRes = await fetch(`${handle.origin}/api/prompts/evil`, { headers: { Cookie: cookie } });
    assert.equal(getRes.status, 400);
    const putRes = await fetch(`${handle.origin}/api/prompts/evil`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'should not land' })
    });
    assert.equal(putRes.status, 400);
  } finally {
    await stopStudio(handle);
  }
});

test('path traversal through a symbolic link is rejected without reading or writing outside the project', async () => {
  const os = require('node:os');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-outside-'));
  fs.writeFileSync(path.join(outsideDir, 'secret.md'), 'secret content');

  const world = defaultWorld();
  world.workflow.nodes.n2 = { agent: 'evil' };
  world.agents.evil = { promptPath: 'prompts/escape-link/secret.md' };
  const project = makeProject({ world, prompts: { pm: 'pm prompt' } });
  fs.symlinkSync(outsideDir, path.join(project, '.agent-world', 'prompts', 'escape-link'));

  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const getRes = await fetch(`${handle.origin}/api/prompts/evil`, { headers: { Cookie: cookie } });
    assert.equal(getRes.status, 400);
    const putRes = await fetch(`${handle.origin}/api/prompts/evil`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'should not land' })
    });
    assert.equal(putRes.status, 400);
    assert.equal(fs.readFileSync(path.join(outsideDir, 'secret.md'), 'utf8'), 'secret content');
  } finally {
    await stopStudio(handle);
  }
});

test('a promptPath escape inside a whole-world save/validate payload is rejected, not just on the dedicated prompt routes', async () => {
  // Regression test: the dedicated /api/prompts/:agentId routes always ran
  // resolveInsideRoots, but PUT /api/world and POST /api/validate originally
  // handed agents.*.promptPath straight to the router's loadConfig (which
  // resolves it with a plain path.resolve and no containment check), so an
  // absolute or `../`-escaping promptPath could reach a durably-written
  // world.json without ever being caught. Fixed in Workspace by checking
  // every agent's promptPath with resolveInsideRoots before validation.
  const project = makeProject();
  const worldPath = path.join(project, '.agent-world', 'world.json');
  const before = fs.readFileSync(worldPath, 'utf8');

  const outsideFile = path.join(require('node:os').tmpdir(), `studio-outside-${process.pid}.md`);
  fs.writeFileSync(outsideFile, 'outside secret');

  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const world = defaultWorld();
    world.workflow.nodes.n2 = { agent: 'leak' };
    world.agents.leak = { promptPath: outsideFile };

    const validateRes = await fetch(`${handle.origin}/api/validate`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    const validateBody = await validateRes.json();
    assert.equal(validateBody.valid, false);
    assert.ok(validateBody.errors.some(e => e.pointer === 'agents.leak.promptPath'), JSON.stringify(validateBody.errors));

    const putRes = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    assert.equal(putRes.status, 400);
    assert.equal(fs.readFileSync(worldPath, 'utf8'), before, 'world.json must not gain the escaping agent');
    assert.equal(fs.existsSync(worldPath + '.tmp'), false);
  } finally {
    await stopStudio(handle);
    fs.rmSync(outsideFile, { force: true });
  }
});

test('reading a prompt whose file was removed outside Studio returns 404, not a 500 leaking the server path', async () => {
  // Regression test: readPrompt originally rethrew fs.readFileSync's raw
  // ENOENT, which Express 5 forwarded to the generic error handler as a 500
  // whose message was the raw Node error (including the absolute server
  // path). A prompt file going missing between saves (e.g. deleted outside
  // Studio) is a legitimate state, not a 500.
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    fs.rmSync(path.join(project, '.agent-world', 'prompts', 'pm.md'));
    const res = await fetch(`${handle.origin}/api/prompts/pm`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.errors[0].message, 'Prompt file not found for agent: pm');
    assert.doesNotMatch(JSON.stringify(body), /\/private|\/tmp\/studio-test-/, 'error must not leak the absolute server path');
  } finally {
    await stopStudio(handle);
  }
});

test('an invalid write payload has no filesystem effect', async () => {
  const project = makeProject();
  const agentWorldDir = path.join(project, '.agent-world');
  const before = fs.readdirSync(agentWorldDir, { recursive: true }).sort();

  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const res = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world: { not: 'a world document' } })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
  } finally {
    await stopStudio(handle);
  }

  const after = fs.readdirSync(agentWorldDir, { recursive: true }).sort();
  assert.deepEqual(after, before);
});
