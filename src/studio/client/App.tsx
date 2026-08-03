// Minimal Studio shell: proves the token handshake, GET /api/workspace, and
// a live GET /api/events connection end to end. This is the real
// application shell the editor story builds into, but it contains no
// canvas, no property panel, and no run/stop/continue affordance of any
// kind -- those belong to the editor story (REQ Non-Goals).
import { useEffect, useState } from 'react';

interface WorkspaceInfo {
  projectRoot: string;
  hasWorld: boolean;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function App(): JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    fetch('/api/workspace')
      .then(res => {
        if (!res.ok) throw new Error(`Workspace request failed: ${res.status}`);
        return res.json() as Promise<WorkspaceInfo>;
      })
      .then(setWorkspace)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setStatus('connected');
    source.onerror = () => setStatus('disconnected');
    return () => source.close();
  }, []);

  return (
    <main>
      <h1>Agent World Studio</h1>
      {error && <p role="alert">{error}</p>}
      {workspace ? (
        <dl>
          <dt>Project root</dt>
          <dd>{workspace.projectRoot}</dd>
          <dt>World</dt>
          <dd>{workspace.hasWorld ? 'loaded' : 'absent'}</dd>
        </dl>
      ) : (
        !error && <p>Loading workspace...</p>
      )}
      <p>Event stream: {status}</p>
    </main>
  );
}
