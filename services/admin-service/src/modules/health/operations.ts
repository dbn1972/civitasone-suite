import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { isNull, sql } from "drizzle-orm";
import { queue } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { outboxMessages } from "../../shared/outbox.js";
import { DEFAULT_SERVICES } from "./domain.js";

const execFileAsync = promisify(execFile);
const LOG_DIR = process.env.CIVITASONE_LOG_DIR ?? "/var/log/civitasone";
const LOG_TAIL_BYTES = Math.max(4096, Number(process.env.OPERATIONS_LOG_TAIL_BYTES ?? 65536));
const SNAPSHOT_TTL_MS = Math.max(1000, Number(process.env.OPERATIONS_SNAPSHOT_TTL_MS ?? 10000));

let cachedSnapshot: { expiresAt: number; value: OperationsSnapshot } | null = null;

type Pm2Process = {
  name: string;
  pm_id?: number;
  monit?: { memory?: number; cpu?: number };
  pm2_env?: {
    status?: string;
    restart_time?: number;
    unstable_restarts?: number;
    pm_uptime?: number;
  };
};

export type OperationProcess = {
  name: string;
  kind: "service" | "worker" | "infrastructure";
  status: string;
  restarts: number;
  cpuPct: number;
  memoryMb: number;
  uptimeSeconds: number | null;
};

export type SchedulerStatus = {
  name: string;
  ownerProcess: string;
  schedule: string;
  intervalMs?: number;
  status: "online" | "owner_down" | "unknown";
  lastObservedAt?: string;
};

export type OperationsSnapshot = {
  checkedAt: string;
  pm2Available: boolean;
  summary: {
    totalProcesses: number;
    onlineProcesses: number;
    workersOnline: number;
    workersTotal: number;
    failedJobs: number;
    outboxPending: number;
    queueHealthy: boolean;
  };
  processes: OperationProcess[];
  queue: { healthy: boolean; detail: string };
  schedulers: SchedulerStatus[];
  outbox: { pending: number };
  recentErrors: Array<{ source: string; line: string }>;
  externalMonitorRecommendation: Array<{ tool: string; purpose: string }>;
};

const SCHEDULERS: Array<Omit<SchedulerStatus, "status" | "lastObservedAt">> = [
  { name: "Citizen SLA sweep", ownerProcess: "citizen-worker", schedule: "Every 5 minutes", intervalMs: 300000 },
  { name: "Asset depreciation scheduler", ownerProcess: "asset-worker", schedule: "Every 6 hours", intervalMs: 21600000 },
  { name: "Notification retry sweeper", ownerProcess: "notification-worker", schedule: "Every 30 seconds", intervalMs: 30000 },
  { name: "Identity session reaper", ownerProcess: "identity-worker", schedule: "Every 60 seconds", intervalMs: 60000 },
  { name: "Identity break-glass grant sweep", ownerProcess: "identity-worker", schedule: "Every 60 seconds", intervalMs: 60000 },
  { name: "Identity Keycloak reconciler", ownerProcess: "identity-worker", schedule: "Every 60 seconds", intervalMs: 60000 },
  { name: "Admin break-glass auto-close", ownerProcess: "admin-worker", schedule: "Every 60 seconds", intervalMs: 60000 },
  { name: "Workflow SLA overdue sweeper", ownerProcess: "workflow-worker", schedule: "Every 30 seconds", intervalMs: 30000 },
  { name: "Workflow timer/deemed-approval sweeper", ownerProcess: "workflow-worker", schedule: "Every 15 seconds", intervalMs: 15000 },
  { name: "Workflow pre-breach reminders", ownerProcess: "workflow-worker", schedule: "Every 30 seconds", intervalMs: 30000 },
  { name: "HRMS due-list scheduler", ownerProcess: "hrms-worker", schedule: "Every 1 hour", intervalMs: 3600000 },
  { name: "Audit ageing sweep", ownerProcess: "audit-worker", schedule: "Every 1 hour", intervalMs: 3600000 },
  { name: "Project RAG/delayed tick", ownerProcess: "project-worker", schedule: "Every 60 seconds", intervalMs: 60000 },
  { name: "Legal hearing reminders", ownerProcess: "legal", schedule: "Startup, then daily at 08:00 UTC" },
];

function classifyProcess(name: string): OperationProcess["kind"] {
  if (name.endsWith("-worker")) return "worker";
  if (["gateway", "web", "queue"].includes(name)) return "infrastructure";
  return "service";
}

