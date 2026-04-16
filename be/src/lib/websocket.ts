import { Server } from "ws";
import { Server as HttpServer, IncomingMessage } from "http";

// Read allowlist lazily — websocket.ts is imported before env parsing in some
// test contexts, so we defer reading CORS_ORIGINS until the upgrade fires.
function getAllowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type WsMessageType =
  | "PRICE_UPDATE"
  | "CANDLE_UPDATE"
  | "NEW_MARKET"
  | "MARKET_RESOLVED"
  | "NEW_VOTE"
  | "BADGE_UNLOCKED";

export interface WsMessage {
  type: WsMessageType;
  data: any;
  timestamp: number;
}

let wss: Server | null = null;

/**
 * Initialize WebSocket Server
 */
export function initWebSocketServer(server: HttpServer) {
  // Reject WS upgrades whose Origin isn't in the CORS allowlist. Without this,
  // any page on the internet can open a socket to our broadcast stream —
  // harmless for read-only data today, but a blanket hygiene fix.
  wss = new Server({
    server,
    verifyClient: (info: { origin: string; req: IncomingMessage; secure: boolean }) => {
      const origin = info.origin;
      // Non-browser clients (curl, server-to-server) send no Origin — allowed.
      if (!origin) return true;
      const allowed = getAllowedOrigins();
      if (allowed.includes(origin)) return true;
      console.warn(`[WebSocket] Rejected upgrade from unauthorized origin: ${origin}`);
      return false;
    },
  });

  wss.on("connection", (ws) => {
    console.log("[WebSocket] New client connected");

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "PING") {
          ws.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
        }
      } catch (e) {
        const preview = message.toString().slice(0, 120);
        console.warn("[WebSocket] client message parse error:", (e as Error).message, "| frame:", preview);
      }
    });

    ws.on("close", () => {
      console.log("[WebSocket] Client disconnected");
    });

    // Send welcome message
    ws.send(JSON.stringify({ 
      type: "WELCOME", 
      data: { message: "Connected to Predica Real-time Engine" },
      timestamp: Date.now() 
    }));
  });

  console.log("[WebSocket] Server initialized");
  return wss;
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast(type: WsMessageType, data: any) {
  if (!wss) {
    console.warn("[WebSocket] Broadcast attempted before server initialization");
    return;
  }

  const message: WsMessage = {
    type,
    data,
    timestamp: Date.now()
  };

  const payload = JSON.stringify(message);
  
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(payload);
    }
  });
}

/** Number of currently connected WS clients — used by /api/admin/health. */
export function getConnectedClientCount(): number {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((c) => {
    if (c.readyState === 1) count++;
  });
  return count;
}
