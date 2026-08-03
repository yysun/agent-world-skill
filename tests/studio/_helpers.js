/*
  Shared helpers for the Studio server test suites. Not itself a *.test.js
  file, so `node --test tests/studio/*.test.js` never picks it up directly.

  Every suite spawns the built artifact (skills/agent-world/scripts/
  agent-world-studio.js) as a real child process rather than requiring it
  in-process, matching what a real launch does (loopback binding, SIGTERM
  handling, port release) and avoiding cross-test listener accumulation on
  the shared `process` object that repeated in-process `main()` calls would
  cause.
*/
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const builtServerPath = path.resolve(__dirname, '..', '..', 'skills', 'agent-world', 'scripts', 'agent-world-studio.js');

function defaultWorld() {
  return {
    world: { id: 'test-world', name: 'test-world' },
    workflow: {
      type: 'custom-dag',
      entry: 'n1',
      entryAgent: 'pm',
      nodes: { n1: { agent: 'pm' } },
      edges: {}
    },
    agents: { pm: { promptPath: 'prompts/pm.md' } }
  };
}

function makeProject(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  if (options.withWorld === false) return dir;
  const agentWorldDir = path.join(dir, '.agent-world');
  const promptsDir = path.join(agentWorldDir, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  const prompts = options.prompts || { pm: 'You are the PM.\n' };
  for (const [agentId, content] of Object.entries(prompts)) {
    fs.writeFileSync(path.join(promptsDir, `${agentId}.md`), content);
  }
  const world = options.world || defaultWorld();
  fs.writeFileSync(path.join(agentWorldDir, 'world.json'), JSON.stringify(world, null, 2));
  return dir;
}

function startStudio(projectDir, { heartbeatIntervalMs, extraArgs = [] } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (heartbeatIntervalMs) env.STUDIO_HEARTBEAT_INTERVAL_MS = String(heartbeatIntervalMs);
    const child = spawn(
      process.execPath,
      [builtServerPath, '--project', projectDir, '--no-open', '--port', '0', ...extraArgs],
      { stdio: ['ignore', 'pipe', 'pipe'], env }
    );
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timed out waiting for Studio URL.\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    }, 5000);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const match = /https?:\/\/\S+/.exec(stdout);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        const url = new URL(match[0]);
        resolve({
          child,
          origin: url.origin,
          port: Number(url.port),
          token: url.searchParams.get('token')
        });
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    child.on('exit', code => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Studio exited before printing a URL (code ${code}).\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
  });
}

async function stopStudio(handle, signal = 'SIGTERM') {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  handle.child.kill(signal);
  await new Promise(resolve => {
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
      resolve();
      return;
    }
    handle.child.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
}

function parseSessionCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('Response carried no Set-Cookie header.');
  const match = /studio_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error(`Set-Cookie header did not carry studio_session: ${setCookie}`);
  return `studio_session=${match[1]}`;
}

async function handshake(handle) {
  const res = await fetch(`${handle.origin}/?token=${handle.token}`, { redirect: 'manual' });
  return parseSessionCookie(res);
}

module.exports = {
  builtServerPath,
  defaultWorld,
  makeProject,
  startStudio,
  stopStudio,
  parseSessionCookie,
  handshake
};
