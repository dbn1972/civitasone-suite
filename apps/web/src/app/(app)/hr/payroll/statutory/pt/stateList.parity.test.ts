import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INDIAN_STATES_UTS } from "@/lib/india/states";

/**
 * The picker's state list (web) and payroll-service's INDIAN_STATE_UT_CODES
 * (the authority, which rejects any other code) must not drift apart. The
 * service also tolerates legacy aliases that the picker deliberately omits.
 */
const SERVER_FILE = resolve(__dirname, "../../../../../../../../../services/payroll-service/src/modules/payroll/state-rules.ts");
const LEGACY_ALIASES = ["OR", "DN", "DD", "UT"]; // Odisha, the two merged UTs, Uttarakhand (legacy)

function serverCodes(): string[] {
  const src = readFileSync(SERVER_FILE, "utf8");
  const body = /INDIAN_STATE_UT_CODES = \[([\s\S]*?)\] as const/.exec(src)?.[1] ?? "";
  return [...body.matchAll(/"([A-Z]{2})"/g)].map((m) => m[1]!);
}

describe("state list parity: web picker vs payroll-service", () => {
  const server = serverCodes();
  const web = INDIAN_STATES_UTS.map((s) => s.code);

  it("the server list could be read", () => {
    expect(server.length).toBeGreaterThan(30);
  });
  it("every picker state is accepted by the server", () => {
    expect(web.filter((c) => !server.includes(c))).toEqual([]);
  });
  it("the server accepts nothing the picker lacks, except the documented legacy aliases", () => {
    expect(server.filter((c) => !web.includes(c)).sort()).toEqual([...LEGACY_ALIASES].sort());
  });
  it("neither list repeats a code", () => {
    expect(new Set(web).size).toBe(web.length);
    expect(new Set(server).size).toBe(server.length);
  });
});
