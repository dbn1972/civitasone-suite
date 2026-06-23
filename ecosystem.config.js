const BASE = "/home/ec2-user/CivitasOne/civitasone-suite";
const REDIS = "redis://localhost:6381";
const DB_HOST = "localhost:5435";

// ── Secrets (SEC-1 / SEC-2) ─────────────────────────────────────────────────
// Secrets are NEVER hardcoded in source control. They are injected at deploy
// time from the host environment / secret manager. In production we fail closed:
// if a required secret is missing the process config refuses to build rather
// than silently falling back to a public dev value.
const IS_PROD = (process.env.NODE_ENV ?? "production") === "production";

function requireSecret(name) {
  const v = process.env[name];
  if (IS_PROD && (!v || v.length === 0)) {
    throw new Error(
      `[ecosystem] ${name} is required in production. ` +
        `Inject it from the secret manager (do not hardcode). Refusing to start.`,
    );
  }
  return v ?? "";
}

// RS256/Keycloak only in production. HS256 shared-secret auth is forbidden in
// prod by packages/auth (resolveAlgorithm throws); JWT_SECRET is intentionally
// NOT set on production processes so the HS256 fallback path is unreachable.
const JWT_ALGORITHM = process.env.JWT_ALGORITHM ?? "RS256";
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://civitasone-keycloak:8080";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "civitasone";
const INTERNAL_SERVICE_SECRET = requireSecret("INTERNAL_SERVICE_SECRET");
// Only honoured outside production (tests/dev). Empty in prod.
const JWT_SECRET = IS_PROD ? undefined : (process.env.JWT_SECRET ?? "civitasone-dev-secret");

const AUTH_ENV = {
  JWT_ALGORITHM,
  KEYCLOAK_URL,
  KEYCLOAK_REALM,
  ...(JWT_SECRET ? { JWT_SECRET } : {}),
};

const LOG_DIR = "/var/log/civitasone";
const AWS_ENV = {
  QUEUE_DRIVER: "sqs",
  AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
  AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? "ap-south-1",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test",
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
};

function svc(name, port, dbUser, dbName, extra = {}) {
  return {
    name,
    script: "dist/index.js",
    cwd: `${BASE}/services/${name}-service`,
    log_file: `${LOG_DIR}/${name}.log`,
    error_file: `${LOG_DIR}/${name}-error.log`,
    merge_logs: true,
    restart_delay: 3000,
    max_restarts: 10,
    env: {
      NODE_ENV: "production",
      PORT: port,
      ...AUTH_ENV,
      INTERNAL_SERVICE_SECRET,
      REDIS_URL: REDIS,
      BIND_HOST: "127.0.0.1",
      ...AWS_ENV,
      ...(dbUser
        ? { DATABASE_URL: `postgres://${dbUser}:${dbUser.replace("_svc", "_dev_pw")}@${DB_HOST}/${dbName}` }
        : {}),
      ...extra,
    },
  };
}

function worker(name, dbUser, dbName, extra = {}) {
  return {
    name: `${name}-worker`,
    script: "dist/worker.js",
    cwd: `${BASE}/services/${name}-service`,
    log_file: `${LOG_DIR}/${name}-worker.log`,
    error_file: `${LOG_DIR}/${name}-worker-error.log`,
    merge_logs: true,
    restart_delay: 3000,
    max_restarts: 10,
    env: {
      NODE_ENV: "production",
      ...AUTH_ENV,
      INTERNAL_SERVICE_SECRET,
      REDIS_URL: REDIS,
      BIND_HOST: "127.0.0.1",
      ...AWS_ENV,
      DATABASE_URL: `postgres://${dbUser}:${dbUser.replace("_svc", "_dev_pw")}@${DB_HOST}/${dbName}`,
      ...extra,
    },
  };
}

