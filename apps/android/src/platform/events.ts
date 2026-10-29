export class Events {
  private listeners = new Map<string, Set<(value: any) => void>>();
  on(name: string, listener: (value: any) => void): () => void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener);
    return () => { this.listeners.get(name)?.delete(listener); };
  }
  emit(name: string, value: unknown): void { for (const listener of this.listeners.get(name) || []) listener(value); }
}
