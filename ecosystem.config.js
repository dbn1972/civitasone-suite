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

// ── Database credentials (SEC-1 / SEC-2) ────────────────────────────────────
// In production the DB connection string is injected from the secret manager,
// NEVER derived from a dev password pattern. We accept either:
//   • DATABASE_URL_<SVC>   e.g. DATABASE_URL_HRMS  (per-service override), or
//   • a single injected DATABASE_URL on the process env.
// Outside production (dev/test/CI) we fall back to the historical derived
// `_dev_pw` connection string so local workflows are unchanged.
// In production, if neither injected secret is present we fail closed (throw),
// mirroring requireSecret() — we never emit a derived dev password in prod.
function dbUrl(dbUser, dbName) {
  if (!dbUser) return undefined;

  const svcKey = dbUser.replace(/_svc$/, "").toUpperCase(); // identity_svc → IDENTITY
  const perService = process.env[`DATABASE_URL_${svcKey}`];
  const injected = perService ?? process.env.DATABASE_URL;

  if (IS_PROD) {
    if (injected && injected.length > 0) return injected;
    throw new Error(
      `[ecosystem] DATABASE_URL_${svcKey} (or DATABASE_URL) is required in production. ` +
        `Inject the DB connection string from the secret manager (do not derive dev passwords). ` +
        `Refusing to start.`,
    );
  }

  // dev/test/CI: prefer an explicit injected URL if provided, else derive the
  // historical dev-password connection string.
  if (injected && injected.length > 0) return injected;
  return `postgres://${dbUser}:${dbUser.replace("_svc", "_dev_pw")}@${DB_HOST}/${dbName}`;
}

// RS256/Keycloak only in production. HS256 shared-secret auth is forbidden in
// prod by packages/auth (resolveAlgorithm throws); JWT_SECRET is intentionally
// NOT set on production processes so the HS256 fallback path is unreachable.
const JWT_ALGORITHM = process.env.JWT_ALGORITHM ?? "RS256";
// UAT/validation knob: runtime NODE_ENV the services see. Defaults to
// "production" so prod posture is unchanged unless RUNTIME_NODE_ENV is set.
// Setting it to a non-production value (with JWT_ALGORITHM=HS256) enables the
// dev-login HS256 path for end-to-end golden-path validation.
const RUNTIME_NODE_ENV = process.env.RUNTIME_NODE_ENV ?? "production";
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://civitasone-keycloak:8080";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "civitasone";
const INTERNAL_SERVICE_SECRET = requireSecret("INTERNAL_SERVICE_SECRET");
// SEC-3 device trust: identity mints/validates device trust tokens with this.
// Fail-closed in prod (no insecure default); dev/test gets a stable dev value.
const DEVICE_TRUST_SECRET = IS_PROD
  ? requireSecret("DEVICE_TRUST_SECRET")
  : (process.env.DEVICE_TRUST_SECRET ?? "civitasone-device-trust-dev-secret");
// Only honoured outside production (tests/dev). Empty in prod.
const JWT_SECRET = IS_PROD ? undefined : (process.env.JWT_SECRET ?? "civitasone-dev-secret");

const AUTH_ENV = {
  JWT_ALGORITHM,
  KEYCLOAK_URL,
  KEYCLOAK_REALM,
  DEVICE_TRUST_SECRET,
  ...(JWT_SECRET ? { JWT_SECRET } : {}),
};

const LOG_DIR = "/var/log/civitasone";
const AWS_ENV = {
  QUEUE_DRIVER: "sqs",
  AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
  AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? "ap-south-1",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test",
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
  // Shared LocalStack: shorter long-poll frees sockets for outbox SendMessage.
  // Production AWS can override / unset (code default remains 20).
  SQS_WAIT_TIME_SECONDS: process.env.SQS_WAIT_TIME_SECONDS ?? "5",
  SQS_MAX_SOCKETS: process.env.SQS_MAX_SOCKETS ?? "512",
};

