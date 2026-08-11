// Synchronous generation guard for long-running client operations. Auto
// layout captures the current value before invoking ELK; any newer canvas
// edit, semantic graph edit, or resource reload invalidates that capture so
// an obsolete result cannot overwrite newer user work.
export class OperationGeneration {
  private value = 0;

  current(): number {
    return this.value;
  }

  invalidate(): number {
    this.value += 1;
    return this.value;
  }

  isCurrent(generation: number): boolean {
    return this.value === generation;
  }
}
