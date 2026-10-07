import { PageHeader, Card, StatusPill, RefreshErrorState } from "../../../_components/ds";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { fetchJson } from "@/app/_data/apiClient";
import { CacheTtlEditor } from "./CacheTtlEditor";
import { DebugModeButton } from "./DebugModeButton";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PlatformConfig = {
  controllable: {
    cacheTtl: Record<string, number>;
    rateLimits: { perMinute: number; burstMax: number };
    logLevel: string;
    debugModeUntil: string | null;
    notifications: { emailProvider: string; smsProvider: string; emailFrom: string; smsFrom: string };
  };
  infrastructure: {
    database: { host: string; port: number; databases: number; poolMode: string; maxConnections: number; rlsEnabled: boolean };
    redis: { url: string; status: string };
    queue: { driver: string; endpoint: string; region: string };
    auth: { provider: string; algorithm: string; realm: string; audienceConfigured: boolean };
    pgbouncer: { configured: boolean; port: number; poolMode: string; maxClientConn: number; defaultPoolSize: number };
    encryption: { piiAtRest: boolean; mfaAtRest: boolean; algorithm: string };
    storage: { driver: string; bucket: string; endpoint: string };
  };
};

// GAP-TENANT-ADMIN-PLATFORM-CONFIG-03: defence-in-depth — even though admin-service
// already strips credentials from redisUrl, a connection string shown to the
// browser is reduced to host:port here so userinfo/passwords/access keys can
// never leak client-side regardless of what the API sends.
function sanitizeEndpoint(value: string): string {
  if (!value) return value;
  try {
    const u = new URL(value.includes("://") ? value : `scheme://${value}`);
    const port = u.port ? `:${u.port}` : "";
    return `${u.hostname}${port}`;
  } catch {
    // Not a URL (e.g. a bare host:port or region) — strip any embedded userinfo defensively.
    return value.replace(/\/\/[^/@]*@/, "//").replace(/[^@]*@/, "");
  }
}

// GAP-TENANT-ADMIN-PLATFORM-CONFIG-02: validate the payload with isRecord guards
// so a malformed response (missing controllable/infrastructure) yields the
// friendly error state, never a throw into the parent error boundary.
function mapConfig(payload: unknown): PlatformConfig | null {
  if (!isRecord(payload)) return null;
  if (!isRecord(payload.controllable) || !isRecord(payload.infrastructure)) return null;
  const c = payload.controllable;
  if (!isRecord(c.cacheTtl) || !isRecord(c.rateLimits) || !isRecord(c.notifications)) return null;
  return payload as PlatformConfig;
}

async function getConfig(): Promise<PlatformConfig | null> {
  const res = await fetchJson<unknown, PlatformConfig>("/api/v1/admin/platform-config", null as unknown as PlatformConfig, {
    telemetryKey: "admin.platform_config",
    mapResponse: mapConfig,
  });
  return res.source === "error" ? null : res.data;
}

function YesNo({ value }: { value: boolean }) {
  return <StatusPill status={value ? "active" : "failed"} label={value ? "Yes" : "No"} />;
}

