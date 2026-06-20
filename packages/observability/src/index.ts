type AppLike = {
  get: (path: string, handler: (...args: unknown[]) => unknown) => void;
  addHook: (name: string, handler: () => Promise<void>) => void;
  routes?: Array<{ method: string | string[]; url: string }>;
};

type CacheLike = {
  put: (key: string, value: unknown, ttl?: number) => Promise<void>;
};

type QueueLike = {
  healthCheck: () => Promise<{ healthy: boolean }>;
};

export type ReadinessChecks = {
  db?: { ping: () => Promise<boolean> };
  cache?: CacheLike;
  queue?: QueueLike;
};

export type OpsOptions = {
  service: string;
  version?: string;
  checks?: ReadinessChecks;
};

const startedAt = Date.now();
let requestCount = 0;

const notificationDeliveryTotal = new Map<string, number>();

/** Increment notification_delivery_total{channel,status}. */
export function incrementNotificationDelivery(channel: string, status: "success" | "failed"): void {
  const key = `${channel}:${status}`;
  notificationDeliveryTotal.set(key, (notificationDeliveryTotal.get(key) ?? 0) + 1);
}

/** Reset delivery counters — test helper. */
export function resetNotificationDeliveryMetrics(): void {
  notificationDeliveryTotal.clear();
}

function formatNotificationDeliveryMetrics(): string[] {
  const lines = [
    "# HELP notification_delivery_total Notifications delivered by channel and status",
    "# TYPE notification_delivery_total counter",
  ];
  for (const [key, count] of notificationDeliveryTotal) {
    const sep = key.lastIndexOf(":");
    const channel = key.slice(0, sep);
    const status = key.slice(sep + 1);
    lines.push(`notification_delivery_total{channel="${channel}",status="${status}"} ${count}`);
  }
  return lines;
}

/** Standard /health /ready /metrics /openapi.json for every service. */
export function registerOpsRoutes(app: AppLike, opts: OpsOptions): void {
  const version = opts.version ?? process.env.npm_package_version ?? "0.1.0";

  app.get("/health", async () => ({
    service: opts.service,
    status: "ok",
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  }));

  app.get("/ready", async (...args: unknown[]) => {
    const reply = args[1] as { code: (n: number) => { send: (b: unknown) => void } };
    const results: Record<string, boolean> = {};
    if (opts.checks?.db) {
      try { results.db = await opts.checks.db.ping(); } catch { results.db = false; }
    }
    if (opts.checks?.cache) {
      try {
        await opts.checks.cache.put(`ready:${opts.service}`, "1", 5);
        results.redis = true;
      } catch { results.redis = false; }
    }
    if (opts.checks?.queue) {
      try {
        const h = await opts.checks.queue.healthCheck();
        results.queue = h.healthy;
      } catch { results.queue = false; }
    }
    const required = Object.values(results);
    const ready = required.length === 0 || required.every(Boolean);
    if (!ready) {
      return reply.code(503).send({ status: "not_ready", checks: results });
    }
    return { status: "ready", checks: results };
  });

  app.get("/metrics", async (...args: unknown[]) => {
    const reply = args[1] as { type: (t: string) => { send: (b: string) => void } };
    const lines = [
      "# HELP service_up Service process is running",
      "# TYPE service_up gauge",
      `service_up{service="${opts.service}"} 1`,
      "# HELP http_requests_total Total HTTP requests since start",
      "# TYPE http_requests_total counter",
      `http_requests_total{service="${opts.service}"} ${requestCount}`,
      "# HELP process_uptime_seconds Process uptime",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds{service="${opts.service}"} ${Math.floor((Date.now() - startedAt) / 1000)}`,
      ...formatNotificationDeliveryMetrics(),
    ];
    return reply.type("text/plain; version=0.0.4").send(lines.join("\n") + "\n");
  });

  app.addHook("onReady", async () => {
    const routes = (app as { routes?: Array<{ method: string | string[]; url: string }> }).routes ?? [];
    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of routes) {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      const path = r.url.replace(/:(\w+)/g, "{$1}");
      paths[path] ??= {};
      for (const m of methods) {
        const ml = m.toLowerCase();
        paths[path][ml] = {
          summary: `${m} ${path}`,
          responses: ml === "get"
            ? { "200": { description: "OK" } }
            : { "202": { description: "Accepted" }, "200": { description: "OK" } },
        };
      }
    }
    (app as AppLike & { _openApi?: unknown })._openApi = {
      openapi: "3.0.3",
      info: { title: opts.service, version },
      paths,
    };
  });

  app.get("/openapi.json", async () => {
    return (app as AppLike & { _openApi?: unknown })._openApi ?? {
      openapi: "3.0.3",
      info: { title: opts.service, version },
      paths: {},
    };
  });
}

/** SQL ping for postgres.js clients. */
export async function dbPing(sql: unknown): Promise<boolean> {
  const client = sql as { (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> };
  await client`SELECT 1`;
  return true;
}
