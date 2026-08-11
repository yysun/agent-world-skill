// Request/response shapes for the Studio HTTP API. Kept separate from
// models.ts (persisted file shapes) and events.ts (SSE push shapes).
// World transport is semantic-only; layout uses its own read/write contract
// with a raw-file revision token for optimistic concurrency.

import type { WorldDocument, Layout, ValidationError } from './models.js';

export interface WorkspaceResponse {
  projectRoot: string;
  hasWorld: boolean;
}

export interface WorldGetResponse {
  exists: boolean;
  world: WorldDocument | null;
}

export interface WorldPutRequest {
  world: WorldDocument;
}

export interface WorldPutResponse {
  hash: string;
}

export interface LayoutGetResponse {
  layout: Layout;
  /** SHA-256 of the exact layout-file bytes, or null when the file does not exist. */
  revision: string | null;
}

export type LayoutWriteMode = 'merge' | 'replace';

export interface LayoutPutRequest {
  layout: Layout;
  expectedRevision: string | null;
  /** Normal autosave preserves hidden disk positions; explicit Keep replaces the external snapshot. */
  mode?: LayoutWriteMode;
}

export interface LayoutPutResponse {
  layout: Layout;
  revision: string;
}

export interface LayoutConflictResponse extends ErrorResponse {
  currentRevision: string | null;
}

export interface ValidateRequest {
  world: WorldDocument;
}

export interface ValidateResponse {
  valid: boolean;
  errors: ValidationError[];
}

export interface PromptGetResponse {
  agentId: string;
  content: string;
}

export interface PromptPutRequest {
  content: string;
}

export interface PromptPutResponse {
  ok: true;
}

export interface ErrorResponse {
  errors: ValidationError[];
}
