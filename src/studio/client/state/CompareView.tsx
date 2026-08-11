// Read-only two-column diff between the in-memory Studio state and the
// on-disk external version. Semantic conflicts compare WorldDocument
// sections; layout conflicts compare node positions and viewport through
// the dedicated layout endpoint. Looking never resolves a conflict -- only
// Reload and Keep Studio Version do.
import { useEffect, useState } from 'react';
import type { Layout, WorldDocument } from '../../shared/models.js';
import type { LayoutGetResponse } from '../../shared/api.js';

export interface CompareViewProps {
  kind: 'world' | 'layout' | 'both';
  conflictVersion: number;
  studioDoc: WorldDocument;
  studioLayout: Layout;
  onReload: () => void;
  onKeepStudioVersion: () => void;
  onClose: () => void;
}

const TOP_LEVEL_KEYS: Array<keyof WorldDocument> = ['world', 'workflow', 'routing', 'agents'];

function sectionChanged(a: WorldDocument, b: WorldDocument, key: keyof WorldDocument): boolean {
  return JSON.stringify(a[key]) !== JSON.stringify(b[key]);
}

export function CompareView({
  kind,
  conflictVersion,
  studioDoc,
  studioLayout,
  onReload,
  onKeepStudioVersion,
  onClose
}: CompareViewProps): JSX.Element {
  const [externalDoc, setExternalDoc] = useState<WorldDocument | null>(null);
  const [externalLayout, setExternalLayout] = useState<Layout | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setExternalDoc(null);
    setExternalLayout(null);
    setLoadError(null);
    setLoading(true);
    const worldRequest =
      kind === 'layout'
        ? Promise.resolve(null)
        : fetch('/api/world', { signal: controller.signal }).then(async res => {
            if (!res.ok) throw new Error(`World request failed: ${res.status}`);
            return (await res.json()) as { world: WorldDocument | null };
          });
    const layoutRequest =
      kind === 'world'
        ? Promise.resolve(null)
        : fetch('/api/layout', { signal: controller.signal }).then(async res => {
            if (!res.ok) throw new Error(`Layout request failed: ${res.status}`);
            return (await res.json()) as LayoutGetResponse;
          });
    Promise.all([worldRequest, layoutRequest])
      .then(([worldBody, layoutBody]) => {
        if (cancelled) return;
        if (worldBody) setExternalDoc(worldBody.world);
        if (layoutBody) setExternalLayout(layoutBody.layout);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [kind, conflictVersion]);

  return (
    <div className="studio-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Compare Studio and external versions">
      <div className="studio-dialog studio-dialog--wide">
        <h2>Compare</h2>
        {loadError && <p role="alert">{loadError}</p>}
        {!loadError && loading && <p>Loading the on-disk version...</p>}
        {!loadError && !loading && kind !== 'layout' && !externalDoc && <p>The external world file is absent.</p>}
        {kind !== 'world' && externalLayout && (
          <div className="studio-diff-columns">
            <div>
              <h3>Studio (in-memory)</h3>
              <pre className={JSON.stringify(studioLayout) !== JSON.stringify(externalLayout) ? 'studio-diff-changed' : ''}>
                {JSON.stringify(studioLayout, null, 2)}
              </pre>
            </div>
            <div>
              <h3>External (on disk)</h3>
              <pre className={JSON.stringify(studioLayout) !== JSON.stringify(externalLayout) ? 'studio-diff-changed' : ''}>
                {JSON.stringify(externalLayout, null, 2)}
              </pre>
            </div>
          </div>
        )}
        {kind !== 'layout' && externalDoc && (
          <div className="studio-diff-columns">
            <div>
              <h3>Studio (in-memory)</h3>
              {TOP_LEVEL_KEYS.map(key => (
                <pre key={key} className={sectionChanged(studioDoc, externalDoc, key) ? 'studio-diff-changed' : ''}>
                  {key}: {JSON.stringify(studioDoc[key], null, 2)}
                </pre>
              ))}
            </div>
            <div>
              <h3>External (on disk)</h3>
              {TOP_LEVEL_KEYS.map(key => (
                <pre key={key} className={sectionChanged(studioDoc, externalDoc, key) ? 'studio-diff-changed' : ''}>
                  {key}: {JSON.stringify(externalDoc[key], null, 2)}
                </pre>
              ))}
            </div>
          </div>
        )}
        <div className="studio-dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onKeepStudioVersion}>
            Keep Studio Version
          </button>
          <button type="button" onClick={onReload}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
