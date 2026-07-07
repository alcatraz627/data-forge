type Listener = (seq: number) => void;

/** In-process pub/sub connecting index writes to SSE subscribers: any change
 * pokes every connected client to pull the change feed. */
export class Events {
  private listeners = new Set<Listener>();

  notify(seq: number): void {
    for (const l of this.listeners) l(seq);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
