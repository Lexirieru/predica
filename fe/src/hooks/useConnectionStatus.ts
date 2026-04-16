"use client";

import { useEffect, useState } from "react";
import { getWSClient, type ConnectionStatus } from "@/lib/ws-client";

/**
 * Subscribe to WS connection status. Primes with current status on mount so
 * the UI doesn't render "connecting" for one frame when the socket is
 * already open from a previous component.
 */
export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(() => getWSClient().getStatus());

  useEffect(() => {
    const client = getWSClient();
    const unsub = client.subscribe("_STATUS", (data) => setStatus(data as ConnectionStatus));
    return unsub;
  }, []);

  return status;
}
