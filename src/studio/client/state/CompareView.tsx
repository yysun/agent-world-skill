// Read-only two-column diff between the in-memory (Studio) world document
// and the on-disk (external) version, shown when the user chooses Compare
// from ConflictPrompt (plan Decisions -> "Conflict handling"). Fetches the
// on-disk copy directly rather than through state/useWorldState.ts, since
// looking does not itself resolve the conflict -- only Reload and Keep
// Studio Version do, and neither mutates from within this view; it only
// reports which the user picked.
import { useEffect, useState } from 'react';
import type { WorldDocument } from '../../shared/models.js';

export interface CompareViewProps {
  studioDoc: WorldDocument;
  onReload: () => void;
  onKeepStudioVersion: () => void;
  onClose: () => void;
}

const TOP_LEVEL_KEYS: Array<keyof WorldDocument> = ['world', 'workflow', 'routing', 'agents'];

function sectionChanged(a: WorldDocument, b: WorldDocument, key: keyof WorldDocument): boolean {
  return JSON.stringify(a[key]) !== JSON.stringify(b[key]);
}

export function CompareView({ studioDoc, onReload, onKeepStudioVersion, onClose }: CompareViewProps): JSX.Element {
  const [externalDoc, setExternalDoc] = useState<WorldDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/world')
      .then(res => {
        if (!res.ok) throw new Error(`World request failed: ${res.status}`);
        return res.json() as Promise<{ world: WorldDocument | null }>;
      })
      .then(body => setExternalDoc(body.world))
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  return (
    <div className="studio-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Compare Studio and external versions">
      <div className="studio-dialog studio-dialog--wide">
        <h2>Compare</h2>
        {loadError && <p role="alert">{loadError}</p>}
        {!loadError && !externalDoc && <p>Loading the on-disk version...</p>}
        {externalDoc && (
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
