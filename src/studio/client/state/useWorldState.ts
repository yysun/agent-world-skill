// Central client-side state for the in-memory WorldDocument and Layout.
// Semantic world edits remain manual and control `dirty`/PUT /api/world;
// presentation-only node and viewport edits use a separate debounced,
// serialized PUT /api/layout controller with raw-file revision checks.
// Restore and external refresh read each resource independently, retain
// failed layout state for retry, and expose resource-scoped dirty/reload
// operations to App's external-change conflict flow. Only explicit canvas
// edit callbacks schedule layout persistence; reads and semantic actions
// never manufacture a world.layout.json write.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorldDocument, Layout, LayoutPosition, ValidationError } from '../../shared/models.js';
import { EMPTY_LAYOUT } from '../../shared/models.js';
import type {
  LayoutConflictResponse,
  LayoutGetResponse,
  LayoutPutResponse,
  LayoutWriteMode,
  WorldGetResponse
} from '../../shared/api.js';
import {
  LayoutAutosaveController,
  LayoutConflictError,
  type LayoutAutosaveStatus
} from './layoutAutosave.js';
import { OperationGeneration } from './operationGeneration.js';

export interface WorldState {
  doc: WorldDocument | null;
  layout: Layout;
  exists: boolean;
  loading: boolean;
  error: string | null;
  dirty: boolean;
  saving: boolean;
  layoutUnsaved: boolean;
  layoutSaving: boolean;
  layoutError: string | null;
  layoutConflict: boolean;
  layoutLoadGeneration: number;
  /** Incremented only by presentation edits so autosave can ignore restores and semantic mutations. */
  layoutRevision: number;
  validationErrors: ValidationError[];
  /** Incremented by every edit. Lets `save()` tell whether new edits landed while its request was in flight, since the response only proves that *particular* snapshot was persisted. */
  revision: number;
}

export interface WorldStateApi extends WorldState {
  mutate: (fn: (doc: WorldDocument) => WorldDocument) => void;
  previewNodePositions: (positions: Record<string, LayoutPosition>) => void;
  setNodePositions: (positions: Record<string, LayoutPosition>) => void;
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  setDoc: (doc: WorldDocument) => void;
  reload: () => void;
  reloadWorld: (discardLocal?: boolean) => Promise<boolean>;
  reloadLayout: (discardLocal?: boolean) => Promise<boolean>;
  save: () => Promise<boolean>;
  pauseLayoutAutosave: () => void;
  resumeLayoutAutosave: () => void;
  retryLayoutSave: () => void;
  getCurrentLayoutRevision: () => Promise<string | null>;
  keepStudioLayout: (revision: string | null) => boolean;
  discardLayoutChanges: () => Promise<void>;
  hasUnsavedChanges: () => boolean;
  hasUnsavedWorld: () => boolean;
  hasUnsavedLayout: () => boolean;
  getLayoutOperationGeneration: () => number;
  isLayoutOperationCurrent: (generation: number) => boolean;
}

const INITIAL_STATE: WorldState = {
  doc: null,
  layout: EMPTY_LAYOUT,
  exists: false,
  loading: true,
  error: null,
  dirty: false,
  saving: false,
  layoutUnsaved: false,
  layoutSaving: false,
  layoutError: null,
  layoutConflict: false,
  layoutLoadGeneration: 0,
  layoutRevision: 0,
  validationErrors: [],
  revision: 0
};

/** Checks a freshly loaded world against the server's own validator, so a world that was already invalid on disk surfaces its errors rather than rendering as valid. */
function validateLoadedWorld(world: WorldDocument): Promise<ValidationError[]> {
  return fetch('/api/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ world })
  })
    .then(res => res.json() as Promise<{ valid: boolean; errors: ValidationError[] }>)
    .then(body => body.errors)
    .catch(() => []);
}

async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { errors?: ValidationError[] };
    return body.errors?.[0]?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function mergePersistedPositions(current: Layout, persisted: Layout): Layout {
  return {
    ...current,
    nodes: Object.assign(Object.create(null) as Layout['nodes'], persisted.nodes, current.nodes)
  };
}

async function writeLayout(
  layout: Layout,
  expectedRevision: string | null,
  mode: LayoutWriteMode
): Promise<{ layout: Layout; revision: string }> {
  const res = await fetch('/api/layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout, expectedRevision, mode }),
    keepalive: true
  });
  if (res.status === 409) {
    const body = (await res.json()) as LayoutConflictResponse;
    throw new LayoutConflictError(body.currentRevision);
  }
  if (!res.ok) throw new Error(await responseError(res, `Layout save failed: ${res.status}`));
  const body = (await res.json()) as LayoutPutResponse;
  return { layout: body.layout, revision: body.revision };
}

