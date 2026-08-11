// Pure conflict-source accumulation for Studio's file watcher and reconnect
// flow. A later event must never erase an earlier unresolved source. Reconnect
// classification is driven by resource-scoped dirty state: clean resources
// reload independently, while only dirty world/layout resources become a
// conflict kind.
export type ConflictKind = 'world' | 'layout' | 'both';

export function mergeConflictKind(current: ConflictKind | null, incoming: ConflictKind): ConflictKind {
  if (current === null) return incoming;
  if (current === incoming) return current;
  if (current === 'both' || incoming === 'both') return 'both';
  return 'both';
}

/** Classifies only resources whose local state would be lost by a reload. */
export function conflictKindForDirtyResources(
  worldDirty: boolean,
  layoutDirty: boolean
): ConflictKind | null {
  if (worldDirty && layoutDirty) return 'both';
  if (worldDirty) return 'world';
  if (layoutDirty) return 'layout';
  return null;
}

/** Async conflict actions may resolve only the exact event generation on which the user acted. */
export function isCurrentConflictVersion(current: number, resolving: number): boolean {
  return current === resolving;
}