// -- PII at-rest encryption key (DPDP) ---------------------------------------
// hrms-service encrypts sensitive PII (pan / aadhaar / bank) at the app layer
// with AES-256-GCM. The 32-byte key is derived from this secret. Read from the
// env if injected by the secret manager, else from a stable on-host key file so
// the key survives restarts and is identical for the hrms svc + worker.
const PII_ENC_KEY = (() => {
  if (process.env.PII_ENC_KEY && process.env.PII_ENC_KEY.length >= 16) return process.env.PII_ENC_KEY;
  try {
    const fs = require("fs");
    const p = require("path").join(process.env.HOME || "/home/ec2-user", ".civitasone-hrms-pii-key");
    const v = fs.readFileSync(p, "utf8").trim();
    if (v.length >= 16) return v;
  } catch (e) { /* fall through */ }
  if (IS_PROD) throw new Error("[ecosystem] PII_ENC_KEY required for hrms-service (inject from secret manager or provision the host key file). Refusing to start.");
  return "civitasone-hrms-pii-dev-key-not-for-prod";
})();

// -- MFA at-rest encryption key (P0-3) ----------------------------------------
// identity-service stores TOTP secrets AES-256-GCM-encrypted at rest. The
// 32-byte key is derived from this secret. Same injection contract as
// PII_ENC_KEY: env -> on-host key file -> dev fallback; fail closed in prod.
const MFA_ENC_KEY = (() => {
  if (process.env.MFA_ENC_KEY && process.env.MFA_ENC_KEY.length >= 16) return process.env.MFA_ENC_KEY;
  try {
    const fs = require("fs");
    const p = require("path").join(process.env.HOME || "/home/ec2-user", ".civitasone-identity-mfa-key");
    const v = fs.readFileSync(p, "utf8").trim();
    if (v.length >= 16) return v;
  } catch (e) { /* fall through */ }
  if (IS_PROD) throw new Error("[ecosystem] MFA_ENC_KEY required for identity-service (inject from secret manager or provision the host key file). Refusing to start.");
  return "civitasone-identity-mfa-dev-key-not-for-prod";
})();

// -- Citizen PII at-rest encryption key (P0-1, DPDP) --------------------------
// citizen-service encrypts portal.citizen_profiles PII (email / mobile /
// digilocker_token / address) AES-256-GCM at rest. The 32-byte key is derived
// from this secret. Same injection contract as PII_ENC_KEY / MFA_ENC_KEY:
// env -> on-host key file -> dev fallback; fail closed in prod. NO secret literal.
const CITIZEN_PII_KEY = (() => {
  if (process.env.CITIZEN_PII_KEY && process.env.CITIZEN_PII_KEY.length >= 16) return process.env.CITIZEN_PII_KEY;
  try {
    const fs = require("fs");
    const p = require("path").join(process.env.HOME || "/home/ec2-user", ".civitasone-citizen-pii-key");
    const v = fs.readFileSync(p, "utf8").trim();
    if (v.length >= 16) return v;
  } catch (e) { /* fall through */ }
  if (IS_PROD) throw new Error("[ecosystem] CITIZEN_PII_KEY required for citizen-service (inject from secret manager or provision the host key file). Refusing to start.");
  return "civitasone-citizen-pii-dev-key-not-for-prod";
})();

// -- CRM PII at-rest encryption key (P1-2 / DPDP) -----------------------------
// crm-service encrypts contact email/phone AES-256-GCM at rest. Same injection
// contract as PII_ENC_KEY: env -> on-host key file -> dev fallback; fail closed
// in prod. NO secret literal in the prod path.
const CRM_PII_KEY = (() => {
  if (process.env.CRM_PII_KEY && process.env.CRM_PII_KEY.length >= 16) return process.env.CRM_PII_KEY;
  try {
    const fs = require("fs");
    const p = require("path").join(process.env.HOME || "/home/ec2-user", ".civitasone-crm-pii-key");
    const v = fs.readFileSync(p, "utf8").trim();
    if (v.length >= 16) return v;
  } catch (e) { /* fall through */ }
  if (IS_PROD) throw new Error("[ecosystem] CRM_PII_KEY required for crm-service (inject from secret manager or provision the host key file). Refusing to start.");
  return "civitasone-crm-pii-dev-key-not-for-prod";
})();


