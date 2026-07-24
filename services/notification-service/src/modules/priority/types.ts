export type PriorityLevel = "critical" | "high" | "normal" | "low";
export type RetryPolicy = { maxAttempts: number; backoffMs: number[] };
