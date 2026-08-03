/*
  Loads src/studio/client/workflow/index.ts (model + derive + mutate -- pure,
  no React) into a CommonJS module for the pure-function test suites, by
  bundling it in-memory with esbuild. There is no build step that produces a
  Node-consumable bundle of this module on its own (the server build is a
  separate esbuild bundle, and the client build is a browser-targeted Vite
  bundle), so this loader stands in for one at test time rather than adding
  a new committed build artifact for logic that has no browser dependency.
*/
const esbuild = require('esbuild');
const path = require('node:path');

let cached;

function loadWorkflow() {
  if (cached) return cached;
  const entry = path.resolve(__dirname, '..', '..', 'src', 'studio', 'client', 'workflow', 'index.ts');
  const result = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent'
  });
  const mod = { exports: {} };
  const run = new Function('module', 'exports', 'require', result.outputFiles[0].text);
  run(mod, mod.exports, require);
  cached = mod.exports;
  return cached;
}

module.exports = { loadWorkflow };
