import type { PriorityLevel, RetryPolicy } from "./types.js";

export function classify(explicit?: PriorityLevel | string): PriorityLevel {
  if (explicit === "critical" || explicit === "high" || explicit === "normal" || explicit === "low") return explicit;
  return "normal";
}

export function getRetryPolicy(level: PriorityLevel): RetryPolicy {
  switch (level) {
    case "critical": return { maxAttempts: 5, backoffMs: [1000, 2000, 4000, 8000, 16000] };
    case "high":     return { maxAttempts: 5, backoffMs: [1000, 2000, 4000, 8000, 16000] };
    case "normal":   return { maxAttempts: 3, backoffMs: [1000, 2000, 4000] };
    case "low":      return { maxAttempts: 1, backoffMs: [] };
  }
}

export function shouldBypassDnd(level: PriorityLevel): boolean {
  return level === "critical";
}

export function shouldBypassDigest(level: PriorityLevel): boolean {
  return level === "critical";
}
