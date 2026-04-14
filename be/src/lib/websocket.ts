import { Server } from "ws";
import { Server as HttpServer } from "http";

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
  wss = new Server({ server });

  wss.on("connection", (ws) => {
    console.log("[WebSocket] New client connected");

    ws.on("message", (message) => {
      // Handle heartbeats or client messages if needed
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "PING") {
          ws.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
        }
      } catch (e) {
        // Silent
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
