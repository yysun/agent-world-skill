// Generic confirmation modal used before destructive node/agent edits (REQ
// Acceptance Criteria -> Graph editing: "Deleting a node or an agent is
// confirmed before it is applied, and the confirmation names what else
// will be removed"). Caller supplies the message naming what will also be
// removed; this component only renders it and reports confirm/cancel.
export interface ConfirmDialogProps {
  title: string;
  message: string;
  items?: string[];
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** When true, no destructive override is offered -- only a dismiss action (REQ: a blocked agent deletion offers no override). */
  blocked?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  items,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  blocked = false
}: ConfirmDialogProps): JSX.Element {
  return (
    <div className="studio-dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="studio-dialog">
        <h2>{title}</h2>
        <p>{message}</p>
        {items && items.length > 0 && (
          <ul>
            {items.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <div className="studio-dialog__actions">
          {blocked ? (
            <button type="button" onClick={onCancel}>
              OK
            </button>
          ) : (
            <>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" onClick={onConfirm}>
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
