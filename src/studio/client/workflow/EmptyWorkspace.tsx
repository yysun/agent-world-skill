// Shown when the server reports the world absent (REQ Acceptance Criteria
// -> Rendering: "A project with no world file opens as an empty, editable
// workspace rather than an error state"). Offers the affordance to create
// the first node and agent rather than an error state.
export interface EmptyWorkspaceProps {
  onCreateFirstNode: () => void;
}

export function EmptyWorkspace({ onCreateFirstNode }: EmptyWorkspaceProps): JSX.Element {
  return (
    <div className="studio-canvas studio-canvas--empty">
      <p>This project has no workflow yet.</p>
      <button type="button" onClick={onCreateFirstNode}>
        Create the first node and agent
      </button>
    </div>
  );
}
