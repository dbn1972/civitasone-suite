#!/usr/bin/env node
/**
 * Generate 0001_init.sql migrations for municipal Sec5 services from schema.ts files.
 * Usage: node scripts/dev/generate-municipal-migrations.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

const SERVICES = [
  "shop-service",
  "trade-service",
  "building-service",
  "fire-service",
  "advertisement-service",
  "vendor-service",
  "roadcut-service",
  "event-service",
  "refund-service",
  "sewerage-service",
  "swm-service",
  "drainage-service",
  "parks-service",
  "animal-service",
  "crematorium-service",
  "parking-service",
  "market-service",
];

function serviceMeta(serviceDir) {
  const short = serviceDir.replace("-service", "");
  const dbUser = short.replace(/-/g, "_") + "_svc";
  const dbName = "civitas_" + short.replace(/-/g, "_");
  return { short, dbUser, dbName };
}

function drizzleTypeToSql(type, opts = {}) {
  switch (type) {
    case "uuid":
      return "uuid";
    case "varchar": {
      const len = opts.length ?? 255;
      return `varchar(${len})`;
    }
    case "char": {
      const len = opts.length ?? 1;
      return `char(${len})`;
    }
    case "text":
      return "text";
    case "integer":
      return "integer";
    case "bigint":
      return "bigint";
    case "boolean":
      return "boolean";
    case "jsonb":
      return "jsonb";
    case "timestamp":
      return "timestamptz";
    case "date":
      return "date";
    case "numeric": {
      const p = opts.precision ?? 12;
      const s = opts.scale ?? 2;
      return `numeric(${p}, ${s})`;
    }
    default:
      throw new Error(`Unsupported drizzle type: ${type}`);
  }
}

function parseColumnDef(raw) {
  const m = raw.match(
    /^(\w+)\("([^"]+)"(?:,\s*\{\s*length:\s*(\d+)(?:,\s*mode:\s*"[^"]+")?\s*\})?\)(.*)$/,
  );
  if (!m) {
    const nm = raw.match(/^numeric\("([^"]+)",\s*\{\s*precision:\s*(\d+),\s*scale:\s*(\d+)\s*\}\)(.*)$/);
    if (nm) {
      return parseColumnTail(nm[4], "numeric", nm[1], { precision: Number(nm[2]), scale: Number(nm[3]) });
    }
    throw new Error(`Cannot parse column: ${raw}`);
  }
  const [, type, colName, lengthStr, tail] = m;
  const opts = lengthStr ? { length: Number(lengthStr) } : {};
  return parseColumnTail(tail, type, colName, opts);
}

function parseColumnTail(tail, type, colName, opts) {
  const sqlType = drizzleTypeToSql(type, opts);
  const parts = [];
  let primary = false;
  let notNull = false;
  let unique = false;
  let defaultExpr = null;

  if (tail.includes(".primaryKey()")) primary = true;
  if (tail.includes(".notNull()")) notNull = true;
  if (tail.includes(".unique()")) unique = true;

  const defaultRandom = tail.match(/\.defaultRandom\(\)/);
  const defaultNow = tail.match(/\.defaultNow\(\)/);
  const defaultBool = tail.match(/\.default\((true|false)\)/);
  const defaultNum = tail.match(/\.default\((\d+)\)/);
  const defaultStr = tail.match(/\.default\("([^"]*)"\)/);
  const defaultArr = tail.match(/\.default\(\[\]\)/);
  const defaultObj = tail.match(/\.default\(\{\}\)/);

  if (defaultRandom) defaultExpr = "gen_random_uuid()";
  else if (defaultNow) defaultExpr = "now()";
  else if (defaultBool) defaultExpr = defaultBool[1];
  else if (defaultNum) defaultExpr = defaultNum[1];
  else if (defaultStr) defaultExpr = `'${defaultStr[1]}'`;
  else if (defaultArr) defaultExpr = "'[]'::jsonb";
  else if (defaultObj) defaultExpr = "'{}'::jsonb";

  if (primary) {
    parts.push(`${colName} ${sqlType} PRIMARY KEY`);
    if (defaultExpr) parts[parts.length - 1] += ` DEFAULT ${defaultExpr}`;
  } else {
    parts.push(`${colName} ${sqlType}`);
    if (notNull) parts.push("NOT NULL");
    if (defaultExpr) parts.push(`DEFAULT ${defaultExpr}`);
    if (unique) parts.push("UNIQUE");
  }

  return parts.join(" ");
}

function stripTypeAnnotations(body) {
  let out = "";
  let i = 0;
  while (i < body.length) {
    if (body.startsWith(".$type<", i)) {
      i += 7; // skip .$type<
      let depth = 1;
      while (i < body.length && depth > 0) {
        if (body[i] === "<") depth++;
        else if (body[i] === ">") depth--;
        i++;
      }
      continue;
    }
    out += body[i];
    i++;
  }
  return out;
}

function extractTableBlocks(content) {
  const blocks = [];
  const re = /\.table\("([^"]+)",\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const tableName = m[1];
    let i = re.lastIndex; // position after opening {
    let depth = 1;
    const start = i;
    while (i < content.length && depth > 0) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
      i++;
    }
    blocks.push([tableName, content.slice(start, i - 1)]);
    re.lastIndex = i;
  }
  return blocks;
}

function parseSchemaFile(content) {
  const tables = [];
  const schemaNames = [...content.matchAll(/pgSchema\("([^"]+)"\)/g)].map((m) => m[1]);
  const tableBlocks = extractTableBlocks(content);

  for (const [tableName, body] of tableBlocks) {
    const cleaned = body;
    const colMatches = [
      ...cleaned.matchAll(
        /(\w+)\("([^"]+)"(?:,\s*(\{[^}]*\}))?\)([^,\n]*)/g,
      ),
    ];
    const numericMatches = [
      ...cleaned.matchAll(
        /numeric\("([^"]+)",\s*\{\s*precision:\s*(\d+),\s*scale:\s*(\d+)\s*\}\)([^,\n]*)/g,
      ),
    ];

    const columns = [];
    for (const m of colMatches) {
      const [, type, colName, optBlock, tail] = m;
      if (type === "numeric") continue;
      const opts = {};
      if (optBlock) {
        const len = optBlock.match(/length:\s*(\d+)/);
        if (len) opts.length = Number(len[1]);
      }
      columns.push(parseColumnTail(tail, type, colName, opts));
    }
    for (const m of numericMatches) {
      const [, colName, precision, scale, tail] = m;
      columns.push(
        parseColumnTail(tail, "numeric", colName, {
          precision: Number(precision),
          scale: Number(scale),
        }),
      );
    }

    if (columns.length === 0) {
      throw new Error(`No columns parsed for table ${tableName}`);
    }

    tables.push({ tableName, columns });
  }

  return { schemaNames: [...new Set(schemaNames)], tables };
}

function collectServiceSchemas(serviceDir) {
  const modulesDir = path.join(ROOT, "services", serviceDir, "src", "modules");
  if (!fs.existsSync(modulesDir)) return { schemas: new Map(), tables: [] };

  const schemaToTables = new Map();
  const files = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(modulesDir, d.name, "schema.ts"))
    .filter((f) => fs.existsSync(f));

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const content = stripTypeAnnotations(raw);
    const { schemaNames, tables } = parseSchemaFile(content);
    const schemaName = schemaNames[0];
    if (!schemaName) continue;

    if (!schemaToTables.has(schemaName)) schemaToTables.set(schemaName, []);
    for (const t of tables) {
      schemaToTables.get(schemaName).push(t);
    }
  }

  return { schemas: schemaToTables };
}

function outboxSql() {
  return `
-- ── _outbox / _inbox (CQRS) ───────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid        NOT NULL,
  actor_id       uuid        NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload        jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
`;
}

function rlsSql(tables) {
  const tenantTables = tables.filter((t) =>
    t.columns.some((c) => c.startsWith("tenant_id ")),
  );

  let sql = `
-- ── Row Level Security ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
`;

  for (const { schema, table } of tenantTables) {
    const fq = `${schema}.${table}`;
    sql += `
ALTER TABLE ${fq} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${fq} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ${fq};
CREATE POLICY tenant_isolation ON ${fq}
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
`;
  }

  // Outbox RLS (tenant-scoped relay reads)
  sql += `
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
`;

  return sql;
}

function generateMigration(serviceDir) {
  const { dbUser, dbName, short } = serviceMeta(serviceDir);
  const { schemas } = collectServiceSchemas(serviceDir);
  const allTables = [];

  let sql = `-- ${short}-service initial migration
-- Applied with ${dbUser} role on ${dbName}.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

`;

  for (const [schemaName, tables] of schemas) {
    sql += `CREATE SCHEMA IF NOT EXISTS ${schemaName};\n\n`;
    for (const { tableName, columns } of tables) {
      sql += `CREATE TABLE IF NOT EXISTS ${schemaName}.${tableName} (\n  ${columns.join(",\n  ")}\n);\n\n`;
      allTables.push({ schema: schemaName, table: tableName, columns });
    }
  }

  sql += outboxSql();
  sql += rlsSql(allTables);

  sql += `
-- ── Grants ─────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${dbUser}') THEN
    GRANT USAGE ON SCHEMA _outbox TO ${dbUser};
    GRANT USAGE ON SCHEMA _inbox TO ${dbUser};
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO ${dbUser};
    GRANT SELECT, INSERT ON _inbox.processed TO ${dbUser};
`;

  for (const schemaName of schemas.keys()) {
    sql += `    GRANT USAGE ON SCHEMA ${schemaName} TO ${dbUser};\n`;
    sql += `    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ${schemaName} TO ${dbUser};\n`;
  }

  sql += `  END IF;
END $$;
`;

  return sql;
}

let count = 0;
for (const serviceDir of SERVICES) {
  const migDir = path.join(ROOT, "services", serviceDir, "migrations");
  fs.mkdirSync(migDir, { recursive: true });
  const outPath = path.join(migDir, "0001_init.sql");
  const sql = generateMigration(serviceDir);
  fs.writeFileSync(outPath, sql);
  count++;
  console.log(`Wrote ${outPath}`);
}

console.log(`Generated ${count} migrations.`);
