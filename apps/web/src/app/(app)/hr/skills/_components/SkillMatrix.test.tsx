import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { SkillMatrix, type SkillRecord } from "./SkillMatrix";

function renderMatrix(records: SkillRecord[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SkillMatrix records={records} />
    </NextIntlClientProvider>,
  );
}

describe("SkillMatrix", () => {
  // GAP-HR-SKILLS-01: an org-wide row previously had no employee cell at
  // all, so two records for the same skill were indistinguishable.
  it("shows the employee for every row of a skill with multiple records", () => {
    renderMatrix([
      { skill: "Drizzle ORM", category: "Technical", employee: "Arjun Rao", proficiency: 2, requiredLevel: 3 },
      { skill: "Drizzle ORM", category: "Technical", employee: "Priya Nair", proficiency: 4, requiredLevel: 3 },
    ]);
    expect(screen.getByText("Arjun Rao")).toBeInTheDocument();
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
  });

  // GAP-HR-SKILLS-02: cells were emitted only for array-index 0 of the full
  // (unfiltered) employee list, so a skill whose alphabetically-first
  // employee had no record lost its Skill/Category cells for every row and
  // the dots shifted left.
  it("still renders Skill and Category cells when the alphabetically-first employee has no record for that skill", () => {
    renderMatrix([
      // "Arjun" sorts before "Priya" but only Priya has a "Kubernetes" record.
      { skill: "Kubernetes", category: "Technical", employee: "Priya Nair", proficiency: 3, requiredLevel: 3 },
      { skill: "Drizzle ORM", category: "Technical", employee: "Arjun Rao", proficiency: 2, requiredLevel: 3 },
    ]);
    const row = screen.getByText("Kubernetes").closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("Technical");
    expect(row).toHaveTextContent("Priya Nair");
  });

  // GAP-HR-SKILLS-04: level was conveyed by colour + fill count only, with
  // per-dot aria-label="filled"/"empty" repeated four times and no level
  // name anywhere in the accessible tree.
  it("exposes exactly one accessible, labelled summary per row naming the proficiency level", () => {
    renderMatrix([
      { skill: "Drizzle ORM", category: "Technical", employee: "Arjun Rao", proficiency: 2, requiredLevel: 3 },
    ]);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAccessibleName("Arjun Rao: Intermediate, 1 level below requirement");
  });

  it("filters by employee and by category", () => {
    renderMatrix([
      { skill: "Drizzle ORM", category: "Technical", employee: "Arjun Rao", proficiency: 2, requiredLevel: 3 },
      { skill: "Negotiation", category: "Soft Skills", employee: "Priya Nair", proficiency: 4, requiredLevel: 3 },
    ]);
    expect(screen.getByText("Drizzle ORM")).toBeInTheDocument();
    expect(screen.getByText("Negotiation")).toBeInTheDocument();
  });

  it("shows the no-match message when nothing fits the filter", () => {
    renderMatrix([]);
    expect(screen.getByText("No skill records match the filter.")).toBeInTheDocument();
  });
});
