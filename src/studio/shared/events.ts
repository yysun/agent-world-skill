// Server-Sent Events pushed to Studio clients over GET /api/events.
// Transport-neutral: no run event exists here, and none should be added
// until the run-observation story defines one (see REQ Non-Goals).

export type FileChangeSource = 'studio' | 'external';

export interface WorkspaceLoadedEvent {
  type: 'workspace.loaded';
  projectRoot: string;
  hasWorld: boolean;
}

export interface FileChangedEvent {
  type: 'file.changed';
  path: string;
  source: FileChangeSource;
}

export interface WorldSavedEvent {
  type: 'world.saved';
  hash: string;
}

export interface ValidationCompletedEvent {
  type: 'validation.completed';
  valid: boolean;
  errors: import('./models.js').ValidationError[];
}

export type StudioEvent =
  | WorkspaceLoadedEvent
  | FileChangedEvent
  | WorldSavedEvent
  | ValidationCompletedEvent;
