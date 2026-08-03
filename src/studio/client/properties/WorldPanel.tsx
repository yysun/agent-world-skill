// Edits the world identifier, name, turn limit, stop token, and mode (REQ
// Acceptance Criteria -> Property editing). Only these fields are exposed;
// every other field on `world` rides along untouched through
// mutate.ts#updateWorldSettings (plan Decisions -> "Round-trip preservation
// is enforced by construction").
import type { WorldDocument, WorldSection } from '../../shared/models.js';
import { IdentifierField } from './IdentifierField.js';

export interface WorldPanelProps {
  doc: WorldDocument;
  onChange: (patch: Partial<WorldSection>) => void;
  onRenameId: (newId: string) => void;
}

export function WorldPanel({ doc, onChange, onRenameId }: WorldPanelProps): JSX.Element {
  const world = doc.world;

  return (
    <section className="studio-panel">
      <h2>World</h2>
      <IdentifierField value={world.id} label="Identifier" onCommit={onRenameId} />

      <div className="studio-field">
        <label htmlFor="world-name">Name</label>
        <input id="world-name" value={world.name} onChange={e => onChange({ name: e.target.value })} />
      </div>

      <div className="studio-field">
        <label htmlFor="world-turn-limit">Turn limit</label>
        <input
          id="world-turn-limit"
          type="number"
          min={1}
          value={world.turnLimit ?? ''}
          onChange={e => onChange({ turnLimit: e.target.value ? Number(e.target.value) : undefined })}
        />
      </div>

      <div className="studio-field">
        <label htmlFor="world-stop-token">Stop token</label>
        <input
          id="world-stop-token"
          value={world.stopToken ?? ''}
          onChange={e => onChange({ stopToken: e.target.value || undefined })}
        />
      </div>

      <div className="studio-field">
        <label htmlFor="world-mode">Mode</label>
        <select
          id="world-mode"
          value={world.mode ?? 'host_driven_router_only'}
          onChange={e => onChange({ mode: e.target.value as WorldSection['mode'] })}
        >
          <option value="host_driven_router_only">host_driven_router_only</option>
          <option value="host_delegated">host_delegated</option>
        </select>
      </div>
    </section>
  );
}
