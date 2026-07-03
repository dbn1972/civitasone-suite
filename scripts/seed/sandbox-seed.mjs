#!/usr/bin/env node
/**
 * Sandbox seed script — populates all services with realistic demo data.
 * Run: node scripts/seed/sandbox-seed.mjs
 *
 * This script reads fixture JSON files from scripts/seed/fixtures/ and
 * generates SQL INSERT statements that can be applied to each service DB.
 *
 * Usage:
 *   node scripts/seed/sandbox-seed.mjs              — prints summary
 *   node scripts/seed/sandbox-seed.mjs --generate   — generates SQL files
 *   node scripts/seed/sandbox-seed.mjs --apply      — applies via psql (requires DATABASE_URL)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const OUTPUT_DIR = join(__dirname, "output");

const FIXTURES = [
  "tenant.json",
  "employees.json",
  "finance.json",
  "procurement.json",
  "helpdesk.json",
  "citizen.json",
];

function loadFixture(name) {
  const path = join(FIXTURES_DIR, name);
  if (!existsSync(path)) {
    console.warn(`⚠ Fixture not found: ${name}`);
    return null;
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

function printSummary() {
  console.log("\n🌱 CivitasOne Sandbox Seed — Fixture Summary\n");
  console.log("─".repeat(60));

  for (const file of FIXTURES) {
    const data = loadFixture(file);
    if (!data) continue;
    const count = Array.isArray(data) ? data.length : Object.keys(data).length;
    console.log(`  ${file.padEnd(25)} ${count} records`);
  }

  console.log("─".repeat(60));
  console.log("\nRun with --generate to produce SQL insert scripts.");
  console.log("Run with --apply to execute against the database.\n");
}

function generate() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`\n🔧 Generating SQL from fixtures → ${OUTPUT_DIR}\n`);

  // Delegate to generate-sql.mjs
  import("./generate-sql.mjs").then((mod) => mod.default(FIXTURES_DIR, OUTPUT_DIR));
}

const arg = process.argv[2];
if (arg === "--generate") {
  generate();
} else if (arg === "--apply") {
  console.log("⚠ --apply requires DATABASE_URL environment variables set for each service.");
  console.log("   Run --generate first, then apply with: psql < scripts/seed/output/<service>.sql");
} else {
  printSummary();
}
