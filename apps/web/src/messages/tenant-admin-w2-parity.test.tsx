/**
 * Wave 2 tenant-admin i18n (house rule: every user-facing string via t(), en AND hi).
 * Parity of the `tenantAdminW2` namespace and a real Hindi render of the new UI.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "./en.json";
import hi from "./hi.json";
import { ComplianceChecksTable } from "../app/(app)/tenant-admin/compliance/ComplianceChecksTable";

type Tree = { [k: string]: string | Tree };
const flat = (o: Tree, pre = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[pre + k] = v; else Object.assign(acc, flat(v, `${pre}${k}.`));
    return acc;
  }, {});
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

const E = flat((en as unknown as { tenantAdminW2: Tree }).tenantAdminW2);
const H = flat((hi as unknown as { tenantAdminW2: Tree }).tenantAdminW2);

describe("tenantAdminW2 messages", () => {
  it("hi has exactly the keys en has, non-empty, with matching placeholders", () => {
    expect(Object.keys(H).sort()).toEqual(Object.keys(E).sort());
    for (const k of Object.keys(E)) {
      expect(H[k].trim(), k).not.toBe("");
      expect(placeholders(H[k]), k).toEqual(placeholders(E[k]));
    }
  });

  it("every non-symbol hi string differs from en (really translated)", () => {
    for (const k of Object.keys(E)) if (E[k] !== "—") expect(H[k], k).not.toBe(E[k]);
  });

  it("ComplianceChecksTable renders Hindi labels, evidence copy and pluralisation", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hi}>
        <ComplianceChecksTable
          checks={[
            { id: "a", timestamp: "2026-02-01T10:00:00Z", title: "T1", result: "pass", evidenceCount: 0 } as never,
            { id: "b", timestamp: "2026-02-01T10:00:00Z", title: "T2", result: "fail", evidenceCount: 2 } as never,
          ]}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("साक्ष्य")).toBeInTheDocument();
    expect(screen.getByText("कोई दर्ज नहीं")).toBeInTheDocument();
    expect(screen.getByText("2 आइटम")).toBeInTheDocument();
  });
});