module.exports = {
  apps: [
    // ── Core platform ──────────────────────────────────────────────────────────
    svc("identity",     3001, "identity_svc",     "civitas_identity"),
    svc("tenant",       3002, "tenant_svc",        "civitas_tenant"),
    svc("policy",       3003, "policy_svc",        "civitas_policy"),
    svc("audit",        3004, "audit_svc",         "civitas_audit"),
    svc("install",      3005, "install_svc",       "civitas_install"),
    svc("notification", 3006, "notification_svc",  "civitas_notification"),

    // ── Finance & procurement ──────────────────────────────────────────────────
    svc("finance",      3007, "finance_svc",       "civitas_finance"),
    svc("procurement",  3008, "procurement_svc",   "civitas_procurement"),
    svc("contract",     3009, "contract_svc",      "civitas_contract"),

    // ── Establishment & physical assets ───────────────────────────────────────
    svc("estab",        3010, "estab_svc",         "civitas_estab"),
    svc("stock",        3011, "stock_svc",         "civitas_stock"),
    svc("hrms",         3012, "hrms_svc",          "civitas_hrms"),
    svc("payroll",      3013, "payroll_svc",       "civitas_payroll"),
    svc("project",      3014, "project_svc",       "civitas_project"),
    svc("asset",        3015, "asset_svc",         "civitas_asset"),

    // ── Reporting & plugins ────────────────────────────────────────────────────
    svc("report",       3016, "report_svc",        "civitas_report"),
    svc("plugin",       3017, "plugin_svc",        "civitas_plugin"),
    svc("theme",        3018, "theme_svc",         "civitas_theme"),

    // ── Government-specific ────────────────────────────────────────────────────
    svc("grant",        3019, "grant_svc",         "civitas_grant"),
    svc("citizen",      3020, "citizen_svc",       "civitas_citizen"),
    svc("legal",        3021, "legal_svc",         "civitas_legal"),

    // ── Admin & billing ────────────────────────────────────────────────────────
    svc("admin",        3022, "admin_svc",         "civitas_admin"),
    svc("billing",      3023, "billing_svc",       "civitas_billing"),

    // ── CRM & operations ───────────────────────────────────────────────────────
    svc("crm",          3024, "crm_svc",           "civitas_crm"),
    svc("inventory",    3025, "inventory_svc",     "civitas_inventory"),
    svc("telephony",    3026, "telephony_svc",     "civitas_telephony"),
    svc("helpdesk",     3027, "helpdesk_svc",      "civitas_helpdesk"),

    // ── Intelligence & automation ──────────────────────────────────────────────
    svc("knowledge",    3028, "knowledge_svc",     "civitas_knowledge"),
    svc("workflow",     3029, "workflow_svc",      "civitas_workflow"),

    // ── CQRS workers (async writes + outbox relay) ─────────────────────────────
    worker("finance",      "finance_svc",      "civitas_finance"),
    worker("procurement",  "procurement_svc",  "civitas_procurement"),
    worker("workflow",     "workflow_svc",     "civitas_workflow"),
    worker("payroll",      "payroll_svc",      "civitas_payroll"),
    worker("hrms",         "hrms_svc",         "civitas_hrms"),
    worker("grant",        "grant_svc",        "civitas_grant"),
    worker("project",      "project_svc",      "civitas_project"),
    worker("estab",        "estab_svc",        "civitas_estab"),
    worker("asset",        "asset_svc",        "civitas_asset"),
    worker("stock",        "stock_svc",        "civitas_stock"),
    worker("citizen",      "citizen_svc",      "civitas_citizen"),
    worker("helpdesk",     "helpdesk_svc",     "civitas_helpdesk"),
    worker("audit",        "audit_svc",        "civitas_audit"),
    worker("legal",        "legal_svc",        "civitas_legal"),
    worker("crm",          "crm_svc",          "civitas_crm"),
    worker("admin",        "admin_svc",        "civitas_admin"),
    worker("billing",      "billing_svc",      "civitas_billing"),
    worker("contract",     "contract_svc",     "civitas_contract"),

    // ── EVT-1 (04-T1): previously-missing workers now wired. Each ships a real
    //    src/worker.ts (consumers + outbox relay); without these entries their
    //    HTTP commands returned 202 but the async write never applied. ──────────
    worker("identity",     "identity_svc",     "civitas_identity"),
    worker("tenant",       "tenant_svc",       "civitas_tenant"),
    worker("policy",       "policy_svc",       "civitas_policy"),
    worker("install",      "install_svc",      "civitas_install"),
    worker("notification", "notification_svc", "civitas_notification"),
    worker("report",       "report_svc",       "civitas_report"),
    worker("plugin",       "plugin_svc",       "civitas_plugin"),
    worker("theme",        "theme_svc",        "civitas_theme"),
    worker("knowledge",    "knowledge_svc",    "civitas_knowledge"),
    worker("analytics",    "analytics_svc",    "civitas_analytics"),
    worker("location",     "location_svc",     "civitas_location"),
    worker("inventory",    "inventory_svc",    "civitas_inventory"),
    worker("telephony",    "telephony_svc",    "civitas_telephony"),

    // ── Infrastructure services ────────────────────────────────────────────────
    {
      name: "queue",
      script: "dist/server.js",
      cwd: `${BASE}/services/queue-service`,
      log_file: `${LOG_DIR}/queue.log`,
      error_file: `${LOG_DIR}/queue-error.log`,
      merge_logs: true,
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: 3030,
        ...AUTH_ENV,
        REDIS_URL: REDIS,
        ...AWS_ENV,
      },
    },

    svc("analytics",    3031, "analytics_svc",    "civitas_analytics"),
    svc("location",     4012, "location_svc",     "civitas_location"),

    // ── Gateway ────────────────────────────────────────────────────────────────
    {
      name: "gateway",
      script: "dist/index.js",
      cwd: `${BASE}/services/gateway-service`,
      log_file: `${LOG_DIR}/gateway.log`,
      error_file: `${LOG_DIR}/gateway-error.log`,
      merge_logs: true,
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: 8080,
        ...AUTH_ENV,
        INTERNAL_SERVICE_SECRET,
        CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:3000",
      },
    },

    // ── Web (Next.js) ──────────────────────────────────────────────────────────
    {
      name: "web",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: `${BASE}/apps/web`,
      log_file: `${LOG_DIR}/web.log`,
      error_file: `${LOG_DIR}/web-error.log`,
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        ...(JWT_SECRET ? { JWT_SECRET } : {}),
        CIVITASONE_API_BASE_URL: "http://127.0.0.1:8080",
        NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8080",
      },
    },
  ],
};