// -- Per-service PII at-rest key resolver (DPDP) ------------------------------
// Factory for the same injection contract used by CITIZEN_PII_KEY / CRM_PII_KEY
// above: env -> on-host key file -> dev fallback, fail closed in production.
// NO secret literal on the prod path.
//
// Added for court / meeting / visitor, which each fail closed on startup without
// their key. Boot-probed 2026-07-27: all three refused to start with
// "<SVC>_PII_KEY is required (>=16 chars) for at-rest PII encryption" — correct
// behaviour, but it left them undeployable because the ecosystem never supplied
// the key.
function piiKey(envName, fileSlug, serviceName) {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  try {
    const fs = require("fs");
    const p = require("path").join(
      process.env.HOME || "/home/ec2-user",
      `.civitasone-${fileSlug}-pii-key`,
    );
    const v = fs.readFileSync(p, "utf8").trim();
    if (v.length >= 16) return v;
  } catch (e) { /* fall through */ }
  if (IS_PROD) {
    throw new Error(
      `[ecosystem] ${envName} required for ${serviceName} ` +
        `(inject from secret manager or provision the host key file). Refusing to start.`,
    );
  }
  return `civitasone-${fileSlug}-pii-dev-key-not-for-prod`;
}


// Scanner (BYPASSRLS) DSNs for court/visitor outbox relay + maintenance scans.
// Must be distinct from the service DATABASE_URL in production — FORCE RLS on
// _outbox.messages would otherwise starve startRelay/startOutboxPurge.
function scannerDbUrl(scannerUser, dbName, envName) {
  const injected = process.env[envName];
  if (IS_PROD) {
    if (injected && injected.length > 0) return injected;
    throw new Error(
      `[ecosystem] ${envName} is required in production for ${scannerUser}. ` +
        `Inject the BYPASSRLS scanner DSN from the secret manager. Refusing to start.`,
    );
  }
  if (injected && injected.length > 0) return injected;
  return `postgres://${scannerUser}:${scannerUser}_dev_pw@${DB_HOST}/${dbName}`;
}

const COURT_PII_KEY = piiKey("COURT_PII_KEY", "court", "court-service");
const MEETING_PII_KEY = piiKey("MEETING_PII_KEY", "meeting", "meeting-service");
const VISITOR_PII_KEY = piiKey("VISITOR_PII_KEY", "visitor", "visitor-service");
// procurement-service's app-layer PII crypto (src/shared/pii-crypto.ts) reads
// the generic `PII_ENC_KEY` env var name (same contract as hrms-service), NOT
// a `PROCUREMENT_PII_KEY`-named var — but it still needs its OWN distinct key
// material rather than reusing HRMS's. Generate a procurement-specific secret
// via the same piiKey() factory (own env-var name + host key-file slug for
// injection), then plumb its VALUE into the `PII_ENC_KEY` env key both
// svc("procurement") and worker("procurement") actually read.
//
// Boot-probed 2026-08-02: procurement-service and procurement-worker were
// missing PII_ENC_KEY entirely (unlike hrms, the only other service reading
// this exact var), so every boot threw "PII_ENC_KEY is required and must be
// at least 16 characters" (src/shared/validate-env.ts) and pm2 autorestart
// looped both processes (117 restarts observed). Wiring it below stops the loop.
const PROCUREMENT_PII_KEY = piiKey("PROCUREMENT_PII_KEY", "procurement", "procurement-service");

// NOTE on inspection-service: it validates a required-env allowlist at boot
// (DATABASE_URL, QUEUE_DRIVER, S3_BUCKET_NAME, HRMS_SERVICE_URL — see its
// app.ts). All four are ALREADY supplied by its svc()/worker() entries below.
// The 2026-07-27 boot probe that reported it failing was run with a hand-built
// env missing S3_BUCKET_NAME/HRMS_SERVICE_URL — a defect in the probe, not in
// this config. No change needed here.

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
      NODE_ENV: RUNTIME_NODE_ENV,
      PORT: port,
      ...AUTH_ENV,
      INTERNAL_SERVICE_SECRET,
      REDIS_URL: REDIS,
      BIND_HOST: "127.0.0.1",
      ...AWS_ENV,
      ...(dbUser ? { DATABASE_URL: dbUrl(dbUser, dbName) } : {}),
      ...extra,
    },
  };
}

function worker(name, dbUser, dbName, extra = {}, scriptFile = "dist/worker.js") {
  return {
    name: `${name}-worker`,
    // Court: dist/worker.js only exports startWorker(); dist/worker-main.js boots it.
    script: scriptFile,
    cwd: `${BASE}/services/${name}-service`,
    log_file: `${LOG_DIR}/${name}-worker.log`,
    error_file: `${LOG_DIR}/${name}-worker-error.log`,
    merge_logs: true,
    restart_delay: 3000,
    max_restarts: 10,
    env: {
      NODE_ENV: RUNTIME_NODE_ENV,
      ...AUTH_ENV,
      INTERNAL_SERVICE_SECRET,
      REDIS_URL: REDIS,
      BIND_HOST: "127.0.0.1",
      ...AWS_ENV,
      DATABASE_URL: dbUrl(dbUser, dbName),
      ...extra,
    },
  };
}

