"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SSEConnectionState = "connected" | "disconnected" | "reconnecting";

export interface SSEConnectionOptions {
  /** SSE stream URL */
  url: string;
  /** Whether the connection is enabled (skip if using prop data / test mode) */
  enabled?: boolean;
  /** Callback when a named event is received */
  onEvent?: (eventType: string, data: unknown) => void;
  /** Callback when the connection state changes */
  onStateChange?: (state: SSEConnectionState) => void;
  /** Initial backoff delay in ms (default: 1000) */
  initialBackoff?: number;
  /** Maximum backoff delay in ms (default: 30000) */
  maxBackoff?: number;
}

/**
 * Computes the next exponential backoff delay, capped at maxBackoff.
 * Sequence: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
 */
export function computeBackoff(attempt: number, initialMs: number, maxMs: number): number {
  const delay = initialMs * Math.pow(2, attempt);
  return Math.min(delay, maxMs);
}

/**
 * Hook managing an SSE (EventSource) connection with:
 * - Automatic exponential backoff reconnection (1s, 2s, 4s, ..., max 30s)
 * - Connection state tracking (connected, disconnected, reconnecting)
 * - Backoff reset on successful reconnection
 */
export function useSSEConnection(options: SSEConnectionOptions) {
  const {
    url,
    enabled = true,
    onEvent,
    onStateChange,
    initialBackoff = 1000,
    maxBackoff = 30000,
  } = options;

  const [state, setState] = useState<SSEConnectionState>("disconnected");
  const sseRef = useRef<EventSource | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const onEventRef = useRef(onEvent);
  const onStateChangeRef = useRef(onStateChange);

  // Keep refs up to date without triggering reconnects
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const updateState = useCallback((newState: SSEConnectionState) => {
    if (!mountedRef.current) return;
    setState(newState);
    onStateChangeRef.current?.(newState);
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;

    disconnect();
    updateState("reconnecting");

    try {
      const sse = new EventSource(url, { withCredentials: true });
      sseRef.current = sse;

      sse.onopen = () => {
        if (!mountedRef.current) return;
        attemptRef.current = 0; // Reset backoff on successful connection
        updateState("connected");
      };

      sse.addEventListener("notification", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data);
          onEventRef.current?.("notification", data);
        } catch {
          // Ignore malformed SSE data
        }
      });

      sse.onerror = () => {
        if (!mountedRef.current) return;
        // Close the broken connection
        sse.close();
        sseRef.current = null;
        updateState("disconnected");

        // Schedule reconnection with exponential backoff
        const delay = computeBackoff(attemptRef.current, initialBackoff, maxBackoff);
        attemptRef.current += 1;

        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connect();
          }
        }, delay);
      };
    } catch {
      // EventSource not supported or failed — mark disconnected
      updateState("disconnected");
    }
  }, [url, enabled, initialBackoff, maxBackoff, disconnect, updateState]);

  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return { state, reconnect: connect };
}
