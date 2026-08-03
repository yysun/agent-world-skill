// Studio entry point. Bundled by scripts/build-server.mjs into
// skills/agent-world/scripts/agent-world-studio.js, run with plain `node`
// against a project directory -- no install, no build step, no transpiler.
// Resolves the project, ensures .agent-world/ exists, loads the world when
// present (or starts normally and reports it absent), starts exactly one
// file watcher and one loopback-bound HTTP server, and prints the Studio
// URL. Launching Studio is not the same as launching an Agent World
// workflow: this process never selects an agent, calls a model, or executes
// a host action.
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { Workspace } from './workspace.js';
import { EventBus } from './sse.js';
import { Watcher } from './watcher.js';
import { createServer } from './server.js';

// __filename/__dirname here are the real CJS module-scope bindings esbuild
// preserves in the bundled output (not `import.meta.url`, which esbuild
// warns is empty once bundled to the CJS format the no-install build target
// requires). They resolve to this file's actual on-disk location at
// runtime: <skill-dir>/scripts/agent-world-studio.js once built.
const SKILL_DIR = path.resolve(__dirname, '..');
const CLIENT_DIST_DIR = path.join(SKILL_DIR, 'studio', 'dist');

interface CliArgs {
  project: string;
  port?: number;
  open: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let project = process.cwd();
  let port: number | undefined;
  let open = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') {
      project = argv[++i];
    } else if (arg === '--port') {
      port = Number(argv[++i]);
    } else if (arg === '--no-open') {
      open = false;
    }
  }
  return { project, port, open };
}

function openBrowser(url: string): ChildProcess | null {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      return spawn('open', [url], { stdio: 'ignore', detached: true }).unref() as unknown as ChildProcess;
    }
    if (platform === 'win32') {
      return spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref() as unknown as ChildProcess;
    }
    return spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref() as unknown as ChildProcess;
  } catch {
    return null;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<{ url: string; close: () => Promise<void> }> {
  const args = parseArgs(argv);
  const workspace = await Workspace.create(args.project, SKILL_DIR);
  // Test-only seam: lets the automated suite use a short heartbeat interval
  // instead of the real 20s default. Not a user-facing option (undocumented,
  // no CLI flag).
  const heartbeatOverride = Number(process.env.STUDIO_HEARTBEAT_INTERVAL_MS);
  const bus = new EventBus(Number.isFinite(heartbeatOverride) && heartbeatOverride > 0 ? heartbeatOverride : undefined);
  const watcher = new Watcher(workspace, bus);
  const { app, sessionToken } = createServer({ workspace, bus, clientDistDir: CLIENT_DIST_DIR });

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(args.port ?? 0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : args.port;
  const url = `http://127.0.0.1:${port}/?token=${sessionToken}`;

  let browserChild: ChildProcess | null = null;
  if (args.open) {
    browserChild = openBrowser(url);
  }

  let shuttingDown: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (shuttingDown) return shuttingDown;
    shuttingDown = (async () => {
      bus.close();
      await watcher.close();
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      // server.close() alone only stops accepting new connections and waits
      // for existing ones to end on their own; a keep-alive SSE socket can
      // otherwise leave it hanging well past bus.close()'s res.end() calls.
      // Force every socket closed immediately so shutdown is prompt and
      // deterministic instead of depending on client-side cooperation.
      server.closeAllConnections();
      await closed;
      if (browserChild && !browserChild.killed) {
        browserChild.kill();
      }
    })();
    return shuttingDown;
  };

  process.on('SIGINT', () => { void close().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { void close().then(() => process.exit(0)); });
  // 'exit' handlers cannot await async work; SIGINT/SIGTERM above already
  // perform the full async shutdown. This is only a synchronous, best-effort
  // fallback for an exit not triggered by either signal (e.g. an uncaught
  // exception), so the SSE responses and browser child don't outlive it.
  process.on('exit', () => {
    bus.close();
    if (browserChild && !browserChild.killed) {
      browserChild.kill();
    }
  });

  return { url, close };
}

if (process.argv[1] === __filename) {
  main().then(({ url }) => {
    console.log(url);
  }).catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
