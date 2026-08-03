// Request/response shapes for the Studio HTTP API. Kept separate from
// models.ts (persisted file shapes) and events.ts (SSE push shapes).

import type { WorldDocument, Layout, ValidationError } from './models.js';

export interface WorkspaceResponse {
  projectRoot: string;
  hasWorld: boolean;
}

export interface WorldGetResponse {
  exists: boolean;
  world: WorldDocument | null;
  layout: Layout;
}

export interface WorldPutRequest {
  world: WorldDocument;
  layout?: Layout;
}

export interface WorldPutResponse {
  hash: string;
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
