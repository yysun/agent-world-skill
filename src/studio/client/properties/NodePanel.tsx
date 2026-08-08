// Edits the selected workflow node's assigned agent, instruction, and
// `requires` prerequisites (REQ Acceptance Criteria -> Property editing),
// and hosts the entry and delete actions for that node (REQ Acceptance
// Criteria -> Graph editing). Reads directly from the WorldDocument rather
// than holding its own copy, since the document is the single source of
// truth (plan Decisions -> "Graph model").
import type { WorldDocument } from '../../shared/models.js';
import { getNode, listNodeIds, listAgentIds } from '../workflow/model.js';

export interface NodePanelProps {
  doc: WorldDocument;
  nodeId: string;
  isEntry: boolean;
  onChangeAgent: (agentId: string) => void;
  onChangeInstruction: (instruction: string) => void;
  onChangeRequires: (requires: string[]) => void;
  onSetEntry: () => void;
  onRequestDelete: () => void;
}

export function NodePanel({
  doc,
  nodeId,
  isEntry,
  onChangeAgent,
  onChangeInstruction,
  onChangeRequires,
  onSetEntry,
  onRequestDelete
}: NodePanelProps): JSX.Element {
  const node = getNode(doc, nodeId);
  if (!node) return <div className="studio-panel">Node not found.</div>;

  const agentIds = listAgentIds(doc);
  const otherNodeIds = listNodeIds(doc).filter(id => id !== nodeId);
  const requires = node.requires ?? [];

  const toggleRequires = (id: string): void => {
    const next = requires.includes(id) ? requires.filter(r => r !== id) : [...requires, id];
    onChangeRequires(next);
  };

  return (
    <section className="studio-panel">
      <h2>{nodeId}</h2>
      {isEntry && <p className="studio-node__entry-badge">Entry node</p>}

      <div className="studio-field">
        <label htmlFor="node-agent">Assigned agent</label>
        <select id="node-agent" value={node.agent} onChange={e => onChangeAgent(e.target.value)}>
          {agentIds.map(id => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>

      <div className="studio-field">
        <label htmlFor="node-instruction">Instruction</label>
        <textarea
          id="node-instruction"
          value={node.instruction ?? ''}
          onChange={e => onChangeInstruction(e.target.value)}
          rows={4}
        />
      </div>

      <div className="studio-field">
        <label>Requires</label>
        {otherNodeIds.length === 0 && <p>No other nodes.</p>}
        {otherNodeIds.map(id => (
          <label key={id} className="studio-checkbox-row">
            <input type="checkbox" checked={requires.includes(id)} onChange={() => toggleRequires(id)} /> {id}
          </label>
        ))}
      </div>

      <div className="studio-field">
        <button type="button" onClick={onSetEntry} disabled={isEntry}>
          Set as entry
        </button>
      </div>

      <div className="studio-field">
        <button type="button" className="studio-btn--danger" onClick={onRequestDelete}>
          Delete node
        </button>
      </div>
    </section>
  );
}
