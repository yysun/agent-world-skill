// Shared identifier input: rejects values violating the schema's
// `^[A-Za-z0-9_-]+$` pattern at the field itself, without waiting for a
// save (REQ Acceptance Criteria -> Property editing). Used by WorldPanel,
// AgentPanel, and the add-node/add-agent forms.
//
// `draft` resyncs to `value` whenever `value` changes for a reason other
// than this field's own commit (most notably: the caller switches which
// agent/world entity is selected, reusing the same JSX position without
// remounting). Without this, the previous entity's stale draft could blur
// and silently rename whatever is newly selected.
import { useEffect, useState } from 'react';
import { isValidIdentifier } from '../workflow/model.js';

export interface IdentifierFieldProps {
  value: string;
  label: string;
  onCommit: (next: string) => void;
}

export function IdentifierField({ value, label, onCommit }: IdentifierFieldProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const valid = isValidIdentifier(draft);

  return (
    <div className="studio-field">
      <label>{label}</label>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          if (valid && draft !== value) onCommit(draft);
          else if (!valid) setDraft(value);
        }}
      />
      {!valid && <span className="studio-field__error">Only letters, digits, "_", and "-" are allowed.</span>}
    </div>
  );
}
