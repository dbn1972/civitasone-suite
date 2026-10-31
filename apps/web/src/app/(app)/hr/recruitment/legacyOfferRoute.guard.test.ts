import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * UAT F85 guard: the web app must never call the deprecated legacy offer route
 * PATCH /v1/hrms/applications/:id/offer (singular). It sent offers with no
 * approval step; it is off by default and is removed before go-live. Offers are
 * made through the approval workflow (POST /v1/hrms/applications/:id/offers ->
 * /offers/:id/submit -> /approve -> /release), see OfferWorkflowDialog.
 *
 * Walks every non-test source file under apps/web/src and fails on any URL
 * that ends in `/applications/<id>/offer` (not `/offers`).
 */
const SRC = path.resolve(__dirname, "../../../../");

// `/applications/${...}/offer` or `/applications/:id/offer`, NOT followed by `s` or another word char.
const LEGACY_OFFER_URL = /\/applications\/(?:\$\{[^}]*\}|:[A-Za-z]+|[A-Za-z0-9-]+)\/offer(?![A-Za-z0-9_])/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function findLegacyOfferCalls(files: string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (LEGACY_OFFER_URL.test(line)) hits.push(`${path.relative(SRC, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe("UAT F85 -- no web call to the legacy PATCH .../applications/:id/offer route", () => {
  it("the pattern catches the legacy call shape and ignores the approval-flow routes", () => {
    expect(LEGACY_OFFER_URL.test("fetch(`/api/proxy/v1/hrms/applications/${appId}/offer`, { method: \"PATCH\" })")).toBe(true);
    expect(LEGACY_OFFER_URL.test("\"/v1/hrms/applications/:id/offer\"")).toBe(true);
    expect(LEGACY_OFFER_URL.test("fetch(`/api/proxy/v1/hrms/applications/${applicationId}/offers`)")).toBe(false);
    expect(LEGACY_OFFER_URL.test("post(`/v1/hrms/offers/${active.id}/release`, {})")).toBe(false);
  });

  it("apps/web/src has no call site for it", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    expect(findLegacyOfferCalls(files)).toEqual([]);
  });
});
