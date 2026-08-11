// Debounced, serialized layout autosave state machine. It keeps only the
// newest pending immutable Layout snapshot, carries the server's raw-file
// revision token on every write, pauses around external conflicts, and
// retains failed work for explicit retry. React owns the visible layout;
// this controller owns only persistence ordering and status.
import type { Layout } from '../../shared/models.js';
import type { LayoutWriteMode } from '../../shared/api.js';

export type LayoutAutosavePhase = 'idle' | 'waiting' | 'saving' | 'paused' | 'error' | 'conflict';

export interface LayoutAutosaveStatus {
  phase: LayoutAutosavePhase;
  unsaved: boolean;
  error: string | null;
}

export interface LayoutWriteResult {
  layout: Layout;
  revision: string;
}

export type LayoutWriter = (
  layout: Layout,
  expectedRevision: string | null,
  mode: LayoutWriteMode
) => Promise<LayoutWriteResult>;

export class LayoutConflictError extends Error {
  constructor(public readonly currentRevision: string | null) {
    super('Layout changed outside Studio.');
    this.name = 'LayoutConflictError';
  }
}

export interface LayoutAutosaveOptions {
  debounceMs?: number;
  onStatus?: (status: LayoutAutosaveStatus) => void;
  onPersistedLayout?: (layout: Layout) => void;
}

export class LayoutAutosaveController {
  private readonly debounceMs: number;
  private readonly onStatus?: (status: LayoutAutosaveStatus) => void;
  private readonly onPersistedLayout?: (layout: Layout) => void;
  private revision: string | null = null;
  private pending: Layout | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: Promise<void> | null = null;
  private paused = false;
  private draining = false;
  private generation = 0;
  private phase: LayoutAutosavePhase = 'idle';
  private error: string | null = null;
  private pendingMode: LayoutWriteMode = 'merge';

  constructor(private readonly writer: LayoutWriter, options: LayoutAutosaveOptions = {}) {
    this.debounceMs = options.debounceMs ?? 300;
    this.onStatus = options.onStatus;
    this.onPersistedLayout = options.onPersistedLayout;
  }

  restoreRevision(revision: string | null): void {
    this.clearTimer();
    this.generation += 1;
    this.revision = revision;
    this.pending = null;
    this.paused = false;
    this.draining = false;
    this.phase = 'idle';
    this.error = null;
    this.pendingMode = 'merge';
    this.emit();
  }

  schedule(layout: Layout): void {
    this.pending = layout;
    if (this.paused) {
      if (this.phase !== 'error' && this.phase !== 'conflict') this.phase = 'paused';
      this.emit();
      return;
    }
    this.error = null;
    this.phase = this.active ? 'saving' : 'waiting';
    this.emit();
    if (!this.active) this.armTimer();
  }

  pause(): void {
    this.paused = true;
    this.clearTimer();
    this.phase = 'paused';
    this.emit();
  }

  /** Captures dirty canvas state at SSE conflict detection, before an active response can mark it clean. */
  pauseForExternalConflict(latestLayout: Layout): void {
    this.clearTimer();
    this.generation += 1;
    this.pending = latestLayout;
    this.pendingMode = 'merge';
    this.paused = true;
    this.phase = 'paused';
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.error = null;
    if (this.pending) {
      this.phase = this.active ? 'saving' : 'waiting';
      if (!this.active) this.armTimer(0);
    } else if (!this.active) {
      this.phase = 'idle';
    }
    this.emit();
  }

  resolveConflict(revision: string | null, latestLayout?: Layout): void {
    if (latestLayout) {
      this.clearTimer();
      // An external event can arrive while the request containing the latest
      // canvas snapshot is still active. Invalidate that completion and
      // retain the visible snapshot so Keep necessarily issues a replacement.
      this.generation += 1;
      this.pending = latestLayout;
    }
    this.revision = revision;
    this.pendingMode = 'replace';
    this.resume();
  }

  retry(): void {
    if (!this.pending) return;
    this.paused = false;
    this.error = null;
    this.phase = this.active ? 'saving' : 'waiting';
    this.emit();
    if (!this.active) this.armTimer(0);
  }

  flush(): void {
    if (!this.pending || this.paused || this.active) return;
    this.clearTimer();
    void this.startWrite();
  }

  /** Flushes now and chains the newest pending snapshot immediately after any active write, for page shutdown. */
  drain(): void {
    this.draining = true;
    this.clearTimer();
    if (!this.active) void this.startWrite();
  }

  /** Invalidates obsolete responses and waits for an already-issued request before the caller reloads disk state. */
  async discard(): Promise<void> {
    this.clearTimer();
    this.generation += 1;
    this.pending = null;
    this.paused = false;
    this.draining = false;
    this.error = null;
    this.pendingMode = 'merge';
    const active = this.active;
    if (active) await active.catch(() => {});
    this.phase = 'idle';
    this.emit();
  }

  dispose(): void {
    this.clearTimer();
    this.generation += 1;
    this.pending = null;
    this.pendingMode = 'merge';
  }

  private armTimer(delay = this.debounceMs): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.startWrite();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async startWrite(): Promise<void> {
    if (this.active || this.paused || !this.pending) return;
    const snapshot = this.pending;
    const expectedRevision = this.revision;
    const generation = this.generation;
    const mode = this.pendingMode;
    this.pending = null;
    this.pendingMode = 'merge';
    this.phase = 'saving';

    const operation = Promise.resolve()
      .then(() => this.writer(snapshot, expectedRevision, mode))
      .then(result => {
        if (generation !== this.generation) return;
        this.revision = result.revision;
        this.error = null;
        this.onPersistedLayout?.(result.layout);
      })
      .catch((err: unknown) => {
        if (generation !== this.generation) return;
        this.pending ??= snapshot;
        if (mode === 'replace') this.pendingMode = 'replace';
        this.paused = true;
        if (err instanceof LayoutConflictError) {
          this.phase = 'conflict';
          this.error = err.message;
        } else {
          this.phase = 'error';
          this.error = err instanceof Error ? err.message : 'Layout save failed.';
        }
      })
      .finally(() => {
        if (this.active === operation) this.active = null;
        if (generation !== this.generation) {
          if (this.pending && !this.paused) {
            this.phase = 'waiting';
            if (this.draining) void this.startWrite();
            else this.armTimer();
          }
          this.emit();
          return;
        }
        if (this.paused) {
          if (this.phase !== 'conflict' && this.phase !== 'error') this.phase = 'paused';
        } else if (this.pending) {
          this.phase = 'waiting';
          if (this.draining) void this.startWrite();
          else this.armTimer();
        } else {
          this.phase = 'idle';
          this.draining = false;
        }
        this.emit();
      });
    this.active = operation;
    this.emit();
    await operation;
  }

  private emit(): void {
    this.onStatus?.({
      phase: this.phase,
      unsaved: this.pending !== null || this.active !== null || this.phase === 'error' || this.phase === 'conflict',
      error: this.error
    });
  }
}
