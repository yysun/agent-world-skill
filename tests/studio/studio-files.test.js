/*
  Layout separation/round-trip, prompt read/write, path-traversal rejection
  (both "../" and a symbolic link), and no-filesystem-effect for an invalid
  write payload.
*/
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { makeProject, startStudio, stopStudio, handshake, defaultWorld } = require('./_helpers.js');

test('layout persists separately from workflow semantics and world.json carries none of it', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const world = defaultWorld();
    const res = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        world,
        layout: { version: 1, nodes: { n1: { x: 42, y: 7 } }, viewport: { x: 0, y: 0, zoom: 1.5 } }
      })
    });
    assert.equal(res.status, 200);

    const layoutPath = path.join(project, '.agent-world', 'world.layout.json');
    const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
    assert.equal(layout.nodes.n1.x, 42);
    assert.equal(layout.viewport.zoom, 1.5);

    const worldPath = path.join(project, '.agent-world', 'world.json');
    const worldOnDisk = JSON.parse(fs.readFileSync(worldPath, 'utf8'));
    assert.equal('layout' in worldOnDisk, false);
    assert.equal('viewport' in worldOnDisk, false);
    assert.equal('nodes' in worldOnDisk.world, false);
  } finally {
    await stopStudio(handle);
  }
});

test('layout survives a server restart', async () => {
  const project = makeProject();
  let handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        world: defaultWorld(),
        layout: { version: 1, nodes: { n1: { x: 5, y: 6 } }, viewport: { x: 1, y: 1, zoom: 2 } }
      })
    });
  } finally {
    await stopStudio(handle);
  }

  handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const res = await fetch(`${handle.origin}/api/world`, { headers: { Cookie: cookie } });
    const body = await res.json();
    assert.equal(body.layout.nodes.n1.x, 5);
    assert.equal(body.layout.viewport.zoom, 2);
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
