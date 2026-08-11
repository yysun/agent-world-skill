// Dev loop for Studio. Nothing here writes to the committed build artifacts
// (skills/agent-world/scripts/agent-world-studio.js, skills/agent-world/
// studio/dist/) -- those stay as last released until you run `npm run build`.
//
//   npm run dev -- ../test-dir
//   npm run dev -- ../test-dir --port 5173 --no-open
//
// (npm swallows the first `--`; an extra one is harmless -- both
// `npm run dev -- ../test-dir` and `npm run dev -- -- ../test-dir` work.)
//
// The client runs on a real vite dev server with HMR, straight from
// src/studio/client -- no bundle, no dist. The API server is bundled by
// esbuild into .dev/ (gitignored) and restarted when its sources change;
// STUDIO_SKILL_DIR points it back at the real skill directory so it still
// resolves world.schema.json and the router from there. Vite proxies /api
// and the ?token= handshake to it, so the browser sees one origin and the
// session cookie works exactly as it does in a released build.
//
// The session token is fixed for the life of the dev loop, so a server
// restart doesn't expire the browser's session -- the URL stays good.
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(root, 'src/studio/server/cli.ts');
const SKILL_DIR = path.join(root, 'skills/agent-world');
const DEV_DIR = path.join(root, '.dev');
const SERVER_OUT = path.join(DEV_DIR, 'studio-server.cjs');

// Strip the bare `--` separators npm leaves behind, then split off the flags
// this script owns: --port is the browser-facing vite port, and --no-open is
// handled here because only this script knows the URL worth opening. Every
// other argument is forwarded to the Studio CLI untouched.
const args = process.argv.slice(2).filter(arg => arg !== '--');
const serverArgs = [];
let uiPort;
let open = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') uiPort = Number(args[++i]);
  else if (args[i] === '--no-open') open = false;
  else serverArgs.push(args[i]);
}

// npm runs scripts from the package root regardless of where they were
// invoked, so `.` and other relative targets are resolved here, against the
// directory the user actually typed the command in (INIT_CWD), before the
// path is handed to the Studio CLI. With no target at all, that directory is
// the default -- `npm run dev` alone means "this project".
const invokedFrom = process.env.INIT_CWD || process.cwd();

function resolveTarget(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') {
      argv[i + 1] = path.resolve(invokedFrom, argv[i + 1] ?? '.');
      return argv[i + 1];
    }
    if (!argv[i].startsWith('-')) {
      argv[i] = path.resolve(invokedFrom, argv[i]);
      return argv[i];
    }
  }
  argv.push(invokedFrom);
  return invokedFrom;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]];
  try {
    spawn(command[0], command[1], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Opening a browser is a convenience; the URL is printed either way.
  }
}

// The API server is an implementation detail here: the browser only ever
// talks to vite, which proxies through. Pinning the port keeps that proxy
// target valid across server restarts.
const project = resolveTarget(serverArgs);
const apiPort = await freePort();
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const sessionToken = crypto.randomBytes(32).toString('hex');
const serverEnv = { ...process.env, STUDIO_SKILL_DIR: SKILL_DIR, STUDIO_SESSION_TOKEN: sessionToken };

let studio = null;
let restarting = Promise.resolve();
let started = false;
let lastServerHash = null;

function startStudio() {
  const child = spawn(
    process.execPath,
    [SERVER_OUT, ...serverArgs, '--port', String(apiPort), '--no-open'],
    { cwd: root, env: serverEnv, stdio: ['inherit', 'pipe', 'inherit'] }
  );
  child.expected = false;
  studio = child;
  started = true;
  // The server prints its own 127.0.0.1:<apiPort> URL on startup, which is
  // the wrong one to open in this setup -- swallow just that line and pass
  // everything else through.
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!/^http:\/\/127\.0\.0\.1:\d+\/\?token=/.test(line)) console.log(line);
    }
  });
  child.once('exit', (code, signal) => {
    // A restart marks the exit expected; anything else is fatal.
    if (child.expected) return;
    console.error(`[dev] Studio server exited (code ${code}, signal ${signal ?? 'none'}).`);
    void shutdown(code ?? 1);
  });
}

function stopStudio() {
  const child = studio;
  studio = null;
  if (!child || child.exitCode !== null) return Promise.resolve();
  child.expected = true;
  return new Promise(resolve => {
    // A server child that doesn't honor SIGTERM must not be able to outlive
    // this loop: a stray one keeps holding its port and its file watcher.
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => { clearTimeout(force); resolve(); });
    child.kill('SIGTERM');
  });
}

function restartStudio() {
  restarting = restarting.then(async () => {
    await stopStudio();
    console.log('[dev] server changed -- restarting (the browser session survives)');
    startStudio();
  });
  return restarting;
}

fs.mkdirSync(DEV_DIR, { recursive: true });

const serverBuild = await esbuild.context({
  entryPoints: [SERVER_ENTRY],
  outfile: SERVER_OUT,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: 'inline',
  logLevel: 'info',
  plugins: [
    {
      name: 'restart-studio',
      setup(build) {
        build.onEnd(result => {
          if (result.errors.length > 0) return;
          // Restart only when the output's bytes actually changed. Entering
          // watch mode replays a build of the already-current sources, and a
          // save that doesn't affect the output shouldn't cost a restart.
          const hash = crypto.createHash('sha256').update(fs.readFileSync(SERVER_OUT)).digest('hex');
          if (hash === lastServerHash) return;
          lastServerHash = hash;
          if (started) void restartStudio();
        });
      }
    }
  ]
});

let vite = null;

async function shutdown(code = 0) {
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  // Backstop for a teardown step that never settles. Unref'd, so it only
  // fires if something else is still holding the loop open -- exactly the
  // case where Ctrl-C would otherwise appear to do nothing.
  setTimeout(() => process.exit(code), 5000).unref();
  await stopStudio();
  if (vite) await vite.close().catch(() => {});
  await serverBuild.dispose();
  process.exit(code);
}

const onSignal = () => { void shutdown(0); };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

await serverBuild.rebuild();
await serverBuild.watch();
startStudio();

// Reuses vite.config.ts (root, plugins) and adds only what is dev-specific:
// where to listen and what to proxy. Regex keys match the full request URL,
// which is how the `/?token=<token>` handshake -- and only that request to
// `/` -- reaches the API server instead of the SPA.
const { createServer: createViteServer } = await import('vite');
vite = await createViteServer({
  configFile: path.join(root, 'vite.config.ts'),
  server: {
    host: '127.0.0.1',
    port: uiPort ?? (await freePort()),
    strictPort: uiPort !== undefined,
    proxy: {
      '^/api/': { target: apiOrigin, changeOrigin: false },
      '^/\\?token=': { target: apiOrigin, changeOrigin: false }
    }
  }
});
await vite.listen();

const url = `http://127.0.0.1:${vite.config.server.port}/?token=${sessionToken}`;
console.log(`[dev] project: ${project}`);
console.log(`[dev] client: vite dev server with HMR (src/studio/client) -- committed build artifacts untouched`);
console.log(url);
if (open) openBrowser(url);
