/**
 * GAP-LEARNING-MY-LEARNING-03/04: client table for the learner's enrolments.
 * A Client Component so the Progress column can render a <ProgressBar> and the
 * Action column a Continue link via DataTable's `render` (which cannot cross
 * the Server->Client boundary). Progress sorts numerically on `progressPct`.
 */
"use client";

import Link from "next/link";
import { DataTable, ProgressBar, StatusPill } from "@/app/_components/ds";
import { humanizeStatus } from "@/lib/formatters";

export type EnrolmentRow = {
  id: string;
  course: string;
  code: string;
  progressPct: number;
  statusRaw: string;
  courseId: string;
  resumeLessonId: string;
  overdue: boolean;
};

export function EnrolmentsTable({ rows }: { rows: EnrolmentRow[] }) {
  return (
    <DataTable<EnrolmentRow>
      columns={[
        { key: "course", label: "Course" },
        { key: "code", label: "Code" },
        {
          key: "progressPct",
          label: "Progress",
          align: "right",
          render: (r) => (
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
              <div style={{ width: 90 }}>
                <ProgressBar value={r.progressPct} label={`${r.course} progress ${r.progressPct}%`} />
              </div>
              <span>{r.progressPct}%</span>
            </div>
          ),
        },
        {
          key: "statusRaw",
          label: "Status",
          render: (r) => (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span>{humanizeStatus(r.statusRaw)}</span>
              {r.overdue && <StatusPill status="overdue" />}
            </span>
          ),
        },
        {
          key: "resumeLessonId",
          label: "Action",
          sortable: false,
          render: (r) =>
            (r.statusRaw === "enrolled" || r.statusRaw === "in_progress") && r.resumeLessonId ? (
              <Link href={`/learning/courses/${r.courseId}/lessons/${r.resumeLessonId}`} className="btn">
                Continue
              </Link>
            ) : (
              <span style={{ color: "var(--ink2)" }}>—</span>
            ),
        },
      ]}
      rows={rows}
      sortable
      pageSize={20}
    />
  );
}
