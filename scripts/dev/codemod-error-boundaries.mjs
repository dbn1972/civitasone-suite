#!/usr/bin/env node
/**
 * Codemod: rewrite every route error.tsx to delegate to the shared <RouteError>,
 * which is the one clerk-safe error UI (no raw messages, plain support code,
 * Try again + Back + Help). Preserves each file's existing back-link when one can
 * be extracted; otherwise derives a sensible module back-link from the path.
 *
 * Idempotent: files already delegating to RouteError are skipped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const APP_DIR = "apps/web/src/app";

const files = execSync(`find ${APP_DIR} -name error.tsx`, { encoding: "utf8" })
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

const NICE = {
  hr: "HR", finance: "Finance", procurement: "Procurement", grants: "Grants",
  projects: "Projects", estab: "Establishment", citizen: "Citizen Services",
  "tenant-admin": "Office Admin", admin: "Admin", audit: "Audit", legal: "Legal",
  assets: "Assets", stock: "Stock", crm: "CRM", helpdesk: "Helpdesk",
  reports: "Reports", knowledge: "Knowledge", notifications: "Notifications",
  billing: "Billing", contracts: "Contracts", inventory: "Inventory",
  locations: "Locations", workflow: "Workflow", analytics: "Analytics",
  setup: "Getting Started", install: "Install", themes: "Themes",
  plugins: "Plugins", telephony: "Telephony", "developer-portal": "Developer Portal",
};

let changed = 0, skipped = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (src.includes("RouteError")) { skipped++; continue; }

  // Module segment: first path part after "(app)/" (or "dashboard" for root).
  const m = file.match(/\/app\/\(app\)\/([^/]+)\//);
  const seg = m ? m[1] : "dashboard";
  const nice = NICE[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");

  // Try to preserve an existing back link (first Link/a with href starting "/").
  let backHref = `/${seg === "dashboard" ? "dashboard" : seg}`;
  let backLabel = `Back to ${nice}`;
  const link = src.match(/<(?:Link|a)\s+href=["'](\/[^"']*)["'][^>]*>\s*([^<]+?)\s*<\/(?:Link|a)>/);
  if (link) {
    backHref = link[1];
    const label = link[2].trim();
    if (label && !/back/i.test(label)) backLabel = label;
    else if (label) backLabel = label;
  }

  const area = seg === "dashboard" ? "page" : `${nice} page`;

  const out = `"use client";

import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref=${JSON.stringify(backHref)}
      backLabel=${JSON.stringify(backLabel)}
      area=${JSON.stringify(area)}
    />
  );
}
`;
  writeFileSync(file, out, "utf8");
  changed++;
}

console.log(`error.tsx codemod: ${changed} rewritten, ${skipped} skipped (already using RouteError).`);
