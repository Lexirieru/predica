"use client";

import { useEffect, useRef } from "react";
import { getWSClient } from "@/lib/ws-client";

export function useWebSocket(type: string, callback: (data: unknown) => void) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const client = getWSClient();
    const unsub = client.subscribe(type, (data) => cbRef.current(data));
    return unsub;
  }, [type]);
}
