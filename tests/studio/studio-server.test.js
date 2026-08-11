/*
  Studio server: startup/shutdown, loopback binding, and token enforcement.

  Runs against the built artifact skills/agent-world/scripts/
  agent-world-studio.js, spawned as a real child process per test.
*/
const assert = require('node:assert/strict');
const test = require('node:test');
const { makeProject, startStudio, stopStudio, handshake } = require('./_helpers.js');

test('prints a loopback URL with a token and serves the workspace after handshake', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    assert.equal(new URL(handle.origin).hostname, '127.0.0.1');
    assert.ok(handle.token && handle.token.length > 0, 'expected a non-empty session token');

    const cookie = await handshake(handle);
    const res = await fetch(`${handle.origin}/api/workspace`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.hasWorld, true);
    assert.ok(body.projectRoot.endsWith(require('node:path').basename(project)));
  } finally {
    await stopStudio(handle);
  }
});

test('the token handshake sets an HttpOnly SameSite=Strict cookie and redirects to /', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const res = await fetch(`${handle.origin}/?token=${handle.token}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
  } finally {
    await stopStudio(handle);
  }
});

test('API requests without a valid session are rejected with 401 and no content', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const noCookie = await fetch(`${handle.origin}/api/world`);
    assert.equal(noCookie.status, 401);
    const noCookieBody = await noCookie.json();
    assert.ok(!('world' in noCookieBody));

    const wrongCookie = await fetch(`${handle.origin}/api/world`, {
      headers: { Cookie: 'studio_session=not-the-real-token' }
    });
    assert.equal(wrongCookie.status, 401);
  } finally {
    await stopStudio(handle);
  }
});

test('every implemented /api/* route including /api/events requires a session; static assets do not', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const routes = [
      ['GET', '/api/workspace'],
      ['GET', '/api/world'],
      ['PUT', '/api/world'],
      ['GET', '/api/layout'],
      ['PUT', '/api/layout'],
      ['POST', '/api/validate'],
      ['GET', '/api/prompts/pm'],
      ['PUT', '/api/prompts/pm'],
      ['GET', '/api/events']
    ];
    for (const [method, route] of routes) {
      const res = await fetch(`${handle.origin}${route}`, { method });
      assert.equal(res.status, 401, `${method} ${route} should require a session`);
    }

    const staticRes = await fetch(`${handle.origin}/`);
    assert.equal(staticRes.status, 200, 'static index should be reachable without a session');
  } finally {
    await stopStudio(handle);
  }
});

test('SIGTERM shuts down cleanly, releasing the port with no hang', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  const { port } = handle;
  await stopStudio(handle, 'SIGTERM');

  assert.notEqual(handle.child.exitCode, null, 'process should have exited');

  // Port must be free again: a fresh listener on the same port should succeed.
  const net = require('node:net');
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => {
      probe.close(resolve);
    });
  });
});
