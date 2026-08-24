import type { OfficeEvent } from "./types";

type Handler = (ev: OfficeEvent) => void;

/**
 * The office websocket (`backend/app/api/office_ws.py`).
 *
 * The socket carries every run the user may see. Runs without a project — the assistant and
 * the scheduled jobs — reach their owner regardless of the subscribed scope, which is
 * exactly what the chat needs, so no `subscribe` message is sent: a narrowing to projects
 * would be a narrowing away from the assistant.
 */
export class OfficeSocket {
  private ws: WebSocket | null = null;
  private retry: number | null = null;
  private ping: number | null = null;
  private closed = false;

  constructor(
    private urlOf: () => string,
    private onEvent: Handler,
    private onStatus?: (connected: boolean) => void,
  ) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    let url: string;
    try {
      url = this.urlOf();
    } catch {
      return;
    }
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }

    this.ws.onopen = () => {
      this.onStatus?.(true);
      // Middleboxes cut silent connections; the server answers `ping` with `pong`.
      this.ping = window.setInterval(() => {
        try {
          this.ws?.send(JSON.stringify({ type: "ping" }));
        } catch {
          /* the close handler takes over */
        }
      }, 30_000);
    };

    this.ws.onmessage = (e) => {
      let data: { type?: string; ev?: OfficeEvent };
      try {
        data = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (data.type === "office_ev" && data.ev) this.onEvent(data.ev);
    };

    this.ws.onclose = () => {
      this.onStatus?.(false);
      this.clearPing();
      this.scheduleRetry();
    };

    this.ws.onerror = () => {
      try {
        this.ws?.close();
      } catch {
        /* closing a broken socket is allowed to fail */
      }
    };
  }

  private scheduleRetry(): void {
    if (this.closed || this.retry !== null) return;
    // A torn connection is the normal case (sleep, network change, backend restart).
    this.retry = window.setTimeout(() => {
      this.retry = null;
      this.open();
    }, 5000);
  }

  private clearPing(): void {
    if (this.ping !== null) {
      window.clearInterval(this.ping);
      this.ping = null;
    }
  }

  close(): void {
    this.closed = true;
    if (this.retry !== null) {
      window.clearTimeout(this.retry);
      this.retry = null;
    }
    this.clearPing();
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
  }
}
