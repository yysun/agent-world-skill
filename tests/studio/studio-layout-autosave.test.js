/*
  Pure controller coverage for layout autosave debounce, serialization,
  latest-snapshot retention, conflict pause/resolution, failure retry, and
  stale-completion discard. The TypeScript module is bundled in memory so
  the tests exercise production code without a browser-only test runtime.
*/
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const esbuild = require('esbuild');

function loadModule(relativePath) {
  const entry = path.resolve(__dirname, '..', '..', 'src', 'studio', 'client', relativePath);
  const result = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent'
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const { LayoutAutosaveController, LayoutConflictError } = loadModule('state/layoutAutosave.ts');
const {
  conflictKindForDirtyResources,
  isCurrentConflictVersion,
  mergeConflictKind
} = loadModule('state/conflictKinds.ts');
const { positionsFromDraggedNodes, shouldPersistViewport } = loadModule('workflow/canvasPersistence.ts');
const { OperationGeneration } = loadModule('state/operationGeneration.ts');

const layout = x => ({ version: 1, nodes: { n1: { x, y: x } } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('debounce persists only the newest rapid layout snapshot', async () => {
  const calls = [];
  const controller = new LayoutAutosaveController(async (snapshot, revision) => {
    calls.push({ snapshot, revision });
    return { revision: 'saved-1' };
  }, { debounceMs: 15 });
  controller.restoreRevision(null);

  controller.schedule(layout(1));
  controller.schedule(layout(2));
  controller.schedule(layout(3));
  await wait(40);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { snapshot: layout(3), revision: null });
  controller.dispose();
});

test('writes are serialized and a newer pending snapshot uses the prior response revision', async () => {
  const first = deferred();
  const calls = [];
  const controller = new LayoutAutosaveController((snapshot, revision) => {
    calls.push({ snapshot, revision });
    return calls.length === 1 ? first.promise : Promise.resolve({ revision: 'saved-2' });
  }, { debounceMs: 5 });
  controller.restoreRevision('base');

  controller.schedule(layout(1));
  controller.flush();
  await wait(0);
  controller.schedule(layout(2));
  controller.flush();
  assert.equal(calls.length, 1, 'second write must not begin while the first is active');

  first.resolve({ revision: 'saved-1' });
  await wait(20);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { snapshot: layout(2), revision: 'saved-1' });
  controller.dispose();
});

test('a failed write retains the latest snapshot and explicit retry persists it', async () => {
  const calls = [];
  const statuses = [];
  const controller = new LayoutAutosaveController(async (snapshot, revision) => {
    calls.push({ snapshot, revision });
    if (calls.length === 1) throw new Error('disk unavailable');
    return { revision: 'saved' };
  }, { debounceMs: 5, onStatus: status => statuses.push(status) });
  controller.restoreRevision('base');

  controller.schedule(layout(7));
  controller.flush();
  await wait(10);
  assert.ok(statuses.some(status => status.phase === 'error' && status.unsaved && status.error === 'disk unavailable'));

  controller.schedule(layout(8));
  assert.equal(statuses.at(-1).phase, 'error', 'a later edit must not hide the retryable failure');
  assert.equal(statuses.at(-1).error, 'disk unavailable');
  controller.retry();
  await wait(15);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { snapshot: layout(8), revision: 'base' });
  assert.equal(statuses.at(-1).phase, 'idle');
  assert.equal(statuses.at(-1).unsaved, false);
  controller.dispose();
});

test('drain chains the newest pending snapshot after an older active write', async () => {
  const first = deferred();
  const calls = [];
  const controller = new LayoutAutosaveController((snapshot, revision) => {
    calls.push({ snapshot, revision });
    return calls.length === 1 ? first.promise : Promise.resolve({ revision: 'saved-2' });
  }, { debounceMs: 1000 });
  controller.restoreRevision('base');
  controller.schedule(layout(1));
  controller.flush();
  await wait(0);
  controller.schedule(layout(2));
  controller.drain();

  first.resolve({ revision: 'saved-1' });
  await wait(10);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { snapshot: layout(2), revision: 'saved-1' });
  controller.dispose();
});

