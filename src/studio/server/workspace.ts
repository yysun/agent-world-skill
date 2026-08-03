// Resolves an Agent World project, reads/writes world.json and
// world.layout.json, resolves and reads/writes prompt files, and enforces
// that every filesystem path Studio touches stays inside the project
// directory or the installed skill directory (resolveInsideRoots).
//
// Save order (see plan Decisions -> "Validation and saving"): serialize ->
// write world.json.tmp -> validate the temp file's bytes (schema, then the
// router's own loadConfig for graph references) -> fsync -> rename ->
// record the written content hash -> caller emits world.saved. Any failure
// unlinks the temp file and leaves the real file untouched.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Validator } from './validator.js';
import type { WorldDocument, Layout, ValidationError } from '../shared/models.js';
import { EMPTY_LAYOUT } from '../shared/models.js';

export class PathEscapeError extends Error {
  constructor(public readonly candidate: string) {
    super(`Path escapes the project and skill directories: ${candidate}`);
    this.name = 'PathEscapeError';
  }
}

export class UnknownAgentError extends Error {
  constructor(public readonly agentId: string) {
    super(`Unknown agent: ${agentId}`);
    this.name = 'UnknownAgentError';
  }
}

export class PromptNotFoundError extends Error {
  constructor(public readonly agentId: string) {
    super(`Prompt file not found for agent: ${agentId}`);
    this.name = 'PromptNotFoundError';
  }
}

const WORLD_FILENAME = 'world.json';
const LAYOUT_FILENAME = 'world.layout.json';
const AGENT_WORLD_DIR = '.agent-world';

