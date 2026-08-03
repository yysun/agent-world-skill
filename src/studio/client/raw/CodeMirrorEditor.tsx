// Thin React wrapper around a CodeMirror 6 EditorView. Used by
// PromptEditor.tsx (editable Markdown) and RawJsonView.tsx (read-only
// JSON). The view is created once; external `value` changes not caused by
// the view itself are pushed in via a dispatched transaction so this stays
// a controlled component without tearing down the editor on every render.
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, type Extension } from '@codemirror/state';

export interface CodeMirrorEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  extensions?: Extension[];
}

export function CodeMirrorEditor({ value, onChange, readOnly = false, extensions = [] }: CodeMirrorEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of(update => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
        ...extensions
      ]
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Editor is constructed once per mount; `value` updates flow through the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className="studio-codemirror" />;
}
