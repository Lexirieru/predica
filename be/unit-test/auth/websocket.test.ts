import { initWebSocketServer, broadcast } from "../../src/lib/websocket";
import { Server as HttpServer } from "http";
import WebSocket, { Server } from "ws";
import { createServer } from "http";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";

describe("WebSocket System - Real-time Engine", () => {
  let httpServer: HttpServer;
  let wss: Server;
  const PORT = 3002; // Use a different port for testing

  beforeAll((done) => {
    httpServer = createServer();
    wss = initWebSocketServer(httpServer);
    httpServer.listen(PORT, () => {
      done();
    });
  });

  afterAll((done) => {
    wss.close();
    httpServer.close(() => {
      done();
    });
  });

  it("should allow a client to connect and receive a welcome message", (done) => {
    const client = new WebSocket(`ws://localhost:${PORT}`);

    client.on("message", (data) => {
      const message = JSON.parse(data.toString());
      expect(message.type).toBe("WELCOME");
      expect(message.data.message).toContain("Connected to Predica");
      client.close();
      done();
    });
  });

  it("should respond to PING with PONG", (done) => {
    const client = new WebSocket(`ws://localhost:${PORT}`);

    client.on("open", () => {
      client.send(JSON.stringify({ type: "PING" }));
    });

    client.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "WELCOME") return; // Skip welcome

      expect(message.type).toBe("PONG");
      expect(message.timestamp).toBeDefined();
      client.close();
      done();
    });
  });

  it("should broadcast PRICE_UPDATE to all connected clients", (done) => {
    const client1 = new WebSocket(`ws://localhost:${PORT}`);
    const client2 = new WebSocket(`ws://localhost:${PORT}`);
    
    let receivedCount = 0;
    const testData = { BTC: 70000, ETH: 3500 };

    const handleMessage = (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "WELCOME") return;

      expect(message.type).toBe("PRICE_UPDATE");
      expect(message.data).toEqual(testData);
      
      receivedCount++;
      if (receivedCount === 2) {
        client1.close();
        client2.close();
        done();
      }
    };

    client1.on("message", handleMessage);
    client2.on("message", handleMessage);

    // Give a small delay for connections to be fully established before broadcasting
    setTimeout(() => {
      broadcast("PRICE_UPDATE", testData);
    }, 500);
  });

  it("should broadcast NEW_VOTE to all connected clients", (done) => {
    const client = new WebSocket(`ws://localhost:${PORT}`);
    const voteData = { marketId: "123", side: "yes", amount: 100 };

    client.on("open", () => {
      // Delay broadcast to ensure client is in wss.clients
      setTimeout(() => {
        broadcast("NEW_VOTE", voteData);
      }, 500);
    });

    client.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "WELCOME") return;

      expect(message.type).toBe("NEW_VOTE");
      expect(message.data).toEqual(voteData);
      client.close();
      done();
    });
  });
});
