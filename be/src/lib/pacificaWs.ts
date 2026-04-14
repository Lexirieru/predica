import WebSocket from "ws";

const WS_URL = process.env.PACIFICA_WS_URL || "wss://test-ws.pacifica.fi/ws";
const HEARTBEAT_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;
const CANDLE_INTERVAL = "1m";

export interface PriceTick {
  symbol: string;
  mark: string;
  mid: string;
  oracle: string;
  funding: string;
  timestamp: number;
}

export interface CandleTick {
  symbol: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: string;
  close: string;
  high: string;
  low: string;
  volume: string;
  trades: number;
}

type PriceHandler = (ticks: PriceTick[]) => void;
type CandleHandler = (tick: CandleTick) => void;

let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let stopped = false;
const priceHandlers: PriceHandler[] = [];
const candleHandlers: CandleHandler[] = [];

// Symbols we want candle streams for. Rehydrated on reconnect.
const candleSubs = new Set<string>();

export function onPrices(handler: PriceHandler) {
  priceHandlers.push(handler);
}

export function onCandle(handler: CandleHandler) {
  candleHandlers.push(handler);
}

function send(obj: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// We use mark_price_candle (not the trade-based candle) so the chart matches
// the exact value used at settlement time (crons.ts settlement reads `mark`).
const CANDLE_SOURCE = "mark_price_candle";

function subCandle(symbol: string) {
  send({
    method: "subscribe",
    params: { source: CANDLE_SOURCE, symbol, interval: CANDLE_INTERVAL },
  });
}

function unsubCandle(symbol: string) {
  send({
    method: "unsubscribe",
    params: { source: CANDLE_SOURCE, symbol, interval: CANDLE_INTERVAL },
  });
}

/**
 * Reconcile candle subscriptions against the desired active set.
 * Called whenever active markets change (generation/settlement).
 */
export function syncCandleSubscriptions(desired: string[]) {
  const want = new Set(desired.map((s) => s.toUpperCase()));

  for (const s of candleSubs) {
    if (!want.has(s)) {
      unsubCandle(s);
      candleSubs.delete(s);
    }
  }
  for (const s of want) {
    if (!candleSubs.has(s)) {
      subCandle(s);
      candleSubs.add(s);
    }
  }
}

function clearTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  heartbeatTimer = null;
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function connect() {
  clearTimers();
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("[PacificaWS] Connected");
    send({ method: "subscribe", params: { source: "prices" } });
    // Rehydrate candle subscriptions after reconnect
    for (const s of candleSubs) subCandle(s);

    heartbeatTimer = setInterval(() => {
      send({ method: "ping" });
    }, HEARTBEAT_MS);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.channel === "prices" && Array.isArray(msg.data)) {
        for (const h of priceHandlers) h(msg.data as PriceTick[]);
      } else if (msg.channel === CANDLE_SOURCE && msg.data) {
        const d = msg.data;
        const tick: CandleTick = {
          symbol: d.s,
          interval: d.i,
          openTime: d.t,
          closeTime: d.T,
          open: d.o,
          close: d.c,
          high: d.h,
          low: d.l,
          volume: d.v,
          trades: d.n,
        };
        for (const h of candleHandlers) h(tick);
      }
    } catch (e) {
      // Don't let a malformed frame kill the handler — but surface it so
      // Pacifica schema changes don't pass silently.
      const preview = raw.toString().slice(0, 200);
      console.warn("[PacificaWS] parse error:", (e as Error).message, "| frame:", preview);
    }
  });

  ws.on("close", () => {
    console.warn("[PacificaWS] Disconnected, reconnecting...");
    clearTimers();
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[PacificaWS] Error:", (err as Error).message);
    ws?.close();
  });
}

export function startPacificaWs() {
  stopped = false;
  connect();
}

export function stopPacificaWs() {
  stopped = true;
  clearTimers();
  ws?.close();
  ws = null;
}