module.exports = {
  apps: [
    // ── Core platform ──────────────────────────────────────────────────────────
    svc("identity",     3001, "identity_svc",     "civitas_identity", { MFA_ENC_KEY }),
    svc("tenant",       3002, "tenant_svc",        "civitas_tenant"),
    svc("policy",       3003, "policy_svc",        "civitas_policy"),
    svc("audit",        3004, "audit_svc",         "civitas_audit"),
    svc("install",      3005, "install_svc",       "civitas_install"),
    svc("notification", 3006, "notification_svc",  "civitas_notification"),

    // ── Finance & procurement ──────────────────────────────────────────────────
    svc("finance",      3007, "finance_svc",       "civitas_finance"),
    svc("procurement",  3008, "procurement_svc",   "civitas_procurement", { PII_ENC_KEY: PROCUREMENT_PII_KEY }),
    svc("contract",     3009, "contract_svc",      "civitas_contract"),

    // ── Establishment & physical assets ───────────────────────────────────────
    svc("estab",        3010, "estab_svc",         "civitas_estab"),
    svc("stock",        3011, "stock_svc",         "civitas_stock"),
    svc("hrms",         3012, "hrms_svc",          "civitas_hrms", { PII_ENC_KEY }),
    svc("payroll",      3013, "payroll_svc",       "civitas_payroll"),
    svc("project",      3014, "project_svc",       "civitas_project"),
    svc("asset",        3015, "asset_svc",         "civitas_asset"),

    // ── Reporting & plugins ────────────────────────────────────────────────────
    svc("report",       3016, "report_svc",        "civitas_report"),
    svc("plugin",       3017, "plugin_svc",        "civitas_plugin"),
    svc("theme",        3018, "theme_svc",         "civitas_theme"),

    // ── Government-specific ────────────────────────────────────────────────────
    svc("grant",        3019, "grant_svc",         "civitas_grant"),
    svc("citizen",      3020, "citizen_svc",       "civitas_citizen", { CITIZEN_PII_KEY }),
    svc("legal",        3021, "legal_svc",         "civitas_legal"),

    // ── Admin & billing ────────────────────────────────────────────────────────
    svc("admin",        3022, "admin_svc",         "civitas_admin"),
    svc("billing",      3023, "billing_svc",       "civitas_billing"),

    // ── CRM & operations ───────────────────────────────────────────────────────
    svc("crm",          3024, "crm_svc",           "civitas_crm", { CRM_PII_KEY }),
    svc("inventory",    3025, "inventory_svc",     "civitas_inventory"),
    svc("telephony",    3026, "telephony_svc",     "civitas_telephony"),
    svc("helpdesk",     3027, "helpdesk_svc",      "civitas_helpdesk"),

    // ── Intelligence & automation ──────────────────────────────────────────────
    svc("knowledge",    3028, "knowledge_svc",     "civitas_knowledge"),
    svc("workflow",     3029, "workflow_svc",      "civitas_workflow"),

    // ── CQRS workers (async writes + outbox relay) ─────────────────────────────
    worker("finance",      "finance_svc",      "civitas_finance", {
      FINANCE_SCANNER_DATABASE_URL: scannerDbUrl("finance_scanner", "civitas_finance", "FINANCE_SCANNER_DATABASE_URL"),
    }),
    worker("procurement",  "procurement_svc",  "civitas_procurement", {
      PII_ENC_KEY: PROCUREMENT_PII_KEY,
      PROCUREMENT_SCANNER_DATABASE_URL: scannerDbUrl("procurement_scanner", "civitas_procurement", "PROCUREMENT_SCANNER_DATABASE_URL"),
    }),
    worker("workflow",     "workflow_svc",     "civitas_workflow", { WORKFLOW_SCANNER_DATABASE_URL: scannerDbUrl("workflow_scanner", "civitas_workflow", "WORKFLOW_SCANNER_DATABASE_URL") }),
    worker("payroll",      "payroll_svc",      "civitas_payroll", {
      PAYROLL_SCANNER_DATABASE_URL: scannerDbUrl("payroll_scanner", "civitas_payroll", "PAYROLL_SCANNER_DATABASE_URL"),
    }),
    worker("hrms",         "hrms_svc",         "civitas_hrms", { PII_ENC_KEY }),
    worker("grant",        "grant_svc",        "civitas_grant"),
    worker("project",      "project_svc",      "civitas_project"),
    worker("estab",        "estab_svc",        "civitas_estab"),
    worker("asset",        "asset_svc",        "civitas_asset"),
    worker("stock",        "stock_svc",        "civitas_stock"),
    worker("citizen",      "citizen_svc",      "civitas_citizen", { CITIZEN_PII_KEY }),
    worker("helpdesk",     "helpdesk_svc",     "civitas_helpdesk"),
    worker("audit",        "audit_svc",        "civitas_audit"),
    worker("legal",        "legal_svc",        "civitas_legal"),
    worker("crm",          "crm_svc",          "civitas_crm", { CRM_PII_KEY }),
    worker("admin",        "admin_svc",        "civitas_admin"),
    worker("billing",      "billing_svc",      "civitas_billing"),
    worker("contract",     "contract_svc",     "civitas_contract", {
      CONTRACT_SCANNER_DATABASE_URL: scannerDbUrl("contract_scanner", "civitas_contract", "CONTRACT_SCANNER_DATABASE_URL"),
    }),

    // ── EVT-1 (04-T1): previously-missing workers now wired. Each ships a real
    //    src/worker.ts (consumers + outbox relay); without these entries their
    //    HTTP commands returned 202 but the async write never applied. ──────────
    worker("identity",     "identity_svc",     "civitas_identity", { MFA_ENC_KEY }),
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
    worker("ml",           "ml_svc",           "civitas_ml"),
    worker("ai-agent",     "ai_agent_svc",     "civitas_ai_agent"),
    worker("field",        "field_svc",        "civitas_field"),
    worker("catalogue",    "catalogue_svc",    "civitas_catalogue"),
    worker("journey",      "journey_svc",      "civitas_journey", { JOURNEY_SCANNER_DATABASE_URL: scannerDbUrl("journey_scanner", "civitas_journey", "JOURNEY_SCANNER_DATABASE_URL") }),
    worker("loyalty",      "loyalty_svc",      "civitas_loyalty"),
    worker("recommendation", "recommendation_svc", "civitas_recommendation"),
    worker("cdp",          "cdp_svc",         "civitas_cdp"),
    worker("meeting",      "meeting_svc",      "civitas_meeting", { MEETING_PII_KEY }),
    // court-service is the only service in the fleet whose worker.ts is split
    // into a pure, side-effect-free module (src/worker.ts, exports
    // startWorker() for in-process test use) plus a thin process entrypoint
    // (src/worker-main.ts) that actually calls it — matching its own
    // package.json ("worker": "tsx src/worker-main.ts"). Every other service's
    // worker.ts IS the entrypoint (runs queue.start()/startRelay()/etc. at
    // module top level), so this generic worker() helper's default
    // "dist/worker.js" is correct for them but WRONG for court: pointed at
    // dist/worker.js, pm2 loaded a module that only DEFINES startWorker() and
    // never calls it, so nothing kept the event loop alive — Node exited(0)
    // as soon as the module finished evaluating, and pm2's autorestart looped
    // it forever (restarts climbing, status "waiting restart"). Point pm2 at
    // the same compiled entrypoint the "pnpm worker" script uses.
    worker("court",        "court_svc",        "civitas_court", { COURT_PII_KEY, COURT_SCANNER_DATABASE_URL: scannerDbUrl("court_scanner", "civitas_court", "COURT_SCANNER_DATABASE_URL") }, "dist/worker-main.js"),
    worker("visitor",      "visitor_svc",      "civitas_visitor", { VISITOR_PII_KEY, VISITOR_SCANNER_DATABASE_URL: scannerDbUrl("visitor_scanner", "civitas_visitor", "VISITOR_SCANNER_DATABASE_URL") }),
    worker("works",        "works_svc",        "civitas_works", { WORKS_SCANNER_DATABASE_URL: scannerDbUrl("works_scanner", "civitas_works", "WORKS_SCANNER_DATABASE_URL") }),
    worker("revenue",      "revenue_svc",      "civitas_revenue"),
    worker("inspection",   "inspection_svc",   "civitas_inspection", {
      S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ?? "civitas-inspection",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:4566",
      S3_REGION: process.env.S3_REGION ?? "ap-south-1",
      HRMS_SERVICE_URL: "http://127.0.0.1:3012",
      INSPECTION_SCANNER_DATABASE_URL: scannerDbUrl("inspection_scanner", "civitas_inspection", "INSPECTION_SCANNER_DATABASE_URL"),
    }),

    // T1-02: entities consumer + outbox relay were registered in worker.ts but
    // metadata-worker was never declared here, so CQRS writes black-holed.
    worker("metadata",     "metadata_svc",     "civitas_metadata"),

    // Gateway catalogue CQRS — mutations publish gateway.catalogue.*; worker applies.
    worker("gateway",      "gateway_svc",      "civitas_gateway"),

    // ── Infrastructure services ────────────────────────────────────────────────
    // Platform message-bus observability process (F9). Domain services embed the
    // bus via @civitasone/queue; this process exposes /health + /v1/queue/* ops.
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
        NODE_ENV: RUNTIME_NODE_ENV,
        PORT: 3030,
        BIND_HOST: "127.0.0.1",
        ...AUTH_ENV,
        INTERNAL_SERVICE_SECRET,
        REDIS_URL: REDIS,
        ...AWS_ENV,
      },
    },

    svc("analytics",    3031, "analytics_svc",    "civitas_analytics"),
    svc("ml",           3032, "ml_svc",           "civitas_ml"),
    svc("meeting",      3033, "meeting_svc",      "civitas_meeting", { MEETING_PII_KEY }),
    svc("court",        3034, "court_svc",        "civitas_court", { COURT_PII_KEY }),
    svc("visitor",      3035, "visitor_svc",      "civitas_visitor", { VISITOR_PII_KEY }),
    // Previously absent from this file entirely, so they could never be started.
    // Boot-probed 2026-07-27: works listens cleanly with no extra config.
    svc("works",        3036, "works_svc",        "civitas_works"),
    svc("metadata",     3039, "metadata_svc",     "civitas_metadata"),
    svc("ai-agent",     3041, "ai_agent_svc",     "civitas_ai_agent"),
    svc("field",        3046, "field_svc",        "civitas_field"),
    svc("catalogue",    3044, "catalogue_svc",    "civitas_catalogue"),
    svc("journey",      3045, "journey_svc",      "civitas_journey"),
    svc("loyalty",      3048, "loyalty_svc",      "civitas_loyalty"),
    svc("recommendation", 3040, "recommendation_svc", "civitas_recommendation"),
    svc("cdp",         3047, "cdp_svc",         "civitas_cdp"),
    svc("revenue",      3038, "revenue_svc",      "civitas_revenue"),
    svc("inspection",   3037, "inspection_svc",   "civitas_inspection", {
      S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ?? "civitas-inspection",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:4566",
      S3_REGION: process.env.S3_REGION ?? "ap-south-1",
      HRMS_SERVICE_URL: "http://127.0.0.1:3012",
    }),
    svc("location",     4012, "location_svc",     "civitas_location"),

    // ── Gateway ────────────────────────────────────────────────────────────────
    // DATABASE_URL required to mount CAP-052 catalogue routes (FORCE-RLS reads)
    // and to let the proxy stay healthy when catalogue is enabled. Proxy routing
    // itself does not use the DB.
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
        NODE_ENV: RUNTIME_NODE_ENV,
        PORT: 8080,
        BIND_HOST: "127.0.0.1",
        ...AUTH_ENV,
        INTERNAL_SERVICE_SECRET,
        // AWS_ENV supplies QUEUE_DRIVER=sqs for catalogue CQRS publishes.
        // Force-clear REDIS_URL: PM2 inherits the shell env; a host REDIS_URL
        // enables the broken `{ url }` rate-limit store (defineCommand crash).
        ...AWS_ENV,
        REDIS_URL: "",
        DATABASE_URL: dbUrl("gateway_svc", "civitas_gateway"),
        QUEUE_HEALTH_URL: process.env.QUEUE_HEALTH_URL ?? "http://127.0.0.1:3030/health",
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
        ENABLE_DEV_LOGIN: process.env.ENABLE_DEV_LOGIN ?? "",
        SAMPLE_DATA_ENABLED: process.env.SAMPLE_DATA_ENABLED ?? "",
        CIVITASONE_API_BASE_URL: "http://127.0.0.1:8080",
        NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8080",
      },
    },
  ],
};