export default async function PlatformConfigPage() {
  requireAnyRole(["platform_admin", "super_admin"]);
  const config = await getConfig();

  if (!config) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Platform Configuration" subtitle="Tunable parameters and read-only infrastructure view for platform operators." back="/tenant-admin" backLabel="Tenant Admin" />
        <Card title="Platform Configuration" padding>
          <RefreshErrorState error={toHumanError("load", { area: "platform configuration" })} backHref="/tenant-admin" />
        </Card>
      </div>
    );
  }

  const { controllable: ctrl, infrastructure: infra } = config;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Platform Configuration"
        subtitle="Tunable parameters and read-only infrastructure view for platform operators."
        back="/tenant-admin"
        /* GAP-TENANT-ADMIN-PLATFORM-CONFIG-06: match the breadcrumb/nav term. */
        backLabel="Tenant Admin"
      />

      {/* ─── CONTROLLABLE SETTINGS (GAP-...-01: real editors, not raw-endpoint helper text) ─── */}
      <h2 style={{ fontSize: 16, margin: "8px 0 12px", color: "var(--ink)" }}>
        <span aria-hidden="true">⚙️ </span>Tunable Settings
      </h2>

      <div className="grid g-2">
        <Card title="Cache TTL (seconds per module)" padding>
          <CacheTtlEditor cacheTtl={ctrl.cacheTtl} />
        </Card>

        <Card title="Rate Limits" padding>
          <div className="grid g-2" style={{ gap: 10 }}>
            <div><div style={{ fontSize: 12, color: "var(--mut)" }}>Per minute</div><div style={{ fontSize: 22, fontWeight: 700 }}>{ctrl.rateLimits.perMinute}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--mut)" }}>Burst max</div><div style={{ fontSize: 22, fontWeight: 700 }}>{ctrl.rateLimits.burstMax}</div></div>
          </div>
        </Card>

        <Card title="Log Level" padding>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 700, textTransform: "uppercase", color: ctrl.logLevel === "debug" ? "#7c2d12" : "var(--ink)" }}>
              {ctrl.logLevel}
            </span>
          </div>
          <DebugModeButton debugModeUntil={ctrl.debugModeUntil} />
        </Card>

        <Card title="Notification Channels" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Email provider</td><td>{ctrl.notifications.emailProvider}</td></tr>
              <tr><td>Email from</td><td>{ctrl.notifications.emailFrom}</td></tr>
              <tr><td>SMS provider</td><td>{ctrl.notifications.smsProvider}</td></tr>
              <tr><td>SMS sender</td><td>{ctrl.notifications.smsFrom}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      {/* ─── READ-ONLY INFRASTRUCTURE ─── */}
      <h2 style={{ fontSize: 16, margin: "28px 0 12px", color: "var(--ink)" }}>
        <span aria-hidden="true">🔒 </span>Infrastructure (read-only)
      </h2>
      <p style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 12px" }}>
        These parameters are managed by the deployment pipeline. Shown here for visibility — not editable from the UI. Connection endpoints show host:port only (credentials are never displayed).
      </p>

      <div className="grid g-2">
        <Card title="PostgreSQL" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Host</td><td>{sanitizeEndpoint(`${infra.database.host}:${infra.database.port}`)}</td></tr>
              <tr><td>Databases</td><td>{infra.database.databases}</td></tr>
              <tr><td>Pool mode</td><td>{infra.database.poolMode}</td></tr>
              <tr><td>Max connections (per svc)</td><td>{infra.database.maxConnections}</td></tr>
              <tr><td>RLS enabled</td><td><YesNo value={infra.database.rlsEnabled} /></td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="PgBouncer" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Configured</td><td><YesNo value={infra.pgbouncer.configured} /></td></tr>
              <tr><td>Port</td><td>{infra.pgbouncer.port}</td></tr>
              <tr><td>Pool mode</td><td>{infra.pgbouncer.poolMode}</td></tr>
              <tr><td>Max client connections</td><td>{infra.pgbouncer.maxClientConn}</td></tr>
              <tr><td>Default pool size</td><td>{infra.pgbouncer.defaultPoolSize}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Redis" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Host</td><td>{sanitizeEndpoint(infra.redis.url)}</td></tr>
              <tr><td>Status</td><td>{infra.redis.status}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Message Queue (SQS)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Driver</td><td>{infra.queue.driver}</td></tr>
              <tr><td>Endpoint</td><td>{sanitizeEndpoint(infra.queue.endpoint)}</td></tr>
              <tr><td>Region</td><td>{infra.queue.region}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Authentication (Keycloak)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Provider</td><td>{infra.auth.provider}</td></tr>
              <tr><td>Algorithm</td><td>{infra.auth.algorithm}</td></tr>
              <tr><td>Realm</td><td>{infra.auth.realm}</td></tr>
              <tr><td>Audience configured</td><td><YesNo value={infra.auth.audienceConfigured} /></td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Encryption at Rest" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Algorithm</td><td>{infra.encryption.algorithm}</td></tr>
              <tr><td>PII encrypted</td><td><YesNo value={infra.encryption.piiAtRest} /></td></tr>
              <tr><td>MFA secrets encrypted</td><td><YesNo value={infra.encryption.mfaAtRest} /></td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Object Storage (S3)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Driver</td><td>{infra.storage.driver}</td></tr>
              <tr><td>Bucket</td><td>{infra.storage.bucket}</td></tr>
              <tr><td>Endpoint</td><td>{sanitizeEndpoint(infra.storage.endpoint)}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
