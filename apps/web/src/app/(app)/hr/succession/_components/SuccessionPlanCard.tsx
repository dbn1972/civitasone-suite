/**
 * SuccessionPlanCard / SuccessionPlanList — Sprint 14 / Lifecycle Phase 2
 * For each critical post: identified successors with readiness level
 * (Ready Now / 1-2 Years / 3-5 Years), skill gap chips, dev plan link.
 * Server component — no client state needed.
 */
import { formatIndianDate } from "@/lib/formatters";

export type Readiness = "ready_now" | "one_two_years" | "three_five_years";

export interface Successor {
  employeeId: string;
  name?: string;
  readiness: Readiness;
  skillGaps?: string[];
  devPlanUrl?: string;
}

export interface CriticalPost {
  id: string;
  roleRef: string;
  department?: string;
  currentHolder?: string;
  retirementDate?: string | null;
  riskLevel?: "high" | "medium" | "low" | null;
  successors: Successor[];
}

const READINESS_CFG: Record<Readiness, { label: string; color: string; bg: string; order: number }> = {
  ready_now:        { label: "Ready Now",  color: "#16a34a", bg: "#f0fdf4", order: 0 },
  one_two_years:    { label: "1–2 Years",  color: "#d97706", bg: "#fffbeb", order: 1 },
  three_five_years: { label: "3–5 Years",  color: "#6b7280", bg: "#f3f4f6", order: 2 },
};

const RISK_CFG: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: "High Risk",   color: "#dc2626", bg: "#fef2f2" },
  medium: { label: "Medium Risk", color: "#b45309", bg: "#fffbeb" },
  low:    { label: "Low Risk",    color: "#16a34a", bg: "#f0fdf4" },
};

function ReadinessBar({ successors }: { successors: Successor[] }) {
  const counts: Record<Readiness, number> = {
    ready_now: 0, one_two_years: 0, three_five_years: 0,
  };
  for (const s of successors) counts[s.readiness]++;
  const total = successors.length || 1;
  const bands: Readiness[] = ["ready_now", "one_two_years", "three_five_years"];
  return (
    <div
      style={{ display: "flex", height: 6, borderRadius: 99, overflow: "hidden", gap: 2 }}
      aria-label="Readiness distribution"
    >
      {bands.map((r) => {
        const pct = (counts[r] / total) * 100;
        if (pct === 0) return null;
        return (
          <div
            key={r}
            style={{ width: `${pct}%`, background: READINESS_CFG[r].color, borderRadius: 99 }}
            title={`${READINESS_CFG[r].label}: ${counts[r]}`}
          />
        );
      })}
    </div>
  );
}

interface CardProps { post: CriticalPost }

