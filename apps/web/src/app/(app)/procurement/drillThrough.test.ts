import { describe, it, expect } from "vitest";
import {
  indentServiceStatus,
  indentServiceStatusQuery,
  parseIndentStatusFilter,
  parsePoStatusParam,
  PENDING_INDENT_STATUSES,
  PENDING_INDENTS_HREF,
} from "./drillThrough";

describe("parseIndentStatusFilter (GAP-PROCUREMENT-DASHBOARD-02)", () => {
  it("parses one status, a comma-separated set, and trims/dedupes", () => {
    expect(parseIndentStatusFilter("approved")).toEqual(["approved"]);
    expect(parseIndentStatusFilter("draft,pending_approval")).toEqual(["draft", "pending_approval"]);
    expect(parseIndentStatusFilter(" draft , draft,, pending_approval ")).toEqual(["draft", "pending_approval"]);
  });

  it("maps the raw service status 'pending' to the list's 'pending_approval'", () => {
    expect(parseIndentStatusFilter("pending")).toEqual(["pending_approval"]);
    expect(parseIndentStatusFilter("draft,pending")).toEqual(["draft", "pending_approval"]);
    expect(parseIndentStatusFilter("pending,pending_approval")).toEqual(["pending_approval"]);
  });

  it("returns [] for empty input and keeps unknown values so the page can report them", () => {
    expect(parseIndentStatusFilter(undefined)).toEqual([]);
    expect(parseIndentStatusFilter("")).toEqual([]);
    expect(parseIndentStatusFilter(" , ")).toEqual([]);
    expect(parseIndentStatusFilter("bogus")).toEqual(["bogus"]);
  });

  it("the dashboard link carries exactly the draft + pending set the service counts", () => {
    expect([...PENDING_INDENT_STATUSES]).toEqual(["draft", "pending_approval"]);
    expect(PENDING_INDENTS_HREF).toBe("/procurement/indents?status=draft,pending_approval");
  });
});

describe("parsePoStatusParam (GAP-PROCUREMENT-DASHBOARD-02)", () => {
  it("accepts known PO statuses, case-insensitively", () => {
    expect(parsePoStatusParam("approved")).toBe("approved");
    expect(parsePoStatusParam(" Approved ")).toBe("approved");
    expect(parsePoStatusParam("partial_grn")).toBe("partial_grn");
  });

  it("maps the first dashboard link's 'active' to approved", () => {
    expect(parsePoStatusParam("active")).toBe("approved");
  });

  it("returns undefined for empty, unknown and prototype-key values (show all)", () => {
    for (const bad of [undefined, "", "  ", "nope", "toString", "__proto__", "constructor"]) {
      expect(parsePoStatusParam(bad)).toBeUndefined();
    }
  });
});

describe("indentServiceStatusQuery (GAP-PROCUREMENT-DASHBOARD-02)", () => {
  it("maps the list's pending_approval back to the service's pending and leaves the rest alone", () => {
    expect(indentServiceStatus("pending_approval")).toBe("pending");
    for (const same of ["draft", "approved", "rejected", "tender_required", "converted_to_po", "closed", "bogus"]) {
      expect(indentServiceStatus(same)).toBe(same);
    }
  });

  it("builds the comma-separated service status the list API filters on before paging", () => {
    expect(indentServiceStatusQuery([])).toBeUndefined();
    expect(indentServiceStatusQuery(["approved"])).toBe("approved");
    expect(indentServiceStatusQuery([...PENDING_INDENT_STATUSES])).toBe("draft,pending");
  });
});
