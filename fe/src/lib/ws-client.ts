// Extended WS client with:
//   - Exponential backoff reconnect (1s → 15s cap)
//   - Virtual "_STATUS" event exposing "connecting" | "open" | "closed"
//   - Virtual "_RECONNECTED" event fired only on a drop-open cycle (NOT the
//     first open), so components can refetch stale state without firing on
//     initial page load.
//   - PONG timeout detection: if no PONG within 10s of a PING, treat as
//     zombie socket and force-reconnect. Default onclose handler alone
//     misses "OPEN but network dead" cases where the TCP layer stays up.
//
// Virtual events use underscore prefix so they never collide with server
// message types.

type ServerMessageType =
  | "PRICE_UPDATE"
  | "CANDLE_UPDATE"
  | "NEW_MARKET"
  | "MARKET_RESOLVED"
  | "NEW_VOTE"
  | "BADGE_UNLOCKED"
  | "PONG"
  | "WELCOME";

export type ConnectionStatus = "connecting" | "open" | "closed";

interface WSMessage {
  type: string;
  data: unknown;
  timestamp: number;
}

type Callback = (data: unknown) => void;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 15000;
const HEARTBEAT_INTERVAL = 30000;
const PONG_TIMEOUT = 10000;

class WSClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<Callback>> = new Map();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  // True once we've observed at least one "open" event. Used so _RECONNECTED
  // fires only on the 2nd+ open (a drop-recover cycle), not on initial boot.
  private hasConnectedBefore = false;
  private status: ConnectionStatus = "closed";

  connect() {
    if (this.destroyed) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.setStatus("open");
        this.startHeartbeat();
        if (this.hasConnectedBefore) {
          // Drop-recover cycle: fire resync signal AFTER listeners see status=open
          // so hooks can safely refetch markets / votes / balance.
          this.emit("_RECONNECTED", null);
        } else {
          this.hasConnectedBefore = true;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          // Any message resets PONG window — not just PONG, because any traffic
          // proves the socket is alive. Simpler than strict PING/PONG tracking.
          this.clearPongTimeout();
          this.emit(msg.type, msg.data);
        } catch {
          // Malformed frame — ignore but don't tear down socket.
        }
      };

      this.ws.onclose = () => {
        this.teardownSocketTimers();
        this.setStatus("closed");
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // Let onclose drive reconnect — don't double-schedule.
        this.ws?.close();
      };
    } catch {
      this.setStatus("closed");
      this.scheduleReconnect();
    }
  }

  private setStatus(next: ConnectionStatus) {
    if (this.status === next) return;
    this.status = next;
    this.emit("_STATUS", next);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(RECONNECT_BASE * 2 ** this.reconnectAttempt, RECONNECT_MAX);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "PING" }));
        this.armPongTimeout();
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimeout();
  }

  private armPongTimeout() {
    this.clearPongTimeout();
    this.pongTimer = setTimeout(() => {
      // No response within PONG_TIMEOUT — assume zombie, force reconnect.
      console.warn("[WS] PONG timeout — forcing reconnect");
      this.ws?.close();
    }, PONG_TIMEOUT);
  }

  private clearPongTimeout() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private teardownSocketTimers() {
    this.stopHeartbeat();
  }

  subscribe(type: string, cb: Callback): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
    // Auto-connect on first subscribe
    this.connect();
    // Late subscribers to _STATUS get the current value immediately — without
    // this, a component mounting after connection opens would never learn the
    // status until the next transition.
    if (type === "_STATUS") {
      queueMicrotask(() => cb(this.status));
    }
    return () => {
      this.listeners.get(type)?.delete(cb);
    };
  }

  private emit(type: string, data: unknown) {
    this.listeners.get(type)?.forEach((cb) => {
      try { cb(data); } catch {}
    });
  }

  destroy() {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.listeners.clear();
  }
}

// Singleton
let instance: WSClient | null = null;

export function getWSClient(): WSClient {
  if (!instance) {
    instance = new WSClient();
  }
  return instance;
}

// Marker so existing ServerMessageType consumers (if any) still compile.
export type { ServerMessageType };
