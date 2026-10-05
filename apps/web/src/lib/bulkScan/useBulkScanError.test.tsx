import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import type { FailedResult } from "./api";
import { errorText, useBulkScanError } from "./useBulkScanError";

const fail = (status: number, code: string | null = null, reference: string | null = null): FailedResult => ({ ok: false, status, code, message: "raw backend text 123", reference });
const wrap = (locale: "en" | "hi") => ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>{children}</NextIntlClientProvider>
);
const describeWith = (locale: "en" | "hi" = "en") => renderHook(() => useBulkScanError(), { wrapper: wrap(locale) }).result.current;

describe("useBulkScanError", () => {
  it("bulk-scan specific codes keep their catalogued copy (clearance, maker-checker, stale) and carry the reference", () => {
    const d = describeWith();
    expect(d(fail(403, "CLEARANCE_DENIED", "ref-0001")).message).toMatch(/above your clearance level/);
    expect(d(fail(503, "CLEARANCE_UNAVAILABLE")).message).toMatch(/clearance check is temporarily unavailable/);
    expect(d(fail(409, "MAKER_CHECKER_VIOLATION")).message).toMatch(/cannot approve your own request/);
    expect(d(fail(409, "STALE")).message).toMatch(/Someone else changed this file/);
    expect(d(fail(403, "CLEARANCE_DENIED", "ref-0001")).reference).toBe("ref-0001");
  });

  it("everything else resolves through the app standard: status-aware copy, the reference, and never raw status, code or backend text", () => {
    const d = describeWith();
    expect(d(fail(403)).message).toBe("You don't have permission to do this. Ask your administrator if you need access.");
    expect(d(fail(401)).message).toMatch(/Your session has ended/);
    expect(d(fail(0)).message).toMatch(/couldn't connect/);
    const server = d(fail(500, null, "corr-id-77"));
    expect(server.message).toMatch(/problem on our side/);
    expect(server.reference).toBe("corr-id-77");
    expect(errorText(server)).toMatch(/Reference: corr-id-77/);
    for (const s of [400, 403, 404, 409, 500, 503]) expect(d(fail(s, "SOME_CODE")).message).not.toMatch(/raw backend|\b[45]\d\d\b|SOME_CODE/);
  });

  it("is localised: Hindi for both the specific and the standard copy", () => {
    const d = describeWith("hi");
    expect(d(fail(503, "CLEARANCE_UNAVAILABLE")).message).toMatch(/[\u0900-\u097F]/);
    expect(d(fail(500)).message).toMatch(/[\u0900-\u097F]/);
  });
});
