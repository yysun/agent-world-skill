// Read-only view of the current in-memory world document as serialized
// JSON (REQ Acceptance Criteria -> Prompts and raw view: "A user can view
// the raw world JSON for the current in-memory graph"). Reflects unsaved
// edits, since it serializes `doc` directly rather than re-fetching from
// the server.
import { json } from '@codemirror/lang-json';
import { CodeMirrorEditor } from './CodeMirrorEditor.js';
import type { WorldDocument } from '../../shared/models.js';

export interface RawJsonViewProps {
  doc: WorldDocument;
  onClose: () => void;
}

export function RawJsonView({ doc, onClose }: RawJsonViewProps): JSX.Element {
  const serialized = JSON.stringify(doc, null, 2);

  return (
    <div className="studio-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Raw world JSON">
      <div className="studio-dialog studio-dialog--wide">
        <h2>Raw JSON</h2>
        <CodeMirrorEditor value={serialized} readOnly extensions={[json()]} />
        <div className="studio-dialog__actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
