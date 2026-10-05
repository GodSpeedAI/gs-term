// Bounded in-memory scrollback ring for attach/reconnect replay.
// PTY bytes NEVER touch durable storage (instrumentation rule); this is a fixed-capacity
// memory buffer — dropping the oldest bytes when full, and saying so.
export class Scrollback {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;

  constructor(readonly capacityBytes: number) {
    if (capacityBytes <= 0) throw new Error("scrollback capacity must be positive");
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.capacityBytes && this.chunks.length > 0) {
      const head = this.chunks[0]!;
      const overflow = this.size - this.capacityBytes;
      if (head.length <= overflow) {
        this.chunks.shift();
        this.size -= head.length;
      } else {
        this.chunks[0] = head.subarray(overflow);
        this.size -= overflow;
      }
    }
  }

  /** Replay bytes in order (bounded to capacity). */
  replay(): Uint8Array {
    if (this.chunks.length === 0) return new Uint8Array(0);
    if (this.chunks.length === 1) return this.chunks[0]!;
    return this.chunks.reduce<Uint8Array>((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc, 0);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array(0));
  }

  get byteLength(): number {
    return this.size;
  }
}
