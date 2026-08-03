// One event bus per server process, shared by every connected SSE client
// (GET /api/events). Assigns an incrementing event id, cleans up a client's
// registration on connection close, and emits a heartbeat comment line so
// idle connections and proxies don't time the stream out.
import type { Response } from 'express';
import type { StudioEvent } from '../shared/events.js';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 20000;

export class EventBus {
  private readonly clients = new Set<Response>();
  private nextId = 1;
  private readonly heartbeatTimer: ReturnType<typeof setInterval>;

  // heartbeatIntervalMs is only ever overridden by tests (see cli.ts's
  // STUDIO_HEARTBEAT_INTERVAL_MS), so a 20s heartbeat doesn't force every
  // heartbeat test to wait 20+ real seconds.
  constructor(heartbeatIntervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS) {
    this.heartbeatTimer = setInterval(() => this.heartbeat(), heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  addClient(res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  publish(event: StudioEvent): void {
    const id = this.nextId++;
    const payload = `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }

  private heartbeat(): void {
    for (const client of this.clients) {
      client.write(': heartbeat\n\n');
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.heartbeatTimer);
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }
}