test('a restore generation does not strand a layout scheduled while an obsolete request finishes', async () => {
  const first = deferred();
  const calls = [];
  const controller = new LayoutAutosaveController((snapshot, revision) => {
    calls.push({ snapshot, revision });
    return calls.length === 1 ? first.promise : Promise.resolve({ revision: 'saved-new' });
  }, { debounceMs: 5 });
  controller.restoreRevision('base');
  controller.schedule(layout(1));
  controller.flush();
  await wait(0);

  controller.restoreRevision('external');
  controller.schedule(layout(2));
  first.resolve({ revision: 'obsolete' });
  await wait(20);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { snapshot: layout(2), revision: 'external' });
  controller.dispose();
});

test('revision conflict pauses the retained snapshot until Keep supplies the external revision', async () => {
  const calls = [];
  const statuses = [];
  const controller = new LayoutAutosaveController(async (snapshot, revision) => {
    calls.push({ snapshot, revision });
    if (calls.length === 1) throw new LayoutConflictError('external');
    return { revision: 'kept' };
  }, { debounceMs: 5, onStatus: status => statuses.push(status) });
  controller.restoreRevision('base');

  controller.schedule(layout(9));
  controller.flush();
  await wait(10);
  assert.equal(statuses.at(-1).phase, 'conflict');
  assert.equal(calls.length, 1);

  controller.resolveConflict('external');
  await wait(15);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { snapshot: layout(9), revision: 'external' });
  assert.equal(statuses.at(-1).phase, 'idle');
  controller.dispose();
});

test('normal autosave merges hidden positions while explicit Keep requests replacement', async () => {
  const calls = [];
  const controller = new LayoutAutosaveController(async (snapshot, revision, mode) => {
    calls.push({ snapshot, revision, mode });
    if (calls.length === 1) throw new LayoutConflictError('external');
    return { layout: snapshot, revision: 'kept' };
  }, { debounceMs: 5 });
  controller.restoreRevision('base');
  controller.schedule(layout(12));
  controller.flush();
  await wait(10);
  assert.equal(calls[0].mode, 'merge');

  controller.resolveConflict('external');
  await wait(15);
  assert.equal(calls[1].mode, 'replace');
  controller.dispose();
});

test('Keep during an active save invalidates its completion and issues a replacement', async () => {
  const active = deferred();
  const calls = [];
  const controller = new LayoutAutosaveController((snapshot, revision, mode) => {
    calls.push({ snapshot, revision, mode });
    return calls.length === 1
      ? active.promise
      : Promise.resolve({ layout: snapshot, revision: 'replaced' });
  }, { debounceMs: 5 });
  controller.restoreRevision('base');
  controller.schedule(layout(21));
  controller.flush();
  await wait(0);

  controller.pause();
  controller.resolveConflict('external', layout(21));
  active.resolve({ layout: layout(21), revision: 'obsolete-active-response' });
  await wait(20);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { snapshot: layout(21), revision: 'external', mode: 'replace' });
  controller.dispose();
});

test('external conflict capture stays dirty when an active success arrives before delayed Keep', async () => {
  const active = deferred();
  const calls = [];
  const statuses = [];
  const controller = new LayoutAutosaveController((snapshot, revision, mode) => {
    calls.push({ snapshot, revision, mode });
    return calls.length === 1
      ? active.promise
      : Promise.resolve({ layout: snapshot, revision: 'replaced' });
  }, { debounceMs: 5, onStatus: status => statuses.push(status) });
  controller.restoreRevision('base');
  controller.schedule(layout(22));
  controller.flush();
  await wait(0);

  controller.pauseForExternalConflict(layout(22));
  active.resolve({ layout: layout(22), revision: 'obsolete-active-response' });
  await wait(10);
  assert.equal(statuses.at(-1).unsaved, true);

  controller.resolveConflict('external', layout(22));
  await wait(15);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { snapshot: layout(22), revision: 'external', mode: 'replace' });
  controller.dispose();
});

test('resolving an external revision without a retained canvas edit never writes layout', async () => {
  const calls = [];
  const controller = new LayoutAutosaveController(async (snapshot, revision) => {
    calls.push({ snapshot, revision });
    return { revision: 'unexpected' };
  }, { debounceMs: 5 });
  controller.restoreRevision('base');

  controller.pause();
  controller.resolveConflict('external');
  await wait(15);

  assert.deepEqual(calls, []);
  controller.dispose();
});