export function SuccessionPlanCard({ post }: CardProps) {
  const risk      = RISK_CFG[post.riskLevel ?? "medium"] ?? RISK_CFG.medium;
  const readyNow  = post.successors.filter((s) => s.readiness === "ready_now").length;
  const sorted    = [...post.successors].sort(
    (a, b) =>
      READINESS_CFG[a.readiness].order - READINESS_CFG[b.readiness].order,
  );

  return (
    <article className="card" style={{ marginBottom: 0 }}>
      {/* Header */}
      <div className="card-h" style={{ alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>
            {post.roleRef}
          </h3>
          {post.department && (
            <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
              {post.department}
            </p>
          )}
        </div>
        <span
          style={{
            padding: "3px 10px", borderRadius: 12,
            background: risk.bg, color: risk.color,
            fontSize: "0.75rem", fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {risk.label}
        </span>
      </div>

      {/* Current holder + vacancy date */}
      {(post.currentHolder || post.retirementDate) && (
        <div style={{ padding: "6px 16px 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
          {post.currentHolder && (
            <span>
              Current holder: <strong>{post.currentHolder}</strong>
            </span>
          )}
          {post.retirementDate && (
            <span style={{ marginLeft: 14, color: "var(--ink3)" }}>
              Vacates: {formatIndianDate(post.retirementDate)}
            </span>
          )}
        </div>
      )}

      {/* Readiness summary */}
      <div style={{ padding: "12px 16px 0" }}>
        <div
          style={{
            display: "flex", justifyContent: "space-between",
            marginBottom: 6, fontSize: "0.75rem", color: "var(--ink3)",
          }}
        >
          <span>
            {post.successors.length} successor{post.successors.length !== 1 ? "s" : ""}
          </span>
          <span style={{ color: readyNow > 0 ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
            {readyNow > 0 ? `${readyNow} ready now` : "None ready now ⚠️"}
          </span>
        </div>
        {post.successors.length > 0 && <ReadinessBar successors={post.successors} />}
      </div>

      {/* Successor list */}
      <div style={{ marginTop: 10 }}>
        {sorted.length === 0 ? (
          <div
            style={{
              padding: "14px 16px", fontSize: "0.875rem",
              color: "#dc2626", background: "#fef2f2",
              margin: "8px 16px", borderRadius: 8,
            }}
          >
            ⚠️ No successors identified — key-person risk. Initiate succession planning.
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {sorted.map((s) => {
              const rc       = READINESS_CFG[s.readiness];
              const initials = (s.name ?? s.employeeId).charAt(0).toUpperCase();
              return (
                <li
                  key={s.employeeId}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 12,
                    padding: "9px 16px",
                    borderTop: "1px solid var(--line, #f1f5f9)",
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: rc.bg, color: rc.color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700, flexShrink: 0,
                    }}
                    aria-hidden
                  >
                    {initials}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Name + readiness badge */}
                    <div
                      style={{
                        display: "flex", alignItems: "center",
                        gap: 8, flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>
                        {s.name ?? s.employeeId}
                      </span>
                      <span
                        style={{
                          padding: "2px 9px", borderRadius: 12,
                          background: rc.bg, color: rc.color,
                          fontSize: "0.6875rem", fontWeight: 600,
                        }}
                      >
                        {rc.label}
                      </span>
                    </div>

                    {/* Skill gap chips */}
                    {s.skillGaps && s.skillGaps.length > 0 && (
                      <div
                        style={{
                          display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5,
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: "0.6875rem", color: "var(--ink3)" }}>
                          Gaps:
                        </span>
                        {s.skillGaps.map((g) => (
                          <span
                            key={g}
                            style={{
                              padding: "1px 7px", borderRadius: 10,
                              background: "#fef3c7", color: "#92400e",
                              fontSize: "0.6875rem",
                            }}
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Dev plan link */}
                  {s.devPlanUrl ? (
                    <a
                      href={s.devPlanUrl}
                      style={{
                        fontSize: "0.75rem", color: "#2563eb",
                        textDecoration: "none", flexShrink: 0,
                        padding: "3px 9px", borderRadius: 5,
                        background: "#eff6ff", whiteSpace: "nowrap",
                      }}
                      aria-label={`Development plan for ${s.name ?? s.employeeId}`}
                    >
                      📋 Dev Plan
                    </a>
                  ) : (
                    <span
                      style={{ fontSize: "0.75rem", color: "var(--ink3)", flexShrink: 0 }}
                    >
                      No plan
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}

interface ListProps { posts: CriticalPost[] }

export function SuccessionPlanList({ posts }: ListProps) {
  if (posts.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink3)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🏆</div>
        <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 500 }}>
          No succession plans created
        </p>
        <p style={{ margin: "4px 0 0", fontSize: "0.8125rem" }}>
          Succession plans for critical roles appear here. Each plan tracks nominees and
          readiness for role assumption.
        </p>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid", gap: 14,
        gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
      }}
    >
      {posts.map((p) => (
        <SuccessionPlanCard key={p.id} post={p} />
      ))}
    </div>
  );
}
