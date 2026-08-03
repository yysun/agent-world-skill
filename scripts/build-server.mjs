// Bundles the Studio server (src/studio/server/cli.ts) into a single committed
// CommonJS artifact at skills/agent-world/scripts/agent-world-studio.js so the
// installed skill can run it with plain `node`, no install and no build step.
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(root, 'src/studio/server/cli.ts')],
  outfile: path.join(root, 'skills/agent-world/scripts/agent-world-studio.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info'
});
