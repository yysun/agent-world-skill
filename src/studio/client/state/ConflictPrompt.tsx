// Offered when a watched project file changes outside Studio while there
// are unsaved edits (REQ Acceptance Criteria -> External changes; plan
// Decisions -> "Conflict handling"; agent-world-studio-mvp.md §18.2).
// Reload and Keep Studio Version are immediate; Compare hands off to
// CompareView, which offers the same two follow-on actions.
export interface ConflictPromptProps {
  onReload: () => void;
  onCompare: () => void;
  onKeepStudioVersion: () => void;
}

export function ConflictPrompt({ onReload, onCompare, onKeepStudioVersion }: ConflictPromptProps): JSX.Element {
  return (
    <div className="studio-dialog-backdrop" role="dialog" aria-modal="true" aria-label="External change detected">
      <div className="studio-dialog">
        <h2>This project changed outside Studio</h2>
        <p>You have unsaved edits. Choose how to proceed.</p>
        <div className="studio-dialog__actions">
          <button type="button" onClick={onKeepStudioVersion}>
            Keep Studio Version
          </button>
          <button type="button" onClick={onCompare}>
            Compare
          </button>
          <button type="button" onClick={onReload}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
