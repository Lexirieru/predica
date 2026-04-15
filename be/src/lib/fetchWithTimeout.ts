// Fetch wrapper that aborts the request after a timeout. Node's `fetch` has
// no built-in request timeout — a hung upstream (Pacifica, Elfa) would pin
// a connection indefinitely and stall the cron loop. AbortSignal.timeout is
// Node 17.3+ and universally available on our target runtime.
const DEFAULT_TIMEOUT_MS = 10_000;

export function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  // Respect a caller-supplied signal by combining with our timeout signal.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal as AbortSignal, timeoutSignal])
    : timeoutSignal;
  return fetch(url, { ...init, signal });
}