export function useWorldState(): WorldStateApi {
  const [state, setState] = useState<WorldState>(INITIAL_STATE);
  const autosaveRef = useRef<LayoutAutosaveController | null>(null);
  const latestLayoutRef = useRef<Layout>(EMPTY_LAYOUT);
  const layoutUnsavedRef = useRef(false);
  const worldDirtyRef = useRef(false);
  const worldEditGenerationRef = useRef(0);
  const layoutEditGenerationRef = useRef(0);
  const worldLoadRequestRef = useRef(0);
  const layoutLoadRequestRef = useRef(0);
  const layoutOperationGenerationRef = useRef<OperationGeneration | null>(null);
  if (!layoutOperationGenerationRef.current) {
    layoutOperationGenerationRef.current = new OperationGeneration();
  }
  if (!autosaveRef.current) {
    autosaveRef.current = new LayoutAutosaveController(writeLayout, {
      onStatus: (status: LayoutAutosaveStatus) => {
        layoutUnsavedRef.current = status.unsaved;
        setState(s => ({
          ...s,
          layoutUnsaved: status.unsaved,
          layoutSaving: status.phase === 'saving',
          layoutError: status.error,
          layoutConflict: status.phase === 'conflict'
        }));
      },
      onPersistedLayout: persisted => {
        const layout = mergePersistedPositions(latestLayoutRef.current, persisted);
        latestLayoutRef.current = layout;
        setState(s => ({ ...s, layout }));
      }
    });
  }

  const reloadWorld = useCallback(async (discardLocal = false): Promise<boolean> => {
    layoutOperationGenerationRef.current?.invalidate();
    const request = ++worldLoadRequestRef.current;
    const generation = worldEditGenerationRef.current;
    try {
      const res = await fetch('/api/world');
      if (!res.ok) throw new Error(`World request failed: ${res.status}`);
      const world = (await res.json()) as WorldGetResponse;
      const validationErrors = world.world ? await validateLoadedWorld(world.world) : [];
      if (
        request !== worldLoadRequestRef.current ||
        generation !== worldEditGenerationRef.current ||
        (!discardLocal && worldDirtyRef.current)
      ) return false;
      worldDirtyRef.current = false;
      setState(s => ({
        ...s,
        doc: world.world,
        exists: world.exists,
        error: null,
        dirty: false,
        saving: false,
        validationErrors,
        revision: 0
      }));
      return true;
    } catch (err) {
      if (request === worldLoadRequestRef.current) {
        setState(s => ({ ...s, error: err instanceof Error ? err.message : 'World request failed.' }));
      }
      return false;
    }
  }, []);

  const reloadLayout = useCallback(async (discardLocal = false): Promise<boolean> => {
    const request = ++layoutLoadRequestRef.current;
    const generation = layoutEditGenerationRef.current;
    layoutOperationGenerationRef.current?.invalidate();
    try {
      const res = await fetch('/api/layout');
      if (!res.ok) throw new Error(`Layout request failed: ${res.status}`);
      const layout = (await res.json()) as LayoutGetResponse;
      if (
        request !== layoutLoadRequestRef.current ||
        generation !== layoutEditGenerationRef.current ||
        (!discardLocal && layoutUnsavedRef.current)
      ) return false;
      if (discardLocal) await autosaveRef.current?.discard();
      if (
        request !== layoutLoadRequestRef.current ||
        generation !== layoutEditGenerationRef.current ||
        layoutUnsavedRef.current
      ) return false;
      latestLayoutRef.current = layout.layout;
      autosaveRef.current?.restoreRevision(layout.revision);
      setState(s => ({
        ...s,
        layout: layout.layout,
        layoutUnsaved: false,
        layoutSaving: false,
        layoutError: null,
        layoutConflict: false,
        layoutLoadGeneration: s.layoutLoadGeneration + 1,
        layoutRevision: 0
      }));
      return true;
    } catch (err) {
      if (request === layoutLoadRequestRef.current) {
        setState(s => ({ ...s, layoutError: err instanceof Error ? err.message : 'Layout request failed.' }));
      }
      return false;
    }
  }, []);

  const load = useCallback(() => {
    setState(s => ({ ...s, loading: true, error: null }));
    void Promise.all([reloadWorld(true), reloadLayout(true)])
      .finally(() => setState(s => ({ ...s, loading: false })));
  }, [reloadLayout, reloadWorld]);

  useEffect(() => {
    load();
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      autosaveRef.current?.drain();
      if (layoutUnsavedRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      autosaveRef.current?.drain();
    };
  }, [load]);

  const mutate = useCallback((fn: (doc: WorldDocument) => WorldDocument) => {
    layoutOperationGenerationRef.current?.invalidate();
    worldDirtyRef.current = true;
    worldEditGenerationRef.current += 1;
    setState(s => (s.doc ? { ...s, doc: fn(s.doc), dirty: true, revision: s.revision + 1 } : s));
  }, []);

  const previewNodePositions = useCallback((positions: Record<string, LayoutPosition>) => {
    layoutOperationGenerationRef.current?.invalidate();
    const layout = {
      ...latestLayoutRef.current,
      nodes: { ...latestLayoutRef.current.nodes, ...positions }
    };
    latestLayoutRef.current = layout;
    setState(s => ({ ...s, layout }));
  }, []);

  const setNodePositions = useCallback((positions: Record<string, LayoutPosition>) => {
    layoutOperationGenerationRef.current?.invalidate();
    const layout = {
      ...latestLayoutRef.current,
      nodes: { ...latestLayoutRef.current.nodes, ...positions }
    };
    latestLayoutRef.current = layout;
    layoutUnsavedRef.current = true;
    layoutEditGenerationRef.current += 1;
    autosaveRef.current?.schedule(layout);
    setState(s => ({ ...s, layout, layoutUnsaved: true, layoutRevision: s.layoutRevision + 1 }));
  }, []);

  const setViewport = useCallback((viewport: { x: number; y: number; zoom: number }) => {
    const layout = { ...latestLayoutRef.current, viewport };
    latestLayoutRef.current = layout;
    layoutUnsavedRef.current = true;
    layoutEditGenerationRef.current += 1;
    autosaveRef.current?.schedule(layout);
    setState(s => ({ ...s, layout, layoutUnsaved: true, layoutRevision: s.layoutRevision + 1 }));
  }, []);

  const setDoc = useCallback((doc: WorldDocument) => {
    layoutOperationGenerationRef.current?.invalidate();
    worldDirtyRef.current = true;
    worldEditGenerationRef.current += 1;
    setState(s => ({ ...s, doc, exists: true, dirty: true, revision: s.revision + 1 }));
  }, []);

  /**
   * Returns true on success. A rejected save never marks the document clean
   * and never reports success. On success, the document is only marked
   * clean if no further edit landed while the request was in flight (the
   * response only proves *that* snapshot, identified by `savedRevision`,
   * reached disk) -- otherwise a newer, still-unsaved edit would be marked
   * clean by a slow response for an older save, which is exactly the silent
   * data-loss failure mode conflict handling exists to avoid.
   */
  const save = useCallback((): Promise<boolean> => {
    let currentDoc: WorldDocument | null = null;
    let savedRevision = -1;
    setState(s => {
      currentDoc = s.doc;
      savedRevision = s.revision;
      return { ...s, saving: true };
    });
    if (!currentDoc) return Promise.resolve(false);

    return fetch('/api/world', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ world: currentDoc })
    })
      .then(async res => {
        if (!res.ok) {
          const body = (await res.json()) as { errors: ValidationError[] };
          setState(s => ({ ...s, saving: false, validationErrors: body.errors }));
          return false;
        }
        setState(s => {
          const dirty = s.revision !== savedRevision;
          worldDirtyRef.current = dirty;
          return { ...s, saving: false, dirty, validationErrors: [] };
        });
        return true;
      })
      .catch((err: Error) => {
        setState(s => ({ ...s, saving: false, validationErrors: [{ pointer: '', message: err.message }] }));
        return false;
      });
  }, []);

  const pauseLayoutAutosave = useCallback(
    () => autosaveRef.current?.pauseForExternalConflict(latestLayoutRef.current),
    []
  );
  const resumeLayoutAutosave = useCallback(() => autosaveRef.current?.resume(), []);
  const retryLayoutSave = useCallback(() => autosaveRef.current?.retry(), []);

  const getCurrentLayoutRevision = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/layout');
      if (!res.ok) throw new Error(`Layout request failed: ${res.status}`);
      const body = (await res.json()) as LayoutGetResponse;
      return body.revision;
    } catch (err) {
      setState(s => ({ ...s, layoutError: err instanceof Error ? err.message : 'Layout request failed.' }));
      throw err;
    }
  }, []);

  const keepStudioLayout = useCallback((revision: string | null): boolean => {
    // A Keep decision can write only an already-retained canvas edit. World-
    // only conflicts and clean layout refreshes must never manufacture a
    // layout snapshot merely because the user chose Keep Studio Version.
    if (!layoutUnsavedRef.current) return false;
    autosaveRef.current?.pause();
    autosaveRef.current?.resolveConflict(revision, latestLayoutRef.current);
    return true;
  }, []);

  const discardLayoutChanges = useCallback(async (): Promise<void> => {
    await autosaveRef.current?.discard();
  }, []);

  const hasUnsavedChanges = useCallback(
    (): boolean => worldDirtyRef.current || layoutUnsavedRef.current,
    []
  );
  const hasUnsavedWorld = useCallback((): boolean => worldDirtyRef.current, []);
  const hasUnsavedLayout = useCallback((): boolean => layoutUnsavedRef.current, []);
  const getLayoutOperationGeneration = useCallback(
    (): number => layoutOperationGenerationRef.current?.current() ?? 0,
    []
  );
  const isLayoutOperationCurrent = useCallback(
    (generation: number): boolean => layoutOperationGenerationRef.current?.isCurrent(generation) ?? false,
    []
  );

  return {
    ...state,
    mutate,
    previewNodePositions,
    setNodePositions,
    setViewport,
    setDoc,
    reload: load,
    reloadWorld,
    reloadLayout,
    save,
    pauseLayoutAutosave,
    resumeLayoutAutosave,
    retryLayoutSave,
    getCurrentLayoutRevision,
    keepStudioLayout,
    discardLayoutChanges,
    hasUnsavedChanges,
    hasUnsavedWorld,
    hasUnsavedLayout,
    getLayoutOperationGeneration,
    isLayoutOperationCurrent
  };
}
