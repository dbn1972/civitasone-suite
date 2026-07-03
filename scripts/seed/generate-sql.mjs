#!/usr/bin/env node
/**
 * Reads fixture JSON files and generates SQL INSERT statements.
 * Called by sandbox-seed.mjs or can run standalone.
 *
 * Usage: node scripts/seed/generate-sql.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function escapeSQL(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  return `'${String(val).replace(/'/g, "''")}'`;
}

function generateInserts(table, rows, schema = "public") {
  if (!rows || rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const lines = rows.map((row) => {
    const values = columns.map((col) => escapeSQL(row[col]));
    return `  (${values.join(", ")})`;
  });
  return `INSERT INTO ${schema}.${table} (${columns.join(", ")}) VALUES\n${lines.join(",\n")}\nON CONFLICT DO NOTHING;\n\n`;
}

export default function generate(fixturesDir, outputDir) {
  const dir = fixturesDir || join(__dirname, "fixtures");
  const out = outputDir || join(__dirname, "output");
  if (!existsSync(out)) mkdirSync(out, { recursive: true });

  const sqlParts = [];
  sqlParts.push("-- CivitasOne Sandbox Seed Data");
  sqlParts.push("-- Generated: " + new Date().toISOString());
  sqlParts.push("-- Apply per-service using psql.\n");
  sqlParts.push("BEGIN;\n");

  // Tenant
  const tenantFile = join(dir, "tenant.json");
  if (existsSync(tenantFile)) {
    const tenant = JSON.parse(readFileSync(tenantFile, "utf-8"));
    sqlParts.push("-- Tenant service data");
    sqlParts.push(generateInserts("tenants", Array.isArray(tenant) ? tenant : [tenant], "tenant"));
  }

  // Employees
  const empFile = join(dir, "employees.json");
  if (existsSync(empFile)) {
    const employees = JSON.parse(readFileSync(empFile, "utf-8"));
    sqlParts.push("-- HRMS service data");
    sqlParts.push(generateInserts("employees", employees, "hrms"));
  }

  // Finance
  const finFile = join(dir, "finance.json");
  if (existsSync(finFile)) {
    const finance = JSON.parse(readFileSync(finFile, "utf-8"));
    sqlParts.push("-- Finance service data");
    if (finance.bills) sqlParts.push(generateInserts("bills", finance.bills, "finance"));
    if (finance.sanctions) sqlParts.push(generateInserts("sanctions", finance.sanctions, "finance"));
    if (finance.bank_accounts) sqlParts.push(generateInserts("bank_accounts", finance.bank_accounts, "finance"));
  }

  // Procurement
  const procFile = join(dir, "procurement.json");
  if (existsSync(procFile)) {
    const proc = JSON.parse(readFileSync(procFile, "utf-8"));
    sqlParts.push("-- Procurement service data");
    if (proc.vendors) sqlParts.push(generateInserts("vendors", proc.vendors, "procurement"));
    if (proc.indents) sqlParts.push(generateInserts("indents", proc.indents, "procurement"));
    if (proc.purchase_orders) sqlParts.push(generateInserts("purchase_orders", proc.purchase_orders, "procurement"));
  }

  // Helpdesk
  const hdFile = join(dir, "helpdesk.json");
  if (existsSync(hdFile)) {
    const helpdesk = JSON.parse(readFileSync(hdFile, "utf-8"));
    sqlParts.push("-- Helpdesk service data");
    sqlParts.push(generateInserts("tickets", Array.isArray(helpdesk) ? helpdesk : helpdesk.tickets || [], "helpdesk"));
  }

  // Citizen
  const citizenFile = join(dir, "citizen.json");
  if (existsSync(citizenFile)) {
    const citizen = JSON.parse(readFileSync(citizenFile, "utf-8"));
    sqlParts.push("-- Citizen service data");
    if (citizen.rti_requests) sqlParts.push(generateInserts("rti_requests", citizen.rti_requests, "citizen"));
    if (citizen.grievances) sqlParts.push(generateInserts("grievances", citizen.grievances, "citizen"));
    if (citizen.service_requests) sqlParts.push(generateInserts("service_requests", citizen.service_requests, "citizen"));
  }

  sqlParts.push("COMMIT;\n");

  const outputPath = join(out, "sandbox-seed.sql");
  writeFileSync(outputPath, sqlParts.join("\n"), "utf-8");
  console.log(`✅ Generated: ${outputPath}`);
}

// Allow standalone execution
if (process.argv[1] && process.argv[1].endsWith("generate-sql.mjs")) {
  generate();
}
