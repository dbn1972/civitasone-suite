"use client";

import { useEffect, useState } from "react";
import { ConfidenceBar } from "./ConfidenceBar";

export interface PredictionHistoryEntry {
  /** Unique prediction ID */
  id: string;
  /** Prediction value (0.0–1.0 for classification) */
  prediction: number | null;
  /** Confidence value (0.0–1.0) */
  confidence: number;
  /** Model version that produced this prediction */
  modelVersion?: number;
  /** ISO timestamp of when the prediction was created */
  createdAt: string;
}

export interface PredictionHistoryProps {
  /** The entity ID to fetch predictions for */
  entityId: string;
  /** The domain (leads, tickets, inventory, subscriptions, tasks, transactions) */
  domain: string;
  /** Optional max entries to display (default 10) */
  limit?: number;
  /** Optional custom fetch function (for testing/SSR injection) */
  fetchFn?: (url: string) => Promise<Response>;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatPrediction(value: number | null): string {
  if (value === null) return "N/A";
  return `${Math.round(value * 100)}%`;
}

/**
 * PredictionHistory — timeline component showing prediction value changes over time.
 * Fetches data from GET /v1/ml/predictions?entityId=&domain=.
 * Shows date, prediction value, confidence, model version per entry.
 * Supports dark/light mode and responsive layout.
 */
export function PredictionHistory({
  entityId,
  domain,
  limit = 10,
  fetchFn,
}: PredictionHistoryProps) {
  const [entries, setEntries] = useState<PredictionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const fetcher = fetchFn ?? fetch;
        const url = `/api/v1/ml/predictions?entityId=${encodeURIComponent(entityId)}&domain=${encodeURIComponent(domain)}&limit=${limit}`;
        const res = await fetcher(url);
        if (!res.ok) {
          setError(`Failed to load predictions (${res.status})`);
          setEntries([]);
          return;
        }
        const body = await res.json();
        const data: unknown[] = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
        const mapped: PredictionHistoryEntry[] = data
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map((item) => ({
            id: String(item.id ?? ""),
            prediction: typeof item.prediction === "number" ? item.prediction : null,
            confidence: typeof item.confidence === "number" ? item.confidence : 0,
            modelVersion: typeof item.modelVersion === "number" ? item.modelVersion : undefined,
            createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
          }));
        if (!cancelled) {
          setEntries(mapped);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Network error loading predictions");
          setEntries([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [entityId, domain, limit, fetchFn]);

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading prediction history"
        className="space-y-3 animate-pulse"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-lg bg-gray-200 dark:bg-gray-700"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        role="status"
        aria-label="No prediction history"
        className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
      >
        No prediction history available
      </div>
    );
  }

  return (
    <div className="space-y-0" aria-label="Prediction history timeline" role="list">
      {entries.map((entry, idx) => (
        <div
          key={entry.id || idx}
          role="listitem"
          className="relative flex gap-4 pb-6 last:pb-0"
        >
          {/* Timeline connector */}
          <div className="flex flex-col items-center">
            <div className="h-3 w-3 rounded-full border-2 border-blue-500 bg-white dark:bg-gray-900" aria-hidden="true" />
            {idx < entries.length - 1 && (
              <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
            )}
          </div>

          {/* Entry content */}
          <div className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <time
                dateTime={entry.createdAt}
                className="text-xs text-gray-500 dark:text-gray-400"
              >
                {formatDate(entry.createdAt)}
              </time>
              {entry.modelVersion != null && (
                <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  v{entry.modelVersion}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {formatPrediction(entry.prediction)}
              </span>
              <div className="flex-1 min-w-0">
                <ConfidenceBar
                  value={entry.confidence}
                  height={6}
                  ariaLabel={`Confidence: ${Math.round(entry.confidence * 100)}%`}
                />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {Math.round(entry.confidence * 100)}% conf.
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
