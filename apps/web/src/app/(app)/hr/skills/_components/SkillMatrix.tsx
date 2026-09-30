"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";

// Proficiency scale matches the backend's canonical vocabulary (beginner,
// intermediate, advanced, expert — see gap-features/routes.ts POST
// /v1/hrms/skills/assessments) 1:1, so level 3 ("advanced") is reachable
// (GAP-HR-SKILLS-03; the previous 5-way label set mapped both advanced and
// expert to 4 and left level 3 permanently unreachable).
export type Proficiency = 0 | 1 | 2 | 3 | 4; // 0=not assessed,1=Beginner,2=Intermediate,3=Advanced,4=Expert

export interface SkillRecord {
  skill: string;
  category: string;
  employee: string;
  proficiency: Proficiency;
  requiredLevel?: Proficiency; // baseline used for gap coloring
}

export interface SkillMatrixProps {
  records: SkillRecord[];
}

// GAP-HR-SKILLS-04: colours are design tokens (light/dark aware) rather than
// fixed hex, so the matrix keeps working contrast in dark mode.
function dotColor(proficiency: Proficiency, required: Proficiency): string {
  if (proficiency === 0) return "var(--line)"; // not assessed
  if (proficiency >= required) return "var(--good)"; // meets/exceeds baseline
  if (required - proficiency === 1) return "var(--warn)"; // one level below
  return "var(--bad)"; // gap of 2+ levels
}

function Dot({ filled, color }: { filled: boolean; color: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: filled ? color : "var(--panel)",
        border: `2px solid ${filled ? color : "var(--line)"}`,
        flexShrink: 0,
      }}
    />
  );
}

const cellStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid var(--line)",
};

export function SkillMatrix({ records }: SkillMatrixProps) {
  const t = useTranslations("skills");
  const [filterCat, setFilterCat] = useState("All");
  const [filterEmp, setFilterEmp] = useState("");

  const PROFICIENCY_LABELS: Record<number, string> = {
    0: t("levelNone"),
    1: t("levelBeginner"),
    2: t("levelIntermediate"),
    3: t("levelAdvanced"),
    4: t("levelExpert"),
  };

  function gapWord(proficiency: Proficiency, required: Proficiency): string {
    if (proficiency === 0) return t("gapNotAssessed");
    if (proficiency >= required) return t("gapMeets");
    if (required - proficiency === 1) return t("gapOneBelow");
    return t("gapBehind");
  }

  const categories = ["All", ...Array.from(new Set(records.map((r) => r.category))).sort()];

  const filtered = records.filter((r) => {
    if (filterCat !== "All" && r.category !== filterCat) return false;
    if (filterEmp && !r.employee.toLowerCase().includes(filterEmp.toLowerCase())) return false;
    return true;
  });

  // Unique skills (rows) and employees (grouped)
  const skills = Array.from(new Set(filtered.map((r) => r.skill))).sort();
  const employees = Array.from(new Set(filtered.map((r) => r.employee))).sort();

  // Build lookup: employee+skill → record
  const lookup = new Map<string, SkillRecord>();
  for (const r of filtered) lookup.set(`${r.employee}::${r.skill}`, r);

  const COLS: Proficiency[] = [1, 2, 3, 4];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          aria-label={t("filterEmployeeLabel")}
          placeholder={t("filterEmployeePlaceholder")}
          value={filterEmp}
          onChange={(e) => setFilterEmp(e.target.value)}
          style={{
            padding: "5px 10px",
            fontSize: 13,
            border: "1px solid var(--line)",
            borderRadius: 6,
            flex: "1 1 160px",
            maxWidth: 200,
          }}
        />
        <select
          aria-label={t("filterCategoryLabel")}
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          style={{ padding: "5px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6 }}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === "All" ? t("filterAllCategories") : c}
            </option>
          ))}
        </select>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
        {[
          { color: "var(--good)", label: t("legendMeets") },
          { color: "var(--warn)", label: t("legendOneBelow") },
          { color: "var(--bad)", label: t("legendGap") },
          { color: "var(--line)", label: t("legendNotAssessed") },
        ].map(({ color, label }) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Dot filled color={color} />
            <span style={{ color: "var(--ink2)" }}>{label}</span>
          </span>
        ))}
      </div>

      {/* Matrix table */}
      <div style={{ overflowX: "auto" }}>
        {skills.length === 0 ? (
          <p style={{ color: "var(--mut)", textAlign: "center", padding: 24 }}>{t("noMatch")}</p>
        ) : (
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 720, width: "100%" }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <th style={{ ...cellStyle, textAlign: "start", minWidth: 130, fontWeight: 700, color: "var(--ink)" }}>
                  {t("colEmployee")}
                </th>
                <th style={{ ...cellStyle, textAlign: "start", minWidth: 150, fontWeight: 700, color: "var(--ink)" }}>
                  {t("colSkill")}
                </th>
                <th style={{ ...cellStyle, textAlign: "start", minWidth: 100, fontWeight: 700, color: "var(--ink)" }}>
                  {t("colCategory")}
                </th>
                {COLS.map((level) => (
                  <th
                    key={level}
                    style={{ ...cellStyle, textAlign: "center", fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap" }}
                  >
                    {PROFICIENCY_LABELS[level]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skills.flatMap((skill) => {
                // GAP-HR-SKILLS-02: index into the records that actually exist
                // for this skill, not into the full (unfiltered) employees
                // list — otherwise a skill whose alphabetically-first
                // employee has no record loses its Skill/Category cells for
                // every row.
                const recs = employees
                  .map((emp) => lookup.get(`${emp}::${skill}`))
                  .filter((r): r is SkillRecord => Boolean(r));
                const required = (recs[0]?.requiredLevel ?? 3) as Proficiency;

                return recs.map((rec, idx) => {
                  const summary = t("rowSummary", {
                    employee: rec.employee,
                    level: PROFICIENCY_LABELS[rec.proficiency],
                    gap: gapWord(rec.proficiency, required),
                  });
                  return (
                    <tr key={`${skill}::${rec.employee}`} style={{ background: idx % 2 === 0 ? "var(--panel)" : "var(--bg)" }}>
                      {/* GAP-HR-SKILLS-01: employee is now a real column, not
                          just a filter — an org-wide row is otherwise
                          unattributable. The single accessible summary for
                          the whole row (GAP-HR-SKILLS-04) lives here so a
                          screen reader gets one labelled image with the
                          level name, instead of four separately-announced
                          filled/empty dots. */}
                      <td style={{ ...cellStyle, color: "var(--ink)" }}>
                        {rec.employee}
                        <span role="img" aria-label={summary} style={visuallyHidden} />
                      </td>
                      {idx === 0 && (
                        <>
                          <td rowSpan={recs.length} style={{ ...cellStyle, fontWeight: 600, color: "var(--ink)", verticalAlign: "top" }}>
                            {skill}
                          </td>
                          <td rowSpan={recs.length} style={{ ...cellStyle, color: "var(--mut)", verticalAlign: "top" }}>
                            {rec.category}
                          </td>
                        </>
                      )}
                      {COLS.map((level) => {
                        const isFilled = rec.proficiency >= level;
                        const color = dotColor(rec.proficiency, required);
                        return (
                          <td key={level} style={{ ...cellStyle, textAlign: "center" }}>
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <Dot filled={isFilled} color={isFilled ? color : "var(--line)"} />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};