function toProcess(row: Pm2Process): OperationProcess {
  const uptime = row.pm2_env?.pm_uptime ? Math.max(0, Math.floor((Date.now() - row.pm2_env.pm_uptime) / 1000)) : null;
  return {
    name: row.name,
    kind: classifyProcess(row.name),
    status: row.pm2_env?.status ?? "unknown",
    restarts: Number(row.pm2_env?.restart_time ?? row.pm2_env?.unstable_restarts ?? 0),
    cpuPct: Number(row.monit?.cpu ?? 0),
    memoryMb: Math.round(Number(row.monit?.memory ?? 0) / 1024 / 1024),
    uptimeSeconds: uptime,
  };
}

export function redactLogLine(line: string): string {
  return line
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<email>")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+\b/gi, "$1<redacted>")
    .replace(/\b((?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*)[^\s,"'}]+/gi, "$1<redacted>")
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s]+/gi, "$1<redacted>");
}

export async function readPm2Processes(): Promise<{ available: boolean; processes: OperationProcess[] }> {
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], { timeout: 5000, maxBuffer: 1024 * 1024 * 4 });
    const rows = JSON.parse(stdout) as Pm2Process[];
    return { available: true, processes: rows.map(toProcess).sort((a, b) => a.name.localeCompare(b.name)) };
  } catch {
    return { available: false, processes: [] };
  }
}

async function countOutboxPending(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outboxMessages)
    .where(isNull(outboxMessages.publishedAt));
  return row?.count ?? 0;
}

async function getQueueHealth(): Promise<{ healthy: boolean; detail: string }> {
  try {
    const result = await queue.healthCheck();
    return { healthy: result.healthy, detail: result.healthy ? "queue health check passed" : "queue health check failed" };
  } catch {
    return { healthy: false, detail: "queue health check failed" };
  }
}

async function readTailLines(file: string): Promise<string[]> {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    return buffer.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-100);
  } finally {
    await handle.close();
  }
}

async function recentLogErrors(processes: OperationProcess[]): Promise<Array<{ source: string; line: string }>> {
  const sources = [...new Set(["gateway", "web", "queue", ...processes.filter((p) => p.kind === "worker").map((p) => p.name)])]
    .filter((source) => /^[a-z0-9-]+$/i.test(source))
    .slice(0, 40);
  const errors: Array<{ source: string; line: string }> = [];
  for (const source of sources) {
    const candidates = [join(LOG_DIR, `${source}-error.log`), join(LOG_DIR, `${source}.log`)];
    for (const file of candidates) {
      let lines: string[];
      try {
        lines = await readTailLines(file);
      } catch {
        continue;
      }
      for (const line of lines) {
        if (/error|failed|exception|fatal|down/i.test(line)) {
          errors.push({ source, line: redactLogLine(line).slice(0, 500) });
        }
      }
      break;
    }
  }
  return errors.slice(-50).reverse();
}

function schedulerStatus(processes: OperationProcess[]): SchedulerStatus[] {
  const byName = new Map(processes.map((p) => [p.name, p]));
  return SCHEDULERS.map((job) => {
    const owner = byName.get(job.ownerProcess);
    const online = owner?.status === "online";
    return {
      ...job,
      status: online ? "online" : owner ? "owner_down" : "unknown",
    };
  });
}

export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return cachedSnapshot.value;
  const [{ available, processes }, queueState, outboxPending] = await Promise.all([
    readPm2Processes(),
    getQueueHealth(),
    countOutboxPending(),
  ]);
  const workers = processes.filter((p) => p.kind === "worker");
  const failedJobs = processes.filter((p) => p.status !== "online").length;
  const schedulers = schedulerStatus(processes);
  const snapshot: OperationsSnapshot = {
    checkedAt: new Date().toISOString(),
    pm2Available: available,
    summary: {
      totalProcesses: processes.length || DEFAULT_SERVICES.length,
      onlineProcesses: processes.filter((p) => p.status === "online").length,
      workersOnline: workers.filter((p) => p.status === "online").length,
      workersTotal: workers.length,
      failedJobs,
      outboxPending,
      queueHealthy: queueState.healthy,
    },
    processes,
    queue: queueState,
    schedulers,
    outbox: { pending: outboxPending },
    recentErrors: await recentLogErrors(processes),
    externalMonitorRecommendation: [
      { tool: "Uptime Kuma", purpose: "External uptime checks for web, gateway, and /ready endpoints" },
      { tool: "Grafana + Prometheus", purpose: "Metrics dashboard and alerting for workers, queue, DB, and jobs" },
      { tool: "Loki or CloudWatch Logs", purpose: "Centralized logs and error alerts when the app itself is down" },
    ],
  };
  cachedSnapshot = { expiresAt: Date.now() + SNAPSHOT_TTL_MS, value: snapshot };
  return snapshot;
}
