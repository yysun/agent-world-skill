// Central client-side state for the in-memory WorldDocument and Layout,
// which are the editor's single source of truth (plan Decisions -> "Graph
// model"). All edits go through `mutate`, a pure workflow/mutate.ts-style
// function applied to the current document; every successful call marks
// the document dirty.
//
// Also owns saving (PUT /api/world), validation-error state (from a
// rejected save, from a proactive check of a freshly loaded world, or from
// an explicit `validate()` call), and the dirty flag external-change
// conflict handling reads (state/ConflictHandler.tsx owns the conflict
// prompt itself; this module only exposes `reload` and the dirty flag it
// branches on).
import { useCallback, useEffect, useState } from 'react';
import type { WorldDocument, Layout, LayoutPosition, ValidationError } from '../../shared/models.js';
import { EMPTY_LAYOUT } from '../../shared/models.js';

export interface WorldState {
  doc: WorldDocument | null;
  layout: Layout;
  exists: boolean;
  loading: boolean;
  error: string | null;
  dirty: boolean;
  saving: boolean;
  validationErrors: ValidationError[];
  /** Incremented by every edit. Lets `save()` tell whether new edits landed while its request was in flight, since the response only proves that *particular* snapshot was persisted. */
  revision: number;
}

export interface WorldStateApi extends WorldState {
  mutate: (fn: (doc: WorldDocument) => WorldDocument) => void;
  setNodePositions: (positions: Record<string, LayoutPosition>) => void;
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  setDoc: (doc: WorldDocument) => void;
  reload: () => void;
  save: () => Promise<boolean>;
}

const INITIAL_STATE: WorldState = {
  doc: null,
  layout: EMPTY_LAYOUT,
  exists: false,
  loading: true,
  error: null,
  dirty: false,
  saving: false,
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

export function useWorldState(): WorldStateApi {
  const [state, setState] = useState<WorldState>(INITIAL_STATE);

  const load = useCallback(() => {
    setState(s => ({ ...s, loading: true, error: null }));
    fetch('/api/world')
      .then(res => {
        if (!res.ok) throw new Error(`World request failed: ${res.status}`);
        return res.json() as Promise<{ exists: boolean; world: WorldDocument | null; layout: Layout }>;
      })
      .then(async body => {
        const validationErrors = body.world ? await validateLoadedWorld(body.world) : [];
        setState({
          doc: body.world,
          layout: body.layout,
          exists: body.exists,
          loading: false,
          error: null,
          dirty: false,
          saving: false,
          validationErrors,
          revision: 0
        });
      })
      .catch((err: Error) => setState(s => ({ ...s, loading: false, error: err.message })));
  }, []);

  useEffect(load, [load]);

  const mutate = useCallback((fn: (doc: WorldDocument) => WorldDocument) => {
    setState(s => (s.doc ? { ...s, doc: fn(s.doc), dirty: true, revision: s.revision + 1 } : s));
  }, []);

  const setNodePositions = useCallback((positions: Record<string, LayoutPosition>) => {
    setState(s => ({
      ...s,
      layout: { ...s.layout, nodes: { ...s.layout.nodes, ...positions } },
      dirty: true,
      revision: s.revision + 1
    }));
  }, []);

  // Viewport pan/zoom rides along with the next save but is not itself a
  // workflow edit, so it does not trip the external-change conflict flag.
  const setViewport = useCallback((viewport: { x: number; y: number; zoom: number }) => {
    setState(s => ({ ...s, layout: { ...s.layout, viewport } }));
  }, []);

  const setDoc = useCallback((doc: WorldDocument) => {
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
    let currentLayout: Layout = EMPTY_LAYOUT;
    let savedRevision = -1;
    setState(s => {
      currentDoc = s.doc;
      currentLayout = s.layout;
      savedRevision = s.revision;
      return { ...s, saving: true };
    });
    if (!currentDoc) return Promise.resolve(false);

    return fetch('/api/world', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ world: currentDoc, layout: currentLayout })
    })
      .then(async res => {
        if (!res.ok) {
          const body = (await res.json()) as { errors: ValidationError[] };
          setState(s => ({ ...s, saving: false, validationErrors: body.errors }));
          return false;
        }
        setState(s => ({ ...s, saving: false, dirty: s.revision !== savedRevision, validationErrors: [] }));
        return true;
      })
      .catch((err: Error) => {
        setState(s => ({ ...s, saving: false, validationErrors: [{ pointer: '', message: err.message }] }));
        return false;
      });
  }, []);

  return { ...state, mutate, setNodePositions, setViewport, setDoc, reload: load, save };
}
