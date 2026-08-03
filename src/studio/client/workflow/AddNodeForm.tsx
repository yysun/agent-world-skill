// Toolbar form for adding a workflow node (REQ Acceptance Criteria -> Graph
// editing: "A user can add a node"). The new node id is validated against
// the schema's identifier pattern before the add is enabled; the assigned
// agent must be one of the world's existing agents.
import { useState } from 'react';
import { isValidIdentifier } from './model.js';

export interface AddNodeFormProps {
  agentIds: string[];
  existingNodeIds: string[];
  onAdd: (nodeId: string, agentId: string) => void;
}

export function AddNodeForm({ agentIds, existingNodeIds, onAdd }: AddNodeFormProps): JSX.Element {
  const [nodeId, setNodeId] = useState('');
  const [agentId, setAgentId] = useState(agentIds[0] ?? '');

  const idValid = nodeId.length > 0 && isValidIdentifier(nodeId) && !existingNodeIds.includes(nodeId);
  const canAdd = idValid && agentId.length > 0;

  return (
    <div className="studio-toolbar__form">
      <input placeholder="new node id" value={nodeId} onChange={e => setNodeId(e.target.value)} />
      <select value={agentId} onChange={e => setAgentId(e.target.value)}>
        {agentIds.map(id => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => {
          onAdd(nodeId, agentId);
          setNodeId('');
        }}
      >
        Add node
      </button>
    </div>
  );
}
