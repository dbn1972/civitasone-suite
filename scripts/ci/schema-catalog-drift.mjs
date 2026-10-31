/**
 * schema-catalog-drift.mjs — compare a database's catalog with the schema its
 * migrations build (UAT bundle 10, F100 / T9 schema-drift).
 *
 * WHY: on UAT several migrations "succeeded" as no-ops. An `IF NOT EXISTS` or a
 * name guard returned rc=0 but created nothing, because an older object of the
 * same name already existed (procurement 0021-0024 UNIQUE constraints, the asset
 * water-connection FK, the legal counsel-brief CHECK, ...). The tolerant deploy
 * runner hid the rest. Only a comparison of the REAL definitions catches this.
 *
 * Method (the T9 approach): one read-only catalog query per database renders every
 * column, constraint (pg_get_constraintdef), index (pg_get_indexdef) and RLS/FORCE
 * flag as a line; the expected side is a disposable database built by
 * scripts/ci/bootstrap-postgres.sh. Constraints and indexes are keyed by NAME and
 * their definitions compared, so a same-named object with a different definition
 * is drift, not a match.
 *
 * Classes:
 *   (a) FAIL — an object the migrations create is missing from the target, or a
 *       same-named one has a different definition, or RLS/FORCE is weaker.
 *   (b) INFO — extra objects only the target has (hand-made, legacy), stronger RLS.
 *   WARN    — a missing constraint/index whose exact definition exists under
 *       another name (enforced, but name-guarded migrations will not see it).
 */

/** Read-only catalog query. Every row is one `KIND|...` line. */
export const CATALOG_SQL = `
WITH ns AS (SELECT oid, nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'),
rel AS (SELECT c.oid, ns.nspname||'.'||c.relname AS fq, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relispartition FROM pg_class c JOIN ns ON ns.oid=c.relnamespace)
SELECT line FROM (
 SELECT 'TABLE|'||fq||'|'||relkind::text AS line FROM rel WHERE relkind IN ('r','p','v','m','f') AND NOT relispartition
 UNION ALL SELECT 'COL|'||r.fq||'.'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)||'|'||CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')
   FROM rel r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum WHERE r.relkind IN ('r','p','v','m','f') AND NOT r.relispartition
 UNION ALL SELECT 'CON|'||r.fq||'|'||co.conname||'|'||co.contype::text||'|'||pg_get_constraintdef(co.oid) FROM pg_constraint co JOIN rel r ON r.oid=co.conrelid WHERE NOT r.relispartition AND co.contype<>'n'
 UNION ALL SELECT 'IDX|'||r.fq||'|'||ic.relname||'|'||regexp_replace(pg_get_indexdef(i.indexrelid),'INDEX \\S+ ON (ONLY )?','INDEX ON ') FROM pg_index i JOIN rel r ON r.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid WHERE NOT r.relispartition
 UNION ALL SELECT 'RLS|'||fq||'|'||relrowsecurity||'|'||relforcerowsecurity FROM rel WHERE relkind IN ('r','p') AND NOT relispartition
) s ORDER BY 1`;

/** psql script: the catalog query inside a READ ONLY transaction. */
export const CATALOG_PSQL = `\\set ON_ERROR_STOP 1\nBEGIN READ ONLY;\n${CATALOG_SQL};\nROLLBACK;\n`;

/**
 * Parse catalog lines into Map<key, value>.
 *   TABLE|fq|kind          key TABLE|fq            value kind
 *   COL|fq.col|type|null|d key COL|fq.col          value type|null|d
 *   CON|fq|name|type|def   key CON|fq|name         value type|def
 *   IDX|fq|name|def        key IDX|fq|name         value def
 *   RLS|fq|enabled|force   key RLS|fq              value enabled|force
 */
export function parseCatalog(text) {
  const m = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || !line.includes("|")) continue;
    const p = line.split("|");
    const kind = p[0];
    if (kind === "TABLE" || kind === "COL" || kind === "RLS") m.set(`${kind}|${p[1]}`, p.slice(2).join("|"));
    else if (kind === "CON" || kind === "IDX") m.set(`${kind}|${p[1]}|${p[2]}`, p.slice(3).join("|"));
  }
  return m;
}

const isTrue = (v) => v === "t" || v === "true";

/**
 * Strip the varchar/text cast decoration that a pg_dump/restore round trip
 * rewrites without changing meaning, so a restored database is not reported:
 *   ANY ((ARRAY['a'::character varying])::text[])  (as created by a migration)
 *   ANY (ARRAY[('a'::character varying)::text])    (after dump + restore)
 * both become ANY (ARRAY['a']) (also for NULL elements, in CHECKs and in
 * partial-index predicates). Nothing else is normalised.
 */
