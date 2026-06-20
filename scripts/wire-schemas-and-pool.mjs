#!/usr/bin/env node
/**
 * Wire @civitasone/schemas error handler + @civitasone/db pool into all domain services.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SERVICES = join(ROOT, "services");

const DOMAIN_SERVICES = readdirSync(SERVICES).filter((d) => {
  const appPath = join(SERVICES, d, "src", "app.ts");
  try { return statSync(appPath).isFile(); } catch { return false; }
});

for (const svc of DOMAIN_SERVICES) {
  const pkgPath = join(SERVICES, svc, "package.json");
  const appPath = join(SERVICES, svc, "src", "app.ts");
  const dbPath = join(SERVICES, svc, "src", "shared", "db.ts");

  // package.json — add @civitasone/schemas
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies ??= {};
  if (!pkg.dependencies["@civitasone/schemas"]) {
    pkg.dependencies["@civitasone/schemas"] = "workspace:*";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`+ schemas dep: ${svc}`);
  }

  // app.ts — registerSchemaErrorHandler
  let app = readFileSync(appPath, "utf8");
  if (!app.includes("registerSchemaErrorHandler")) {
    if (!app.includes("@civitasone/schemas/plugin")) {
      const importLine = `import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";\nimport { HttpError } from "./shared/context.js";\n`;
      app = app.replace(/(import Fastify[^\n]+\n)/, `$1${importLine}`);
    }
    app = app.replace(
      /(\n  return app;\n\})/,
      `\n  registerSchemaErrorHandler(app, HttpError);\n$1`,
    );
    writeFileSync(appPath, app);
    console.log(`+ error handler: ${svc}`);
  }

  // db.ts — createSqlClient
  try {
    let db = readFileSync(dbPath, "utf8");
    if (db.includes("postgres(url") && !db.includes("createSqlClient")) {
      db = db.replace(
        /import postgres from "postgres";\n/,
        `import { createSqlClient } from "@civitasone/db";\n`,
      );
      db = db.replace(
        /export const sqlClient = postgres\(url, \{ max: Number\(process\.env\.DB_POOL_MAX \?\? 10\) \}\);/,
        "export const sqlClient = createSqlClient(url);",
      );
      writeFileSync(dbPath, db);
      console.log(`+ pool client: ${svc}`);
    }
  } catch { /* no db.ts */ }
}

console.log("Done.");
