/*
  Ownership-boundary tests: asserts, rather than assumes, that Studio never
  becomes a second agent host (REQ "Ownership boundary"; plan Decisions ->
  "Ownership boundary is enforced, not assumed").
*/
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { makeProject, startStudio, stopStudio, handshake, builtServerPath } = require('./_helpers.js');

test('no run-control or shell endpoint is a registered route', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const forbidden = [
      ['POST', '/api/runs'],
      ['POST', '/api/runs/run_0001/stop'],
      ['POST', '/api/runs/run_0001/continue'],
      ['POST', '/api/shell']
    ];
    for (const [method, route] of forbidden) {
      const res = await fetch(`${handle.origin}${route}`, { method, headers: { Cookie: cookie } });
      assert.equal(res.status, 404, `${method} ${route} must not be a registered route`);
    }
  } finally {
    await stopStudio(handle);
  }
});

test('the built bundle contains no invocation of the router execution commands', () => {
  const source = fs.readFileSync(builtServerPath, 'utf8');
  for (const command of ['user', 'next', 'complete', 'file']) {
    assert.doesNotMatch(
      source,
      new RegExp(`cmd\\s*===\\s*['"]${command}['"]`),
      `bundle must not invoke the router's "${command}" command`
    );
  }
  assert.match(source, /loadConfig/, 'bundle should reference loadConfig, the one router capability Studio uses');
  assert.doesNotMatch(source, /\/api\/runs/, 'bundle must not define an /api/runs route string');
  assert.doesNotMatch(source, /\/api\/shell/, 'bundle must not define an /api/shell route string');
});
