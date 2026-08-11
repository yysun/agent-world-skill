// Resolves an Agent World project, reads/writes world.json and
// world.layout.json, resolves and reads/writes prompt files, and enforces
// that every filesystem path Studio touches stays inside the project
// directory or the installed skill directory (resolveInsideRoots).
//
// Save order (see plan Decisions -> "Validation and saving"): serialize ->
// write world.json.tmp -> validate the temp file's bytes (schema, then the
// router's own loadConfig for graph references) -> fsync -> rename ->
// record the written content hash -> caller emits world.saved. Layout writes
// use their own serialized compare-and-swap path: validate -> compare the
// caller's raw-file revision -> temp write/fsync -> rename -> record hash.
// Layout reads tolerate malformed presentation data and reconcile entries
// against the current world without ever weakening world validation.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Validator } from './validator.js';
import type { WorldDocument, Layout, ValidationError } from '../shared/models.js';
import { EMPTY_LAYOUT } from '../shared/models.js';
import type { LayoutWriteMode } from '../shared/api.js';

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

export type WorldSaveResult =
  | { ok: true; hash: string }
  | { ok: false; errors: ValidationError[] };

export type LayoutSaveResult =
  | { ok: true; layout: Layout; revision: string }
  | { ok: false; kind: 'validation'; errors: ValidationError[] }
  | { ok: false; kind: 'conflict'; currentRevision: string | null };

