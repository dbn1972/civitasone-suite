"use client";

import React, { useState } from "react";

export type Proficiency = 0 | 1 | 2 | 3 | 4; // 0=none,1=Beginner,2=Developing,3=Proficient,4=Expert
export const PROFICIENCY_LABELS: Record<number, string> = {
  0: "—",
  1: "Beginner",
  2: "Developing",
  3: "Proficient",
  4: "Expert",
};

export interface SkillRecord {
  skill: string;
  category: string;
  employee: string;
  proficiency: Proficiency;
  requiredLevel?: Proficiency; // role requirement for gap coloring
}

export interface SkillMatrixProps {
  records: SkillRecord[];
  onExportPdf?: () => void;
}

function dotColor(proficiency: Proficiency, required: Proficiency): string {
  if (proficiency === 0) return "#e2e8f0";  // not assessed
  if (proficiency >= required) return "#4ade80"; // at or above requirement
  if (required - proficiency === 1) return "#fbbf24"; // one level below
  return "#f87171"; // gap ≥ 2
}

function Dot({ filled, color }: { filled: boolean; color: string }) {
  return (
    <div
      style={{
        width: 16, height: 16, borderRadius: "50%",
        background: filled ? color : "#f1f5f9",
        border: `2px solid ${filled ? color : "#e2e8f0"}`,
        flexShrink: 0,
      }}
      aria-label={filled ? "filled" : "empty"}
    />
  );
}

export function SkillMatrix({ records, onExportPdf }: SkillMatrixProps) {
  const [filterCat, setFilterCat] = useState("All");
  const [filterEmp, setFilterEmp] = useState("");

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
          placeholder="Filter by employee…"
          value={filterEmp}
          onChange={(e) => setFilterEmp(e.target.value)}
          style={{
            padding: "5px 10px", fontSize: 13, border: "1px solid #cbd5e1",
            borderRadius: 6, flex: "1 1 160px", maxWidth: 200,
          }}
        />
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          style={{ padding: "5px 10px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }}
        >
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        {onExportPdf && (
          <button
            onClick={onExportPdf}
            style={{
              padding: "5px 12px", fontSize: 12, fontWeight: 600,
              border: "1px solid #cbd5e1", borderRadius: 6,
              background: "#fff", color: "#475569", cursor: "pointer",
              marginLeft: "auto",
            }}
          >
            Export PDF
          </button>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
        {[
          { color: "#4ade80", label: "At / above requirement" },
          { color: "#fbbf24", label: "1 level below" },
          { color: "#f87171", label: "Gap ≥ 2 levels" },
          { color: "#e2e8f0", label: "Not assessed" },
        ].map(({ color, label }) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Dot filled color={color} />
            <span style={{ color: "#475569" }}>{label}</span>
          </span>
        ))}
      </div>

      {/* Matrix table */}
      <div style={{ overflowX: "auto" }}>
        {skills.length === 0 ? (
          <p style={{ color: "#94a3b8", textAlign: "center", padding: 24 }}>No skill records match the filter.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 640, width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", border: "1px solid #e2e8f0", minWidth: 150, fontWeight: 700, color: "#1e293b" }}>
                  Skill
                </th>
                <th style={{ textAlign: "left", padding: "8px 10px", border: "1px solid #e2e8f0", minWidth: 100, fontWeight: 700, color: "#1e293b" }}>
                  Category
                </th>
                {COLS.map((level) => (
                  <th
                    key={level}
                    style={{
                      textAlign: "center", padding: "8px 10px", border: "1px solid #e2e8f0",
                      fontWeight: 700, color: "#1e293b", whiteSpace: "nowrap",
                    }}
                  >
                    {PROFICIENCY_LABELS[level]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skills.flatMap((skill) => {
                const skillRecs = filtered.filter((r) => r.skill === skill);
                const required  = skillRecs[0]?.requiredLevel ?? 3;
                return employees.map((emp, ei) => {
                  const rec = lookup.get(`${emp}::${skill}`);
                  if (!rec) return null;
                  return (
                    <tr
                      key={`${skill}::${emp}`}
                      style={{ background: ei % 2 === 0 ? "#fff" : "#f8fafc" }}
                    >
                      {ei === 0 && (
                        <>
                          <td
                            rowSpan={employees.filter((e) => lookup.has(`${e}::${skill}`)).length}
                            style={{
                              padding: "8px 10px", border: "1px solid #e2e8f0",
                              fontWeight: 600, color: "#1e293b", verticalAlign: "top",
                            }}
                          >
                            {skill}
                          </td>
                          <td
                            rowSpan={employees.filter((e) => lookup.has(`${e}::${skill}`)).length}
                            style={{
                              padding: "8px 10px", border: "1px solid #e2e8f0",
                              color: "#64748b", verticalAlign: "top",
                            }}
                          >
                            {rec.category}
                          </td>
                        </>
                      )}
                      {COLS.map((level) => {
                        const isFilled = rec.proficiency >= level;
                        const color    = dotColor(rec.proficiency as Proficiency, required as Proficiency);
                        return (
                          <td key={level} style={{ textAlign: "center", padding: "8px 10px", border: "1px solid #e2e8f0" }}>
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <Dot filled={isFilled} color={isFilled ? color : "#e2e8f0"} />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                }).filter(Boolean);
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
