// Studio client shell: proves the token handshake, GET /api/workspace, and
// a live GET /api/events connection (inherited from the server story), and
// hosts the Design surface this story adds -- the workflow canvas
// (workflow/Canvas.tsx), the world/node/agent property panels
// (properties/*.tsx), the graph-editing confirmations
// (workflow/ConfirmDialog.tsx), saving and validation feedback
// (state/ValidationBanner.tsx), and external-change conflict handling
// (state/ConflictPrompt.tsx, state/CompareView.tsx) -- all backed by the
// in-memory WorldDocument (state/useWorldState.ts), the single source of
// truth every mutation flows through so the canvas re-derives rather than
// holding independent state.
import { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { WorldSection, AgentConfig } from '../shared/models.js';
import type { StudioEvent } from '../shared/events.js';
import { Canvas } from './workflow/Canvas.js';
import { EmptyWorkspace } from './workflow/EmptyWorkspace.js';
import { AddNodeForm } from './workflow/AddNodeForm.js';
import { ConfirmDialog } from './workflow/ConfirmDialog.js';
import {
  connectEdge,
  disconnectEdge,
  addNode,
  addAgent,
  deleteNode,
  deleteAgent,
  renameAgent,
  setEntry,
  setNodeAgent,
  setNodeInstruction,
  setRequires,
  updateWorldSettings,
  updateAgentSettings,
  createInitialWorldDocument
} from './workflow/mutate.js';
import { describeNodeReferences, listAgentIds, nodesAssignedToAgent } from './workflow/model.js';
import { computeAutoLayout } from './workflow/layout.js';
import { NodePanel } from './properties/NodePanel.js';
import { AgentPanel } from './properties/AgentPanel.js';
import { WorldPanel } from './properties/WorldPanel.js';
import { PromptEditor } from './prompts/PromptEditor.js';
import { RawJsonView } from './raw/RawJsonView.js';
import { useWorldState } from './state/useWorldState.js';
import { ValidationBanner } from './state/ValidationBanner.js';
import { ConflictPrompt } from './state/ConflictPrompt.js';
import { CompareView } from './state/CompareView.js';

interface WorkspaceInfo {
  projectRoot: string;
  hasWorld: boolean;
}

// The toolbar has little room, so only the project's folder name is shown
// there; the full path is still available via the element's title tooltip.
function projectRootLabel(projectRoot: string): string {
  const segments = projectRoot.split(/[/\\]+/).filter(Boolean);
  return segments[segments.length - 1] ?? projectRoot;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'session-expired';

type PendingDelete =
  | { kind: 'node'; nodeId: string; outgoingEdges: string[]; incomingEdges: string[]; requiredBy: string[] }
  | { kind: 'agent-confirm'; agentId: string }
  | { kind: 'agent-blocked'; agentId: string; blockingNodeIds: string[] }
  | null;

export function App(): JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [editingPromptAgentId, setEditingPromptAgentId] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [layoutRunning, setLayoutRunning] = useState(false);
  const [showConflictPrompt, setShowConflictPrompt] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  const world = useWorldState();

  // Read by the SSE handler below, which is mounted once and must not
  // reconnect the stream every time a mutation flips the dirty flag.
  const dirtyRef = useRef(world.dirty);
  useEffect(() => {
    dirtyRef.current = world.dirty;
  }, [world.dirty]);

  useEffect(() => {
    fetch('/api/workspace')
      .then(res => {
        if (!res.ok) throw new Error(`Workspace request failed: ${res.status}`);
        return res.json() as Promise<WorkspaceInfo>;
      })
      .then(setWorkspace)
      .catch((err: Error) => setWorkspaceError(err.message));
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/events');
    let hasConnectedOnce = false;

    source.onopen = () => {
      setStatus('connected');
      // Events published while disconnected are never replayed, so a
      // reconnect re-fetches the world outright rather than trusting stale
      // state. The very first connection does not count as a reconnect.
      if (hasConnectedOnce) world.reload();
      hasConnectedOnce = true;
    };
    source.onerror = () => {
      // A transient drop leaves the stream CONNECTING while the browser
      // retries automatically, and this app's own onopen handling above
      // resumes receiving changes once it succeeds. A CLOSED stream means
      // the browser gave up for good -- in practice this happens when the
      // server process was restarted: its session token is freshly
      // randomized per launch (see README's Design-surface constraints
      // note), so the old session cookie no longer authenticates and the
      // browser will not retry a non-2xx response on its own. No amount of
      // client-side retry can recover from that; the user has to relaunch
      // Studio and open the newly printed URL.
      setStatus(source.readyState === EventSource.CLOSED ? 'session-expired' : 'disconnected');
    };
    source.onmessage = event => {
      let studioEvent: StudioEvent;
      try {
        studioEvent = JSON.parse(event.data) as StudioEvent;
      } catch {
        return;
      }
      if (studioEvent.type !== 'file.changed') return;
      // Studio's own writes are already reflected in local state; only an
      // externally sourced change needs the reload-or-conflict decision.
      if (studioEvent.source === 'studio') return;
      if (dirtyRef.current) {
        setShowConflictPrompt(true);
      } else {
        world.reload();
      }
    };

    return () => source.close();
    // world.reload is stable (useCallback with no deps in useWorldState).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateFirstNode = (): void => {
    const agentId = 'agent1';
    const nodeId = 'n1';
    const promptPath = `prompts/${agentId}.md`;
    // The new agent's prompt file cannot be created here: PUT
    // /api/prompts/:agentId requires the agent to already exist in the
    // world the server has on disk (Workspace#writePrompt reads
    // Workspace#readWorld, not this in-memory document), and that file
    // must already exist before a save can pass the router's own
    // validation. Both directions require the other to have happened
    // first, so the very first save is expected to fail until the prompt
    // file exists by some other means (e.g. a project template, or the
    // user creating it by hand) -- the rejected save's validation error
    // names the missing path so the user knows what to do next.
    world.setDoc(createInitialWorldDocument(nodeId, agentId, promptPath));
    setSelectedNodeId(nodeId);
  };

  const requestDeleteNode = (nodeId: string): void => {
    if (!world.doc) return;
    const refs = describeNodeReferences(world.doc, nodeId);
    setPendingDelete({ kind: 'node', nodeId, ...refs });
  };

  const requestDeleteAgent = (agentId: string): void => {
    if (!world.doc) return;
    const blockingNodeIds = nodesAssignedToAgent(world.doc, agentId);
    if (blockingNodeIds.length > 0) {
      setPendingDelete({ kind: 'agent-blocked', agentId, blockingNodeIds });
    } else {
      setPendingDelete({ kind: 'agent-confirm', agentId });
    }
  };

  const confirmPendingDelete = (): void => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === 'node') {
      world.mutate(doc => deleteNode(doc, pendingDelete.nodeId));
      if (selectedNodeId === pendingDelete.nodeId) setSelectedNodeId(null);
    } else if (pendingDelete.kind === 'agent-confirm') {
      world.mutate(doc => {
        const result = deleteAgent(doc, pendingDelete.agentId);
        return result.ok ? result.doc : doc;
      });
      if (selectedAgentId === pendingDelete.agentId) setSelectedAgentId(null);
    }
    setPendingDelete(null);
  };

  const dismissPendingDelete = (): void => setPendingDelete(null);

  const handleAutoLayout = (): void => {
    if (!world.doc || layoutRunning) return;
    setLayoutRunning(true);
    computeAutoLayout(world.doc, world.layout)
      .then(positions => world.setNodePositions(positions))
      .finally(() => setLayoutRunning(false));
  };

  const handleReload = (): void => {
    world.reload();
    setShowConflictPrompt(false);
    setShowCompare(false);
  };

  const handleKeepStudioVersion = (): void => {
    setShowConflictPrompt(false);
    setShowCompare(false);
  };

  const agentIds = world.doc ? listAgentIds(world.doc) : [];
  const nodeIds = world.doc ? Object.keys(world.doc.workflow.nodes) : [];

  return (
    <div className="app">
    <div className="studio-layout">
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header className="studio-toolbar">
          <strong>Agent World Studio</strong>
          {workspaceError && <span role="alert">{workspaceError}</span>}
          {workspace && (
            <span title={workspace.projectRoot}>{projectRootLabel(workspace.projectRoot)}</span>
          )}
          <span role={status === 'session-expired' ? 'alert' : undefined}>
            {status === 'session-expired'
              ? 'Event stream: session expired -- relaunch Studio and open the new URL to reconnect.'
              : `Event stream: ${status}`}
          </span>
          {world.doc && (
            <AddNodeForm
              agentIds={agentIds}
              existingNodeIds={nodeIds}
              onAdd={(nodeId, agentId) => {
                world.mutate(doc => addNode(doc, nodeId, agentId));
                setSelectedNodeId(nodeId);
              }}
            />
          )}
          {world.doc && (
            <button type="button" onClick={handleAutoLayout} disabled={layoutRunning}>
              Auto layout
            </button>
          )}
          {world.doc && (
            <button type="button" onClick={() => setShowRawJson(true)}>
              Raw JSON
            </button>
          )}
          {world.doc && (
            <button
              type="button"
              className="studio-btn--primary"
              onClick={() => world.save()}
              disabled={world.saving || !world.dirty}
            >
              {world.saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </header>
        <ValidationBanner errors={world.validationErrors} />
        {world.loading && <p>Loading workspace...</p>}
        {world.error && <p role="alert">{world.error}</p>}
        {!world.loading &&
          !world.error &&
          (world.doc ? (
            <ReactFlowProvider>
              <Canvas
                doc={world.doc}
                layout={world.layout}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onNodePositionsChange={world.setNodePositions}
                onConnect={(source, target) => world.mutate(doc => connectEdge(doc, source, target))}
                onDisconnect={(source, target) => world.mutate(doc => disconnectEdge(doc, source, target))}
                onViewportChange={world.setViewport}
                validationErrors={world.validationErrors}
              />
            </ReactFlowProvider>
          ) : (
            <EmptyWorkspace onCreateFirstNode={handleCreateFirstNode} />
          ))}
      </main>

      {world.doc && (
        <aside className="studio-sidebar">
          <WorldPanel
            doc={world.doc}
            onChange={(patch: Partial<WorldSection>) => world.mutate(doc => updateWorldSettings(doc, patch))}
            onRenameId={newId => world.mutate(doc => updateWorldSettings(doc, { id: newId }))}
          />

          {selectedNodeId && (
            <NodePanel
              doc={world.doc}
              nodeId={selectedNodeId}
              isEntry={world.doc.workflow.entry === selectedNodeId}
              onChangeAgent={agentId => world.mutate(doc => setNodeAgent(doc, selectedNodeId, agentId))}
              onChangeInstruction={instruction => world.mutate(doc => setNodeInstruction(doc, selectedNodeId, instruction))}
              onChangeRequires={requires => world.mutate(doc => setRequires(doc, selectedNodeId, requires))}
              onSetEntry={() => world.mutate(doc => setEntry(doc, selectedNodeId))}
              onRequestDelete={() => requestDeleteNode(selectedNodeId)}
            />
          )}

          <AgentPanel
            doc={world.doc}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
            onRenameAgent={(oldId, newId) => {
              world.mutate(doc => renameAgent(doc, oldId, newId));
              setSelectedAgentId(newId);
            }}
            onUpdateAgentField={(agentId, patch: Partial<AgentConfig>) =>
              world.mutate(doc => updateAgentSettings(doc, agentId, patch))
            }
            onAddAgent={(agentId, promptPath) => world.mutate(doc => addAgent(doc, agentId, promptPath))}
            onRequestDeleteAgent={requestDeleteAgent}
            onEditPrompt={setEditingPromptAgentId}
          />
        </aside>
      )}

      {editingPromptAgentId && (
        <PromptEditor agentId={editingPromptAgentId} onClose={() => setEditingPromptAgentId(null)} />
      )}

      {showRawJson && world.doc && <RawJsonView doc={world.doc} onClose={() => setShowRawJson(false)} />}

      {pendingDelete && pendingDelete.kind === 'node' && (
        <ConfirmDialog
          title={`Delete node "${pendingDelete.nodeId}"?`}
          message="This will also remove the following references:"
          items={[
            ...pendingDelete.outgoingEdges,
            ...pendingDelete.incomingEdges,
            ...pendingDelete.requiredBy.map(id => `${pendingDelete.nodeId} required by ${id}`)
          ]}
          onConfirm={confirmPendingDelete}
          onCancel={dismissPendingDelete}
        />
      )}

      {pendingDelete && pendingDelete.kind === 'agent-confirm' && (
        <ConfirmDialog
          title={`Delete agent "${pendingDelete.agentId}"?`}
          message="This agent is not assigned to any workflow node."
          onConfirm={confirmPendingDelete}
          onCancel={dismissPendingDelete}
        />
      )}

      {pendingDelete && pendingDelete.kind === 'agent-blocked' && (
        <ConfirmDialog
          title={`Cannot delete agent "${pendingDelete.agentId}"`}
          message="Reassign or remove these nodes first:"
          items={pendingDelete.blockingNodeIds}
          blocked
          onConfirm={dismissPendingDelete}
          onCancel={dismissPendingDelete}
        />
      )}

      {showConflictPrompt && !showCompare && (
        <ConflictPrompt
          onReload={handleReload}
          onCompare={() => setShowCompare(true)}
          onKeepStudioVersion={handleKeepStudioVersion}
        />
      )}

      {showCompare && world.doc && (
        <CompareView
          studioDoc={world.doc}
          onReload={handleReload}
          onKeepStudioVersion={handleKeepStudioVersion}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
    </div>
  );
}
