import { PageHeader, Card, StatGrid, StatCard } from "../../../_components/ds";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { fetchJson } from "@/app/_data/apiClient";

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

async function getConfig(): Promise<PlatformConfig | null> {
  const res = await fetchJson<unknown, PlatformConfig>("/api/v1/admin/platform-config", null as unknown as PlatformConfig, {
    telemetryKey: "admin.platform_config",
    mapResponse: (p) => p as PlatformConfig,
  });
  return res.source === "error" ? null : res.data;
}

export default async function PlatformConfigPage() {
  requireAnyRole(["platform_admin", "super_admin"]);
  const config = await getConfig();

  if (!config) {
    return (
      <main className="page-main wrap">
        <PageHeader title="Platform Configuration" subtitle="Could not load configuration. Try refreshing." />
      </main>
    );
  }

  const { controllable: ctrl, infrastructure: infra } = config;
  const debugActive = ctrl.debugModeUntil && new Date(ctrl.debugModeUntil) > new Date();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Platform Configuration"
        subtitle="Tunable parameters and read-only infrastructure view for platform operators."
        back="/tenant-admin"
        backLabel="Office Admin"
      />

      {/* ─── CONTROLLABLE SETTINGS ─── */}
      <h2 style={{ fontSize: 16, margin: "8px 0 12px", color: "var(--ink)" }}>⚙️ Tunable Settings</h2>

      <div className="grid g-2">
        {/* Cache TTL */}
        <Card title="Cache TTL (seconds per module)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <thead><tr><th scope="col">Module</th><th scope="col" style={{ textAlign: "right" }}>TTL (s)</th></tr></thead>
            <tbody>
              {Object.entries(ctrl.cacheTtl).map(([mod, ttl]) => (
                <tr key={mod}><td style={{ textTransform: "capitalize" }}>{mod}</td><td className="num">{ttl}</td></tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--mut)" }}>
            Edit via PATCH /v1/admin/platform-config. Lower = fresher data, higher = faster reads.
          </p>
        </Card>

        {/* Rate Limits */}
        <Card title="Rate Limits" padding>
          <div className="grid g-2" style={{ gap: 10 }}>
            <div><div style={{ fontSize: 12, color: "var(--mut)" }}>Per minute</div><div style={{ fontSize: 22, fontWeight: 700 }}>{ctrl.rateLimits.perMinute}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--mut)" }}>Burst max</div><div style={{ fontSize: 22, fontWeight: 700 }}>{ctrl.rateLimits.burstMax}</div></div>
          </div>
        </Card>

        {/* Log Level / Debug Mode */}
        <Card title="Log Level" padding>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 700, textTransform: "uppercase", color: ctrl.logLevel === "debug" ? "#7c2d12" : "var(--ink)" }}>
              {ctrl.logLevel}
            </span>
            {debugActive && (
              <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
                Debug until {new Date(ctrl.debugModeUntil!).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--mut)" }}>
            POST /v1/admin/platform-config/debug-mode to enable time-limited debug logging (auto-reverts).
          </p>
        </Card>

        {/* Notification Channels */}
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
      <h2 style={{ fontSize: 16, margin: "28px 0 12px", color: "var(--ink)" }}>🔒 Infrastructure (read-only)</h2>
      <p style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 12px" }}>
        These parameters are managed by the deployment pipeline. Shown here for visibility — not editable from the UI.
      </p>

      <div className="grid g-2">
        {/* Database */}
        <Card title="PostgreSQL" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Host</td><td>{infra.database.host}:{infra.database.port}</td></tr>
              <tr><td>Databases</td><td>{infra.database.databases}</td></tr>
              <tr><td>Pool mode</td><td>{infra.database.poolMode}</td></tr>
              <tr><td>Max connections (per svc)</td><td>{infra.database.maxConnections}</td></tr>
              <tr><td>RLS enabled</td><td>{infra.database.rlsEnabled ? "✅ Yes" : "❌ No"}</td></tr>
            </tbody>
          </table>
        </Card>

        {/* PgBouncer */}
        <Card title="PgBouncer" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Configured</td><td>{infra.pgbouncer.configured ? "✅ Yes" : "❌ No"}</td></tr>
              <tr><td>Port</td><td>{infra.pgbouncer.port}</td></tr>
              <tr><td>Pool mode</td><td>{infra.pgbouncer.poolMode}</td></tr>
              <tr><td>Max client connections</td><td>{infra.pgbouncer.maxClientConn}</td></tr>
              <tr><td>Default pool size</td><td>{infra.pgbouncer.defaultPoolSize}</td></tr>
            </tbody>
          </table>
        </Card>

        {/* Redis */}
        <Card title="Redis" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>URL</td><td>{infra.redis.url}</td></tr>
              <tr><td>Status</td><td>{infra.redis.status}</td></tr>
            </tbody>
          </table>
        </Card>

        {/* Queue (SQS) */}
        <Card title="Message Queue (SQS)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Driver</td><td>{infra.queue.driver}</td></tr>
              <tr><td>Endpoint</td><td>{infra.queue.endpoint}</td></tr>
              <tr><td>Region</td><td>{infra.queue.region}</td></tr>
            </tbody>
          </table>
        </Card>

        {/* Auth */}
        <Card title="Authentication (Keycloak)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Provider</td><td>{infra.auth.provider}</td></tr>
              <tr><td>Algorithm</td><td>{infra.auth.algorithm}</td></tr>
              <tr><td>Realm</td><td>{infra.auth.realm}</td></tr>
              <tr><td>Audience configured</td><td>{infra.auth.audienceConfigured ? "✅ Yes" : "⚠️ No"}</td></tr>
            </tbody>
          </table>
        </Card>

        {/* Encryption */}
        <Card title="Encryption at Rest" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Algorithm</td><td>{infra.encryption.algorithm}</td></tr>
              <tr><td>PII encrypted</td><td>{infra.encryption.piiAtRest ? "✅ Yes" : "❌ No"}</td></tr>
              <tr><td>MFA secrets encrypted</td><td>{infra.encryption.mfaAtRest ? "✅ Yes" : "❌ No"}</td></tr>
            </tbody>
          </table>
        </Card>

        {/* Object Storage */}
        <Card title="Object Storage (S3)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Driver</td><td>{infra.storage.driver}</td></tr>
              <tr><td>Bucket</td><td>{infra.storage.bucket}</td></tr>
              <tr><td>Endpoint</td><td>{infra.storage.endpoint}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>
    </main>
  );
}
