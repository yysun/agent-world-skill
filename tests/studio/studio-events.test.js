/*
  SSE event stream: connection, heartbeat, external-change delivery,
  world/layout self-write classification, world.saved payload, and
  single-watcher sharing across concurrent clients.
*/
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { makeProject, startStudio, stopStudio, handshake, defaultWorld } = require('./_helpers.js');

async function collectSse(res, { untilMatches, timeoutMs = 4000 } = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (untilMatches && untilMatches.test(text)) break;
  }
  reader.cancel().catch(() => {});
  return text;
}

test('the event stream stays open and delivers a heartbeat comment', async () => {
  const project = makeProject();
  const handle = await startStudio(project, { heartbeatIntervalMs: 200 });
  try {
    const cookie = await handshake(handle);
    const res = await fetch(`${handle.origin}/api/events`, { headers: { Cookie: cookie } });
    const text = await collectSse(res, { untilMatches: /heartbeat/, timeoutMs: 2000 });
    assert.match(text, /: heartbeat/);
  } finally {
    await stopStudio(handle);
  }
});

test('an external change is delivered as file.changed with source external', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const streamPromise = (async () => {
      const res = await fetch(`${handle.origin}/api/events`, { headers: { Cookie: cookie } });
      return collectSse(res, { untilMatches: /file\.changed/ });
    })();

    await new Promise(resolve => setTimeout(resolve, 200));
    fs.appendFileSync(path.join(project, '.agent-world', 'prompts', 'pm.md'), '\nexternal edit');

    const text = await streamPromise;
    assert.match(text, /"type":"file\.changed"/);
    assert.match(text, /"source":"external"/);
  } finally {
    await stopStudio(handle);
  }
});

test("the server's own save is suppressed to source studio and carries a world.saved hash", async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const streamPromise = (async () => {
      const res = await fetch(`${handle.origin}/api/events`, { headers: { Cookie: cookie } });
      return collectSse(res, { untilMatches: /"source":"studio"/ });
    })();

    await new Promise(resolve => setTimeout(resolve, 200));
    const world = defaultWorld();
    world.world.turnLimit = 11;
    const putRes = await fetch(`${handle.origin}/api/world`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ world })
    });
    const putBody = await putRes.json();

    const text = await streamPromise;
    assert.match(text, new RegExp(`"type":"world\\.saved","hash":"${putBody.hash}"`));
    assert.match(text, /"type":"file\.changed","path":"[^"]*world\.json","source":"studio"/);
  } finally {
    await stopStudio(handle);
  }
});

test('layout autosave is classified as a Studio self-write without publishing world.saved', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const streamPromise = (async () => {
      const res = await fetch(`${handle.origin}/api/events`, { headers: { Cookie: cookie } });
      return collectSse(res, { untilMatches: /world\.layout\.json/ });
    })();

    await new Promise(resolve => setTimeout(resolve, 200));
    const putRes = await fetch(`${handle.origin}/api/layout`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layout: { version: 1, nodes: { n1: { x: 12, y: 34 } } },
        expectedRevision: null
      })
    });
    assert.equal(putRes.status, 200);

    const text = await streamPromise;
    assert.match(text, /"type":"file\.changed","path":"[^"]*world\.layout\.json","source":"studio"/);
    assert.doesNotMatch(text, /"type":"world\.saved"/);
  } finally {
    await stopStudio(handle);
  }
});

test('one watcher and one event bus serve two concurrent clients', async () => {
  const project = makeProject();
  const handle = await startStudio(project);
  try {
    const cookie = await handshake(handle);
    const clientA = (async () => {
      const res = await fetch(`${handle.origin}/api/events`, { headers: { Cookie: cookie } });
      return collectSse(res, { untilMatches: /file\.changed/ });
    })();
    const clientB = (async () => {
      const res = await fetch(`${handle.origin}/api/events`, { headers: { Cookie: cookie } });
      return collectSse(res, { untilMatches: /file\.changed/ });
    })();

    await new Promise(resolve => setTimeout(resolve, 200));
    fs.appendFileSync(path.join(project, '.agent-world', 'prompts', 'pm.md'), '\nshared watcher edit');

    const [textA, textB] = await Promise.all([clientA, clientB]);
    assert.match(textA, /"type":"file\.changed"/);
    assert.match(textB, /"type":"file\.changed"/);
  } finally {
    await stopStudio(handle);
  }
});
