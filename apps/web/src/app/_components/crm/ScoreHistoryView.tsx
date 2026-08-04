"use client";
/**
 * ScoreHistoryView — LQ-002. Timeline of a lead's score changes with the
 * contributing factors. Every stat is gated on the load source: when the load
 * fails (source==="error") we render "—" + DataSourceBadge rather than showing
 * a fabricated 0 as if it were the real current score.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState } from "../ds";
import { getScoreHistory, type ScoreHistoryEntry, type LqSource } from "@/lib/crm/leadQualification";

function delta(entry: ScoreHistoryEntry): string {
  const d = entry.score - entry.previousScore;
  if (d > 0) return `▲ +${d}`;
  if (d < 0) return `▼ ${d}`;
  return "no change";
}

export function ScoreHistoryView({ leadId }: { leadId: string }) {
  const [history, setHistory] = useState<ScoreHistoryEntry[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const headingId = useId();

  useEffect(() => {
    let live = true;
    (async () => {
      setSource("loading");
      const { data, source: s } = await getScoreHistory(leadId);
      if (!live) return;
      setHistory(data);
      setSource(s);
    })();
    return () => { live = false; };
  }, [leadId]);

  const isError = source === "error";
  const current = history.length > 0 ? history[0].score : null;

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Score history</h3>
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>

      <div className="pad" style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Current score</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {isError || current === null ? "—" : current}
          </div>
        </div>
      </div>

      {source === "loading" ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px 12px" }}>
          Loading score history…
        </p>
      ) : history.length === 0 ? (
        <EmptyState
          icon="📈"
          title={isError ? "Score history unavailable" : "No score changes yet"}
          message={isError ? "We couldn't load the score history just now." : "This lead's score has not changed yet."}
        />
      ) : (
        <div className="pad">
          <ul className="tl" aria-labelledby={headingId}>
            {history.map((e, idx) => (
              <li key={idx} className={idx === 0 ? "cur" : "done"}>
                <div className="t">
                  Score {e.previousScore} → <strong>{e.score}</strong> ({delta(e)})
                  {e.source ? <span className="pill info" style={{ marginLeft: 8 }}>{e.source}</span> : null}
                </div>
                {e.reason ? <div className="d">{e.reason}</div> : null}
                {e.factors.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {e.factors.map((f, i) => <span key={i} className="pill mut">{f}</span>)}
                  </div>
                ) : null}
                {e.scoredAt ? <div className="d">{e.scoredAt}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
