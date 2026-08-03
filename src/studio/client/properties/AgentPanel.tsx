// Lists agents, edits the selected agent's identifier, display name, role,
// prompt path, and context scope (REQ Acceptance Criteria -> Property
// editing), and hosts add/delete agent affordances (REQ Acceptance
// Criteria -> Graph editing). Identifier edits are routed through the
// rename operation rather than treated as a new key, per plan Decisions ->
// "Editing semantics", and are rejected at the field when they violate the
// schema's identifier pattern, without waiting for a save.
import { useState } from 'react';
import type { WorldDocument, AgentConfig } from '../../shared/models.js';
import { listAgentIds, getAgent, isValidIdentifier } from '../workflow/model.js';
import { IdentifierField } from './IdentifierField.js';

export interface AgentPanelProps {
  doc: WorldDocument;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
  onRenameAgent: (oldId: string, newId: string) => void;
  onUpdateAgentField: (agentId: string, patch: Partial<AgentConfig>) => void;
  onAddAgent: (agentId: string, promptPath: string) => void;
  onRequestDeleteAgent: (agentId: string) => void;
  onEditPrompt: (agentId: string) => void;
}

export function AgentPanel({
  doc,
  selectedAgentId,
  onSelectAgent,
  onRenameAgent,
  onUpdateAgentField,
  onAddAgent,
  onRequestDeleteAgent,
  onEditPrompt
}: AgentPanelProps): JSX.Element {
  const [newAgentId, setNewAgentId] = useState('');
  const [newPromptPath, setNewPromptPath] = useState('');

  const agentIds = listAgentIds(doc);
  const selected = selectedAgentId ? getAgent(doc, selectedAgentId) : undefined;

  const newAgentIdValid = newAgentId.length > 0 && isValidIdentifier(newAgentId);
  const newAgentIdTaken = agentIds.includes(newAgentId);

  return (
    <section className="studio-panel">
      <h2>Agents</h2>
      <ul>
        {agentIds.map(id => (
          <li key={id}>
            <button type="button" onClick={() => onSelectAgent(id === selectedAgentId ? null : id)}>
              {id}
            </button>
            <button type="button" onClick={() => onRequestDeleteAgent(id)} aria-label={`Delete agent ${id}`}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      {selectedAgentId && selected && (
        <div>
          <IdentifierField
            label="Identifier"
            value={selectedAgentId}
            onCommit={next => onRenameAgent(selectedAgentId, next)}
          />
          <div className="studio-field">
            <label htmlFor="agent-name">Display name</label>
            <input
              id="agent-name"
              value={selected.name ?? ''}
              onChange={e => onUpdateAgentField(selectedAgentId, { name: e.target.value || undefined })}
            />
          </div>
          <div className="studio-field">
            <label htmlFor="agent-role">Role</label>
            <input
              id="agent-role"
              value={selected.role ?? ''}
              onChange={e => onUpdateAgentField(selectedAgentId, { role: e.target.value || undefined })}
            />
          </div>
          <div className="studio-field">
            <label htmlFor="agent-prompt-path">Prompt path</label>
            <input
              id="agent-prompt-path"
              value={selected.promptPath}
              onChange={e => onUpdateAgentField(selectedAgentId, { promptPath: e.target.value })}
            />
          </div>
          <div className="studio-field">
            <label htmlFor="agent-context-scope">Context scope</label>
            <select
              id="agent-context-scope"
              value={selected.contextScope ?? 'global'}
              onChange={e => onUpdateAgentField(selectedAgentId, { contextScope: e.target.value as AgentConfig['contextScope'] })}
            >
              <option value="global">global</option>
              <option value="agent">agent</option>
            </select>
          </div>
          <button type="button" onClick={() => onEditPrompt(selectedAgentId)}>
            Edit prompt
          </button>
        </div>
      )}

      <div className="studio-field">
        <label htmlFor="new-agent-id">New agent identifier</label>
        <input id="new-agent-id" value={newAgentId} onChange={e => setNewAgentId(e.target.value)} />
        {newAgentId.length > 0 && !newAgentIdValid && (
          <span className="studio-field__error">Only letters, digits, "_", and "-" are allowed.</span>
        )}
        {newAgentIdValid && newAgentIdTaken && <span className="studio-field__error">Identifier already in use.</span>}
      </div>
      <div className="studio-field">
        <label htmlFor="new-agent-prompt-path">Prompt path</label>
        <input id="new-agent-prompt-path" value={newPromptPath} onChange={e => setNewPromptPath(e.target.value)} />
      </div>
      <button
        type="button"
        disabled={!newAgentIdValid || newAgentIdTaken || newPromptPath.length === 0}
        onClick={() => {
          onAddAgent(newAgentId, newPromptPath);
          setNewAgentId('');
          setNewPromptPath('');
        }}
      >
        Add agent
      </button>
    </section>
  );
}
