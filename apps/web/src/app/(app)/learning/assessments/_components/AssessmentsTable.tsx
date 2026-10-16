"use client";
import Link from "next/link";
import { DataTable } from "@/app/_components/ds";

type Row = { id: string; title: string; passing: string; duration: string; attempts: number; status: string; courseRef: string };

const columns = [
  { key: "title", label: "Assessment" },
  { key: "passing", label: "Passing score", align: "right" as const },
  { key: "duration", label: "Duration", align: "right" as const },
  { key: "attempts", label: "Max attempts", align: "right" as const },
  { key: "status", label: "Status", cellType: "status" as const },
  {
    key: "courseRef",
    label: "Course",
    sortable: false,
    render: (r: Row) =>
      r.courseRef ? (
        <Link href={"/learning/courses/" + r.courseRef} className="btn ghost" style={{ fontSize: "0.8125rem", padding: "2px 10px" }}>
          View course
        </Link>
      ) : (
        <span style={{ color: "var(--ink2)" }}>—</span>
      ),
  },
];

export function AssessmentsTable({ rows }: { rows: Row[] }) {
  return (
    <DataTable<Row>
      columns={columns}
      rows={rows}
      rowLinkKey="id"
      rowLinkPrefix="/learning/assessments/"
      identifyingColumnKey="title"
      sortable
      filterable
      filterPlaceholder="Filter assessments…"
      pageSize={15}
    />
  );
}