export type SaveResult =
  | { ok: true; hash: string }
  | { ok: false; errors: ValidationError[] };

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function existsAsync(candidate: string): Promise<boolean> {
  try {
    await fsp.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolves `candidate` to a canonical absolute path and rejects it unless it
 * lies inside one of `roots` (which must already be canonical/realpath'd).
 * Walks up to the nearest existing ancestor and realpaths that ancestor
 * before rejoining any missing trailing segments, so a legitimate
 * not-yet-created file (e.g. a new agent's first prompt write) resolves
 * correctly while a symlinked intermediate directory pointing outside the
 * allowed roots is still caught -- only the final path segment is ever
 * allowed to be missing.
 */
export async function resolveInsideRoots(candidate: string, roots: string[]): Promise<string> {
  const resolved = path.resolve(candidate);
  let dir = resolved;
  const missingTail: string[] = [];
  while (!(await existsAsync(dir))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new PathEscapeError(candidate);
    }
    missingTail.unshift(path.basename(dir));
    dir = parent;
  }
  const realDir = await fsp.realpath(dir);
  const finalResolved = missingTail.length > 0 ? path.join(realDir, ...missingTail) : realDir;
  if (!roots.some(root => isInside(root, finalResolved))) {
    throw new PathEscapeError(candidate);
  }
  return finalResolved;
}

export class Workspace {
  private readonly writeHashes = new Map<string, string>();
  readonly worldPath: string;
  readonly layoutPath: string;
  readonly promptsDir: string;
  readonly allowedRoots: string[];

  private constructor(
    readonly projectRoot: string,
    readonly skillDir: string,
    readonly agentWorldDir: string,
    private readonly validator: Validator
  ) {
    this.worldPath = path.join(agentWorldDir, WORLD_FILENAME);
    this.layoutPath = path.join(agentWorldDir, LAYOUT_FILENAME);
    this.promptsDir = path.join(agentWorldDir, 'prompts');
    this.allowedRoots = [projectRoot, skillDir];
  }

  static async create(projectRootInput: string, skillDirInput: string): Promise<Workspace> {
    const projectRoot = await fsp.realpath(path.resolve(projectRootInput));
    const skillDir = await fsp.realpath(path.resolve(skillDirInput));
    const agentWorldDir = path.join(projectRoot, AGENT_WORLD_DIR);
    await fsp.mkdir(agentWorldDir, { recursive: true });
    const validator = new Validator(skillDir);
    return new Workspace(projectRoot, skillDir, agentWorldDir, validator);
  }

  hasWorld(): boolean {
    return fs.existsSync(this.worldPath);
  }

  readWorld(): { exists: boolean; world: WorldDocument | null; layout: Layout } {
    const exists = this.hasWorld();
    const world = exists ? (JSON.parse(fs.readFileSync(this.worldPath, 'utf8')) as WorldDocument) : null;
    const layout = fs.existsSync(this.layoutPath)
      ? (JSON.parse(fs.readFileSync(this.layoutPath, 'utf8')) as Layout)
      : EMPTY_LAYOUT;
    return { exists, world, layout };
  }

  /**
   * Checks every agent's promptPath for a root escape before the candidate
   * ever reaches the router's loadConfig. loadConfig's own promptPath
   * resolution (agent-world-router.js readPrompt) is a plain path.resolve
   * with no containment check -- it trusts the file it's pointed at, which
   * is correct for the router (a trusted, already-validated world) but
   * would let a Studio save/validate request smuggle an absolute or `../`
   * promptPath straight past schema+graph validation and into a durably
   * written world.json. Every dedicated prompt route already ran
   * resolveInsideRoots; this closes the same gap for the whole-world path.
   */
  private async findPromptPathEscapes(doc: WorldDocument): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    for (const [agentId, agent] of Object.entries(doc.agents || {})) {
      if (!agent || typeof agent.promptPath !== 'string') continue;
      const candidate = path.resolve(this.agentWorldDir, agent.promptPath);
      try {
        await resolveInsideRoots(candidate, this.allowedRoots);
      } catch (err) {
        if (!(err instanceof PathEscapeError)) throw err;
        errors.push({
          pointer: `agents.${agentId}.promptPath`,
          message: `agents.${agentId}.promptPath escapes the project and skill directories: ${agent.promptPath}`
        });
      }
    }
    return errors;
  }

  /** Schema + graph validation of an in-memory candidate, via a scratch temp file. */
  async validateCandidate(doc: WorldDocument): Promise<{ valid: boolean; errors: ValidationError[] }> {
    const escapeErrors = await this.findPromptPathEscapes(doc);
    if (escapeErrors.length > 0) {
      return { valid: false, errors: escapeErrors };
    }

    const content = JSON.stringify(doc, null, 2) + '\n';
    const tmpPath = path.join(this.agentWorldDir, `${WORLD_FILENAME}.validate-${process.pid}-${Date.now()}.tmp`);
    await fsp.writeFile(tmpPath, content, 'utf8');
    try {
      return this.validator.validatePath(tmpPath);
    } finally {
      await fsp.unlink(tmpPath).catch(() => {});
    }
  }

  async saveWorld(doc: WorldDocument, layout?: Layout): Promise<SaveResult> {
    const escapeErrors = await this.findPromptPathEscapes(doc);
    if (escapeErrors.length > 0) {
      return { ok: false, errors: escapeErrors };
    }

    const content = JSON.stringify(doc, null, 2) + '\n';
    const tmpPath = `${this.worldPath}.tmp`;

    const handle = await fsp.open(tmpPath, 'w');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    const result = this.validator.validatePath(tmpPath);
    if (!result.valid) {
      await fsp.unlink(tmpPath).catch(() => {});
      return { ok: false, errors: result.errors };
    }

    await fsp.rename(tmpPath, this.worldPath);
    const hash = sha256(content);
    this.recordWriteHash(this.worldPath, hash);

    if (layout) {
      await this.writeLayout(layout);
    }

    return { ok: true, hash };
  }

  async writeLayout(layout: Layout): Promise<void> {
    const content = JSON.stringify(layout, null, 2) + '\n';
    await fsp.writeFile(this.layoutPath, content, 'utf8');
    this.recordWriteHash(this.layoutPath, sha256(content));
  }

  private resolvePromptCandidate(world: WorldDocument, agentId: string): string {
    const agent = world.agents[agentId];
    if (!agent) throw new UnknownAgentError(agentId);
    return path.resolve(this.agentWorldDir, agent.promptPath);
  }

  async readPrompt(agentId: string): Promise<string> {
    const { world } = this.readWorld();
    if (!world) throw new UnknownAgentError(agentId);
    const candidate = this.resolvePromptCandidate(world, agentId);
    const resolved = await resolveInsideRoots(candidate, this.allowedRoots);
    try {
      return fs.readFileSync(resolved, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PromptNotFoundError(agentId);
      }
      throw err;
    }
  }

  async writePrompt(agentId: string, content: string): Promise<void> {
    const { world } = this.readWorld();
    if (!world) throw new UnknownAgentError(agentId);
    const candidate = this.resolvePromptCandidate(world, agentId);
    const resolved = await resolveInsideRoots(candidate, this.allowedRoots);
    await fsp.mkdir(path.dirname(resolved), { recursive: true });
    await fsp.writeFile(resolved, content, 'utf8');
    this.recordWriteHash(resolved, sha256(content));
  }

  recordWriteHash(filePath: string, hash: string): void {
    this.writeHashes.set(path.resolve(filePath), hash);
  }

  /** True when `content`'s hash matches the most recent write Studio itself made to `filePath`. */
  isSelfWrite(filePath: string, content: string | Buffer): boolean {
    return this.writeHashes.get(path.resolve(filePath)) === sha256(content);
  }
}
