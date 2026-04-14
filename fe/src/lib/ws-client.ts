type MessageType = "PRICE_UPDATE" | "CANDLE_UPDATE" | "NEW_MARKET" | "MARKET_RESOLVED" | "NEW_VOTE" | "PONG" | "WELCOME";

interface WSMessage {
  type: MessageType;
  data: unknown;
  timestamp: number;
}

type Callback = (data: unknown) => void;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 15000;
const HEARTBEAT_INTERVAL = 30000;

class WSClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<Callback>> = new Map();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  connect() {
    if (this.destroyed || this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          this.emit(msg.type, msg.data);
        } catch {}
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    const delay = Math.min(RECONNECT_BASE * 2 ** this.reconnectAttempt, RECONNECT_MAX);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "PING" }));
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  subscribe(type: string, cb: Callback): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
    // Auto-connect on first subscribe
    this.connect();
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
