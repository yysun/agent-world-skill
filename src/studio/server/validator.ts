// Validates a candidate world document against two independent authorities:
// the canonical JSON Schema (shape) and the router's own loadConfig (graph
// references: entry existence, node->agent, requires targets, edge
// source/target, contextScope enum). Reusing loadConfig instead of
// reimplementing graph checks is deliberate: a parallel implementation could
// drift and accept a world the router refuses, which is the defect this
// service exists to prevent (see plan Decisions -> "Validation and saving").
//
// The schema and the router module are both read from the installed skill
// directory at runtime, never copied or inlined. The router is loaded with
// a plain dynamic `require(routerPath)` rather than `createRequire` --
// `import.meta` is empty once esbuild bundles this to the CJS format the
// no-install build target requires (verified empirically: esbuild warns
// "import.meta is not available with the cjs output format"), so the
// bundle's own real, module-scoped CJS `require` is used instead.
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { ValidationError, ValidationResult } from '../shared/models.js';

interface RouterModule {
  loadConfig: (configPath: string) => unknown;
  validateConfig: (config: unknown) => unknown;
}

const GRAPH_ERROR_HEADER = 'Invalid Agent World config:\n- ';

export class Validator {
  // Ajv attaches `.errors` to the compiled validate function itself after
  // each call, NOT to the Ajv instance (that only happens via the
  // `ajv.validate(schemaOrRef, data)` convenience method, which this class
  // does not use) -- so the compiled function, not the Ajv instance, must be
  // kept and read back for errors.
  private readonly ajvValidate: ValidateFunction;
  private readonly router: RouterModule;

  constructor(skillDir: string) {
    const schemaPath = path.join(skillDir, 'world.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    this.ajvValidate = ajv.compile(schema);

    const routerPath = path.join(skillDir, 'scripts', 'agent-world-router.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.router = require(routerPath) as RouterModule;
  }

  /** Schema-only check, for callers that only need shape validation. */
  validateSchema(candidate: unknown): ValidationError[] {
    const valid = this.ajvValidate(candidate);
    if (valid) return [];
    return (this.ajvValidate.errors || []).map((err: ErrorObject) => {
      const dotted = err.instancePath
        ? err.instancePath.slice(1).split('/').join('.')
        : '';
      const extra = (err.params as { additionalProperty?: string }).additionalProperty;
      const pointer = extra ? `${dotted}.${extra}`.replace(/^\./, '') : dotted;
      const message = `${pointer || '(root)'} ${err.message}${extra ? ` (${extra})` : ''}`.trim();
      return { pointer, message };
    });
  }

  /**
   * Full validation of the world file already written at candidatePath:
   * schema first (cheap, and normalizeAgents/loadConfig can throw on
   * structurally-wrong input), then loadConfig for graph references.
   * candidatePath must live in the real project's .agent-world/ directory
   * so promptPath resolution matches the file it will become.
   */
  validatePath(candidatePath: string): ValidationResult {
    const raw = fs.readFileSync(candidatePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { valid: false, errors: [{ pointer: '', message: `Invalid JSON: ${(err as Error).message}` }] };
    }

    const schemaErrors = this.validateSchema(parsed);
    if (schemaErrors.length > 0) {
      return { valid: false, errors: schemaErrors };
    }

    try {
      this.router.loadConfig(candidatePath);
    } catch (err) {
      return { valid: false, errors: parseGraphError(err as Error) };
    }

    return { valid: true, errors: [] };
  }
}

export function parseGraphError(err: Error): ValidationError[] {
  const message = err.message;
  if (!message.startsWith(GRAPH_ERROR_HEADER)) {
    return [{ pointer: '', message }];
  }
  const rest = message.slice(GRAPH_ERROR_HEADER.length);
  return rest.split('\n- ').map(line => ({
    pointer: line.split(' ')[0] || '',
    message: line
  }));
}
