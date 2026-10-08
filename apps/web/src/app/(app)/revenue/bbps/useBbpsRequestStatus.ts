"use client";

import { useCallback, useRef, useState } from "react";
import { browserJson } from "@/lib/api/browserClient";
import { usePolling } from "@/lib/bulkScan/usePolling";

/**
 * GAP-REVENUE-BBPS-02: poll GET /v1/revenue/bbps/requests/:messageId after a
 * fetch/pay submit, with backoff, until the outcome is terminal (success |
 * failed). Reuses the shared usePolling backoff/visibility machinery.
 */
export type BbpsRequestStatus = {
  status: "pending" | "success" | "failed";
  receiptId?: string | null;
  failureReason?: string | null;
  requestType?: string | null;
  bbpsTxnId?: string | null;
};

type StatusResponse = { data?: BbpsRequestStatus };

export function useBbpsRequestStatus(messageId: string | null) {
  const [status, setStatus] = useState<BbpsRequestStatus | null>(null);
  const lastId = useRef<string | null>(null);

  // Reset when a new request is submitted.
  if (messageId !== lastId.current) {
    lastId.current = messageId;
    if (status !== null && messageId === null) setStatus(null);
  }

  const tick = useCallback(async () => {
    if (!messageId) return { keepGoing: false, changed: false, failed: false };
    try {
      const res = await browserJson<StatusResponse>(`v1/revenue/bbps/requests/${encodeURIComponent(messageId)}`, {
        method: "GET",
      });
      const next = res.data ?? null;
      const changed = next?.status !== status?.status;
      setStatus(next);
      const terminal = next?.status === "success" || next?.status === "failed";
      return { keepGoing: !terminal, changed, failed: false };
    } catch {
      // A failed poll backs off and keeps trying (the request may still settle).
      return { keepGoing: true, changed: false, failed: true };
    }
  }, [messageId, status?.status]);

  const { failedLast, refreshNow } = usePolling(tick, {
    enabled: !!messageId && status?.status !== "success" && status?.status !== "failed",
    baseMs: 2000,
    maxMs: 15000,
  });

  const reset = useCallback(() => {
    setStatus(null);
  }, []);

  return { status, pollFailed: failedLast, refreshNow, reset };
}
