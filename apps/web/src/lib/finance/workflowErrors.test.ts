import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { WORKFLOW_ERROR_KEYS, workflowErrorKey, workflowErrorMessage } from "./workflowErrors";

describe("workflow error mapping", () => {
  it("maps each known service code to a message key and leaves unknown codes alone", () => {
    expect(workflowErrorKey("MAKER_CHECKER_VIOLATION")).toBe("makerChecker");
    expect(workflowErrorKey("INSTRUMENT_NOT_STALE")).toBe("instrumentNotStale");
    expect(workflowErrorKey("SOMETHING_ELSE")).toBeNull();
    expect(workflowErrorKey(null)).toBeNull();
  });

  it("every mapped key has English and Hindi copy", () => {
    for (const key of Object.values(WORKFLOW_ERROR_KEYS)) {
      expect((enMessages.financeWorkflowErrors as Record<string, string>)[key], `en ${key}`).toBeTruthy();
      expect((hiMessages.financeWorkflowErrors as Record<string, string>)[key], `hi ${key}`).toBeTruthy();
    }
  });

  it("uses the plain-language copy for a known code, never the code or status", async () => {
    const res = new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION", message: "the same user cannot both make and approve" }), { status: 409 });
    const msg = await workflowErrorMessage(res, (k) => (enMessages.financeWorkflowErrors as Record<string, string>)[k]!, "save", "vendor");
    expect(msg).toMatch(/cannot also approve/);
    expect(msg).not.toMatch(/MAKER_CHECKER|409/);
  });

  it("falls back to the catalogued generic message for an unknown code or an unparseable body", async () => {
    const t = (k: string) => k;
    const a = await workflowErrorMessage(new Response(JSON.stringify({ code: "WEIRD", message: "stack at x" }), { status: 500 }), t, "save", "vendor");
    expect(a).toMatch(/couldn't save/i);
    expect(a).not.toMatch(/WEIRD|stack|500/);
    const b = await workflowErrorMessage(new Response("<html>bad gateway</html>", { status: 502 }), t, "save", "vendor");
    expect(b).not.toMatch(/html|502/);
    const forbidden = await workflowErrorMessage(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }), t, "save", "vendor");
    expect(forbidden).not.toMatch(/403|FORBIDDEN/);
  });
});