export function normalizeDef(def) {
  return def
    .replace(/\(('(?:[^']|'')*'|NULL)::character varying\)::text/g, "$1")
    .replace(/('(?:[^']|'')*'|NULL)::character varying/g, "$1")
    .replace(/\(\(ARRAY\[([^\]]*)\]\)::text\[\]\)/g, "(ARRAY[$1])");
}

/**
 * Compare expected (migration-built) with target (live) catalogs.
 * Returns { fail: [...], warn: [...], info: [...] } of human-readable strings.
 */
export function compareCatalogs(expectedText, targetText) {
  const E = parseCatalog(expectedText);
  const L = parseCatalog(targetText);
  const fail = [];
  const warn = [];
  const info = [];

  // Definitions present in the target under any name, per table, to tell
  // "missing" from "present under another name".
  const defsByTable = new Map();
  for (const [k, v] of L) {
    const [kind, fq] = k.split("|");
    if (kind !== "CON" && kind !== "IDX") continue;
    const key = `${kind}|${fq}|${normalizeDef(v)}`;
    defsByTable.set(key, k.split("|")[2]);
  }

  for (const [k, ev] of E) {
    const kind = k.split("|")[0];
    const lv = L.get(k);
    if (kind === "RLS") {
      if (lv === undefined) continue; // the table itself is reported as missing
      const [ee, ef] = ev.split("|").map(isTrue);
      const [le, lf] = lv.split("|").map(isTrue);
      if ((ee && !le) || (ef && !lf)) fail.push(`${k}: expected enabled=${ee} force=${ef}, target enabled=${le} force=${lf}`);
      else if (ee !== le || ef !== lf) info.push(`${k}: target stricter (enabled=${le} force=${lf})`);
      continue;
    }
    if (lv === undefined) {
      if (kind === "CON" || kind === "IDX") {
        const fq = k.split("|")[1];
        const other = defsByTable.get(`${kind}|${fq}|${normalizeDef(ev)}`);
        if (other) {
          warn.push(`${k}: missing by name; identical definition exists as ${other}`);
          continue;
        }
      }
      fail.push(`${k}: MISSING (expected ${ev})`);
    } else if (lv !== ev && !((kind === "CON" || kind === "IDX") && normalizeDef(lv) === normalizeDef(ev))) {
      fail.push(`${k}: DEFINITION DIFFERS\n          expected: ${ev}\n          target  : ${lv}`);
    }
  }
  for (const [k, lv] of L) {
    if (!E.has(k) && k.split("|")[0] !== "RLS") info.push(`${k}: extra in target (${lv})`);
  }
  return { fail, warn, info };
}

/** Postgres ports of the shared UAT host: the live database and its pgbouncer. */
export const LIVE_DB_PORTS = ["5435", "6432"];

/**
 * Resolve where the guard connects. Never a default (F109): DATABASE_URL, else an
 * explicit PGHOST+PGPORT pair, else an error. POSTGRES_ADMIN_USER/PASSWORD override
 * the credentials (CI uses them). A live port is refused unless allowLive.
 * Returns { host, port, user, password } or throws.
 */
export function resolveConnection(env, { allowLive = false } = {}) {
  let host;
  let port;
  let user;
  let password;
  if (env.DATABASE_URL) {
    let u;
    try {
      u = new URL(env.DATABASE_URL);
    } catch {
      throw new Error("DATABASE_URL is not a valid URL");
    }
    host = decodeURIComponent(u.hostname.replace(/^\[|\]$/g, ""));
    port = u.port || "5432";
    user = decodeURIComponent(u.username);
    password = decodeURIComponent(u.password);
  } else if (env.PGHOST && env.PGPORT) {
    host = env.PGHOST;
    port = env.PGPORT;
    user = env.PGUSER;
    password = env.PGPASSWORD;
  } else {
    throw new Error(
      "database not configured: set DATABASE_URL (or PGHOST and PGPORT) to the database to check; " +
        "there is deliberately no default (the old localhost:5435 default is LIVE UAT on the shared host)",
    );
  }
  user = env.POSTGRES_ADMIN_USER || user;
  password = env.POSTGRES_ADMIN_PASSWORD ?? password;
  if (!user) throw new Error("database user not configured (DATABASE_URL user, PGUSER or POSTGRES_ADMIN_USER)");
  if (LIVE_DB_PORTS.includes(String(port)) && !allowLive) {
    throw new Error(
      `REFUSING to connect to port ${port}: on the shared host that is the LIVE UAT database ` +
        "(5435) or its pgbouncer (6432). Point DATABASE_URL at a disposable database, or pass " +
        "--live-readonly for the read-only post-deploy drift check.",
    );
  }
  return { host, port: String(port), user, password: password ?? "" };
}