export interface LayoutReadResult {
  layout: Layout;
  revision: string | null;
}

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLayoutPosition(value: unknown): value is { x: number; y: number } {
  return isObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isViewport(value: unknown): value is { x: number; y: number; zoom: number } {
  return (
    isObject(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.zoom) &&
    value.zoom > 0
  );
}

/** Strict boundary validation for client writes. Unknown node ids are retained until the matching world is saved. */
function validateLayout(value: unknown): { layout?: Layout; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  if (!isObject(value)) {
    return { errors: [{ pointer: 'layout', message: 'Layout must be an object.' }] };
  }
  if (value.version !== 1) {
    errors.push({ pointer: 'layout.version', message: 'Layout version must be 1.' });
  }
  if (!isObject(value.nodes)) {
    errors.push({ pointer: 'layout.nodes', message: 'Layout nodes must be an object.' });
  }

  const nodes = Object.create(null) as Layout['nodes'];
  if (isObject(value.nodes)) {
    for (const [nodeId, position] of Object.entries(value.nodes)) {
      if (!isLayoutPosition(position)) {
        errors.push({ pointer: `layout.nodes.${nodeId}`, message: 'Node position must contain finite x and y numbers.' });
      } else {
        nodes[nodeId] = { x: position.x, y: position.y };
      }
    }
  }

  let viewport: Layout['viewport'];
  if (value.viewport !== undefined) {
    if (!isViewport(value.viewport)) {
      errors.push({ pointer: 'layout.viewport', message: 'Viewport must contain finite x, y, and positive zoom numbers.' });
    } else {
      viewport = { x: value.viewport.x, y: value.viewport.y, zoom: value.viewport.zoom };
    }
  }

  return errors.length > 0 ? { errors } : { layout: { version: 1, nodes, ...(viewport ? { viewport } : {}) }, errors };
}

/** Tolerant restore: invalid roots fall back to empty; invalid/stale entries are dropped independently. */
function restoreLayout(value: unknown, world: WorldDocument | null): Layout {
  if (!isObject(value) || value.version !== 1 || !isObject(value.nodes)) return { version: 1, nodes: {} };

  const allowedNodeIds = new Set(world ? Object.keys(world.workflow.nodes) : []);
  if (world && Object.prototype.hasOwnProperty.call(world.workflow.edges, 'human')) allowedNodeIds.add('__human__');

  const nodes = Object.create(null) as Layout['nodes'];
  for (const [nodeId, position] of Object.entries(value.nodes)) {
    if (allowedNodeIds.has(nodeId) && isLayoutPosition(position)) {
      nodes[nodeId] = { x: position.x, y: position.y };
    }
  }

  return {
    version: 1,
    nodes,
    ...(isViewport(value.viewport)
      ? { viewport: { x: value.viewport.x, y: value.viewport.y, zoom: value.viewport.zoom } }
      : {})
  };
}

/** Valid disk positions absent from a client snapshot remain durable across out-of-order world/layout edits. */
function mergeAbsentDiskPositions(layout: Layout, diskValue: unknown): Layout {
  if (!isObject(diskValue) || diskValue.version !== 1 || !isObject(diskValue.nodes)) return layout;
  const nodes = Object.assign(Object.create(null) as Layout['nodes'], layout.nodes);
  for (const [nodeId, position] of Object.entries(diskValue.nodes)) {
    if (
      !Object.prototype.hasOwnProperty.call(nodes, nodeId) &&
      isLayoutPosition(position)
    ) {
      nodes[nodeId] = { x: position.x, y: position.y };
    }
  }
  return { ...layout, nodes };
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
  private layoutWriteQueue: Promise<void> = Promise.resolve();
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

  readWorld(): { exists: boolean; world: WorldDocument | null } {
    const exists = this.hasWorld();
    const world = exists ? (JSON.parse(fs.readFileSync(this.worldPath, 'utf8')) as WorldDocument) : null;
    return { exists, world };
  }

  readLayout(): LayoutReadResult {
    if (!fs.existsSync(this.layoutPath)) return { layout: EMPTY_LAYOUT, revision: null };

    const raw = fs.readFileSync(this.layoutPath);
    const revision = sha256(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return { layout: EMPTY_LAYOUT, revision };
    }
    return { layout: restoreLayout(parsed, this.readWorld().world), revision };
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
    // Random suffix, not a timestamp: the client validates on edit, so two
    // requests can land in the same millisecond, and a shared temp path made
    // one call delete the file the other was still validating -- surfacing as
    // "Missing Agent World config: ...world.json.validate-<pid>-<ms>.tmp".
    const tmpPath = path.join(
      this.agentWorldDir,
      `${WORLD_FILENAME}.validate-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`
    );
    await fsp.writeFile(tmpPath, content, 'utf8');
    try {
      return this.validator.validatePath(tmpPath);
    } finally {
      await fsp.unlink(tmpPath).catch(() => {});
    }
  }

  async saveWorld(doc: WorldDocument): Promise<WorldSaveResult> {
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

    return { ok: true, hash };
  }

  async saveLayout(
    layout: unknown,
    expectedRevision: string | null,
    mode: LayoutWriteMode = 'merge'
  ): Promise<LayoutSaveResult> {
    const operation = this.layoutWriteQueue.then(() => this.performLayoutSave(layout, expectedRevision, mode));
    this.layoutWriteQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async performLayoutSave(
    layout: unknown,
    expectedRevision: string | null,
    mode: LayoutWriteMode
  ): Promise<LayoutSaveResult> {
    const validation = validateLayout(layout);
    if (!validation.layout) return { ok: false, kind: 'validation', errors: validation.errors };

    let persistedLayout = validation.layout;
    if (mode === 'merge' && fs.existsSync(this.layoutPath)) {
      try {
        const diskValue = JSON.parse((await fsp.readFile(this.layoutPath)).toString('utf8')) as unknown;
        persistedLayout = mergeAbsentDiskPositions(persistedLayout, diskValue);
      } catch {
        // A malformed external file is represented by its raw revision and
        // conflict behavior; there are no trustworthy positions to retain.
      }
    }

    const content = JSON.stringify(persistedLayout, null, 2) + '\n';
    const revision = sha256(content);
    const tmpPath = `${this.layoutPath}.${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      const handle = await fsp.open(tmpPath, 'w');
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      // Compare only after the potentially slow temp write/fsync, keeping
      // the unavoidable external-write race window next to the atomic rename.
      const currentRevision = fs.existsSync(this.layoutPath)
        ? sha256(await fsp.readFile(this.layoutPath))
        : null;
      if (currentRevision !== expectedRevision) {
        await fsp.unlink(tmpPath).catch(() => {});
        // If the response to our previous identical write was lost, retry is
        // an acknowledgement, not a false external conflict.
        if (currentRevision === revision) {
          this.recordWriteHash(this.layoutPath, revision);
          return { ok: true, layout: persistedLayout, revision };
        }
        return { ok: false, kind: 'conflict', currentRevision };
      }
      await fsp.rename(tmpPath, this.layoutPath);
    } catch (err) {
      await fsp.unlink(tmpPath).catch(() => {});
      throw err;
    }
    this.recordWriteHash(this.layoutPath, revision);
    return { ok: true, layout: persistedLayout, revision };
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
