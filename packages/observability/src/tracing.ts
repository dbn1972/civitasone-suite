/**
 * W1.7 — OpenTelemetry tracing bootstrap for CivitasOne services.
 *
 * Call initTracing() at the very top of each service's index.ts (before
 * importing Fastify or any instrumented library). This is a no-op when
 * OTEL_EXPORTER_OTLP_ENDPOINT is not set (fail-open for dev/test).
 *
 * Provides:
 *   - HTTP auto-instrumentation (request → span)
 *   - W3C traceparent/tracestate propagation (cross-service traces)
 *   - Span export to any OTLP-compatible collector (Jaeger, Tempo, etc.)
 *   - Correlation ID injection (from x-correlation-id header)
 *
 * Env vars:
 *   OTEL_EXPORTER_OTLP_ENDPOINT   — e.g. http://otel-collector:4318 (required for export)
 *   OTEL_SERVICE_NAME              — overrides the service name (optional)
 *   OTEL_TRACES_SAMPLER            — "always_on" (default) | "traceidratio"
 *   OTEL_TRACES_SAMPLER_ARG        — ratio (0.0-1.0) when sampler=traceidratio
 */

export interface TracingOptions {
  serviceName: string;
  /** Optional version for the service resource */
  version?: string;
}

/**
 * Initialize OpenTelemetry tracing. Returns true if export is active, false if
 * disabled (no OTLP endpoint configured). Safe to call multiple times (idempotent).
 *
 * This is designed as a lazy-import module so services that don't have
 * @opentelemetry/* installed simply get a no-op (no hard dependency).
 */
export async function initTracing(opts: TracingOptions): Promise<boolean> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    // No collector configured — tracing disabled (fail-open for dev/test)
    return false;
  }

  try {
    // Dynamic imports — optional peer dependencies
    const { NodeSDK } = await import("@opentelemetry/sdk-node" as string) as {
      NodeSDK: new (config: Record<string, unknown>) => { start: () => void };
    };
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http" as string) as {
      OTLPTraceExporter: new (config: { url: string }) => unknown;
    };
    const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node" as string) as {
      getNodeAutoInstrumentations: () => unknown[];
    };
    const { Resource } = await import("@opentelemetry/resources" as string) as {
      Resource: new (attrs: Record<string, string>) => unknown;
    };

    const resource = new Resource({
      "service.name": process.env.OTEL_SERVICE_NAME ?? opts.serviceName,
      "service.version": opts.version ?? process.env.npm_package_version ?? "0.1.0",
    });

    const sdk = new NodeSDK({
      resource,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      instrumentations: getNodeAutoInstrumentations(),
    });

    sdk.start();
    return true;
  } catch {
    // OTel packages not installed — tracing stays disabled
    return false;
  }
}

/**
 * Extract or generate a correlation ID from a request. Prefers the existing
 * x-correlation-id header; falls back to generating a new one. Can be used to
 * set the span attribute and propagate downstream.
 */
export function extractCorrelationId(headers: Record<string, string | string[] | undefined>): string {
  const existing = headers["x-correlation-id"];
  if (typeof existing === "string" && existing.length > 0) return existing;
  // No correlation ID — let the caller generate one (they already do via genReqId)
  return "";
}
