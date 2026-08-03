// Barrel for the workflow module: the world-document accessors (model.ts),
// canvas derivation (derive.ts), and referential-integrity mutations
// (mutate.ts). Exists so callers -- Canvas.tsx, the property panels, and
// the pure-function test suites in tests/studio/ -- import one path rather
// than three.
export * from './model.js';
export * from './derive.js';
export * from './mutate.js';
