"use client";

import { useDesignerT } from "@/lib/designerText";
import { DEFAULT_BLOCKS } from "../_data/designerConstants";
import type { DesignIssue } from "../_data/designerGating";

const ISSUE_KEY: Record<DesignIssue["code"], string> = {
  hoa_missing: "issueHoaMissing",
  fee_missing: "issueFeeMissing",
  signatory_missing: "issueSignatoryMissing",
  doc_no_lane: "issueDocNoLane",
};

/**
 * D4c #7: every blocking issue and warning in one list, so a warning cannot go
 * unseen. Uses the same "Blocks Next" / "Warning" wording as the block rail and
 * the help texts.
 */
export function DesignIssuesList({ issues }: { issues: DesignIssue[] }) {
  const t = useDesignerT();
  return (
    <section data-testid="design-issues" aria-label={t("reviewIssuesTitle")}>
      <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>{t("reviewIssuesTitle")}</h4>
      {issues.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("reviewIssuesNone")}</p>
      ) : (
        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13 }}>
          {issues.map((i) => {
            const block = DEFAULT_BLOCKS.find((b) => b.id === i.blockId);
            return (
              <li key={`${i.blockId}-${i.code}`} data-severity={i.severity} style={{ marginBottom: 4 }}>
                <strong style={{ color: i.severity === "blocks_next" ? "var(--bad)" : "var(--warn)" }}>
                  {i.severity === "blocks_next" ? t("gateBlocksNext") : t("gateWarning")}
                </strong>
                {" · "}
                {block ? `${block.shortLabel} ` : ""}
                {t(ISSUE_KEY[i.code], { count: i.count ?? 1 })}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
