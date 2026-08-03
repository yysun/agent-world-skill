// Loads an agent's prompt Markdown from GET /api/prompts/:agentId, edits
// it in a CodeMirror Markdown editor, and saves it back through PUT
// /api/prompts/:agentId (REQ Acceptance Criteria -> Prompts and raw view).
//
// Both routes 404 for an agent that only exists in the in-memory,
// not-yet-saved document: the server resolves promptPath from the world it
// has on disk (Workspace#readWorld), not from this client's pending edits.
// That 404 carries a real message ("Unknown agent: <id>"), which this
// component surfaces directly rather than replacing with a generic status
// code, since it is the clearest way to tell the user to save the world
// first.
import { useEffect, useState } from 'react';
import { markdown } from '@codemirror/lang-markdown';
import { CodeMirrorEditor } from '../raw/CodeMirrorEditor.js';
import type { ValidationError } from '../../shared/models.js';

export interface PromptEditorProps {
  agentId: string;
  onClose: () => void;
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { errors?: ValidationError[] };
    return body.errors?.[0]?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function PromptEditor({ agentId, onClose }: PromptEditorProps): JSX.Element {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    fetch(`/api/prompts/${agentId}`)
      .then(async res => {
        if (!res.ok) throw new Error(await extractErrorMessage(res, `Prompt request failed: ${res.status}`));
        return res.json() as Promise<{ agentId: string; content: string }>;
      })
      .then(body => {
        setContent(body.content);
        setDirty(false);
        setLoading(false);
      })
      .catch((err: Error) => {
        setLoadError(err.message);
        setLoading(false);
      });
  }, [agentId]);

  const handleSave = (): void => {
    setSaveError(null);
    fetch(`/api/prompts/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    })
      .then(async res => {
        if (!res.ok) throw new Error(await extractErrorMessage(res, `Save failed: ${res.status}`));
        setDirty(false);
      })
      .catch((err: Error) => setSaveError(err.message));
  };

  return (
    <div className="studio-dialog-backdrop" role="dialog" aria-modal="true" aria-label={`Prompt: ${agentId}`}>
      <div className="studio-dialog studio-dialog--wide">
        <h2>Prompt: {agentId}</h2>
        {loading && <p>Loading prompt...</p>}
        {loadError && <p role="alert">{loadError}</p>}
        {!loading && !loadError && (
          <CodeMirrorEditor
            value={content}
            onChange={next => {
              setContent(next);
              setDirty(true);
            }}
            extensions={[markdown()]}
          />
        )}
        {saveError && (
          <p role="alert" className="studio-field__error">
            {saveError}
          </p>
        )}
        <div className="studio-dialog__actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" onClick={handleSave} disabled={!dirty}>
            Save prompt
          </button>
        </div>
      </div>
    </div>
  );
}
