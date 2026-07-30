/**
 * R-RA-0105 — application-copy PDF HTML builder (pure).
 */
import { describe, it, expect } from "vitest";
import { escapeHtml, buildApplicationHtml } from "../src/modules/recruitment/application-pdf.js";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&#39;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("buildApplicationHtml", () => {
  const base = {
    id: "app-1", applicantName: "Asha Rao", applicationNo: "APP-001",
    vacancyTitle: "Junior Engineer", vacancyRef: "REF-9", category: "GEN",
    qualification: "B.Tech", experienceYears: 3, status: "shortlisted", appliedAt: "2026-07-01T00:00:00Z",
  };

  it("includes the candidate's own submitted data", () => {
    const html = buildApplicationHtml(base);
    expect(html).toContain("Asha Rao");
    expect(html).toContain("APP-001");
    expect(html).toContain("Junior Engineer");
    expect(html).toContain("B.Tech");
    expect(html).toContain("2026-07-01");
  });

  it("escapes a hostile applicant name (no markup injection into the PDF)", () => {
    const html = buildApplicationHtml({ ...base, applicantName: "<img src=x onerror=alert(1)>" });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("does NOT include internal screening artefacts", () => {
    const html = buildApplicationHtml(base).toLowerCase();
    expect(html).not.toContain("screening");
    expect(html).not.toContain("remark");
    expect(html).not.toContain("score");
  });

  it("renders em-dash for missing optional fields", () => {
    const html = buildApplicationHtml({ id: "x", applicantName: "N", applicationNo: null });
    expect(html).toContain("—");
  });
});