test('pause blocks queued writes and discard invalidates an issued completion', async () => {
  const active = deferred();
  const calls = [];
  const statuses = [];
  const controller = new LayoutAutosaveController((snapshot, revision) => {
    calls.push({ snapshot, revision });
    return active.promise;
  }, { debounceMs: 5, onStatus: status => statuses.push(status) });
  controller.restoreRevision('base');

  controller.schedule(layout(4));
  controller.pause();
  await wait(10);
  assert.equal(calls.length, 0);
  controller.resume();
  await wait(10);
  assert.equal(calls.length, 1);

  const discard = controller.discard();
  active.resolve({ revision: 'obsolete' });
  await discard;
  assert.equal(statuses.at(-1).phase, 'idle');
  assert.equal(statuses.at(-1).unsaved, false);
  controller.dispose();
});

test('unresolved world and layout conflict sources accumulate without later events erasing either', () => {
  assert.equal(mergeConflictKind(null, 'layout'), 'layout');
  assert.equal(mergeConflictKind('world', 'world'), 'world');
  assert.equal(mergeConflictKind('layout', 'layout'), 'layout');
  assert.equal(mergeConflictKind('world', 'layout'), 'both');
  assert.equal(mergeConflictKind('layout', 'world'), 'both');
  assert.equal(mergeConflictKind('both', 'world'), 'both');
  assert.equal(mergeConflictKind('layout', 'both'), 'both');
  assert.equal(isCurrentConflictVersion(4, 4), true);
  assert.equal(isCurrentConflictVersion(5, 4), false, 'a newer event invalidates an older async Keep/Reload action');
});

test('reconnect conflicts only for dirty resources', () => {
  assert.equal(conflictKindForDirtyResources(false, false), null);
  assert.equal(conflictKindForDirtyResources(true, false), 'world');
  assert.equal(conflictKindForDirtyResources(false, true), 'layout');
  assert.equal(conflictKindForDirtyResources(true, true), 'both');
});

test('canvas persistence accepts drag-stop positions without prototype collisions', () => {
  const positions = positionsFromDraggedNodes([
    { id: 'n1', position: { x: 10, y: 20 } },
    { id: '__proto__', position: { x: 30, y: 40 } }
  ]);
  assert.deepEqual(positions.n1, { x: 10, y: 20 });
  assert.equal(Object.prototype.hasOwnProperty.call(positions, '__proto__'), true);
  assert.deepEqual(positions.__proto__, { x: 30, y: 40 });
});

test('viewport persistence rejects unarmed programmatic moves and accepts user origins', () => {
  assert.equal(shouldPersistViewport(null, false), false, 'restore and automatic fitView must not write');
  assert.equal(shouldPersistViewport(null, true), true, 'a Controls zoom/fit action arms its null event');
  assert.equal(shouldPersistViewport({}, false), true, 'direct pointer or touch pan/zoom persists');
});

test('a newer drag, semantic edit, or reload invalidates an older Auto layout result', () => {
  const operations = new OperationGeneration();
  const autoLayoutGeneration = operations.current();
  assert.equal(operations.isCurrent(autoLayoutGeneration), true);
  operations.invalidate();
  assert.equal(operations.isCurrent(autoLayoutGeneration), false);
});

test('automatic layout preserves the schema-valid node id __proto__ as an own position', async () => {
  const { computeAutoLayout } = loadModule('workflow/layout.ts');
  const nodes = { n1: { agent: 'pm' } };
  Object.defineProperty(nodes, '__proto__', {
    value: { agent: 'pm' },
    enumerable: true
  });
  const world = {
    world: { id: 'w', name: 'w' },
    workflow: {
      type: 'custom-dag',
      entry: 'n1',
      entryAgent: 'pm',
      nodes,
      edges: { n1: [] }
    },
    agents: { pm: { promptPath: 'prompts/pm.md' } }
  };

  const positions = await computeAutoLayout(world, { version: 1, nodes: {} });
  assert.equal(Object.prototype.hasOwnProperty.call(positions, '__proto__'), true);
  assert.equal(typeof positions.__proto__.x, 'number');
  assert.equal(typeof positions.__proto__.y, 'number');
});
