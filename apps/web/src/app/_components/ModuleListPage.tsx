import type { ReactNode } from "react";
import { DataSourceBadge } from "./DataSourceBadge";
import { PageShell } from "./PageShell";
import type { ModuleRowSummary } from "@civitasone/types";
import type { LoaderSource } from "../_data/apiClient";

interface ModuleListPageProps {
  title: string;
  description: string;
  rows: ModuleRowSummary[];
  source: LoaderSource;
  children?: ReactNode;
}

export function ModuleListPage({ title, description, rows, source, children }: ModuleListPageProps) {
  return (
    <PageShell title={title} description={description}>
      {source === "error" ? <DataSourceBadge source={source} /> : null}
      {children}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-4 py-3 text-left">ID</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Detail</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Meta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-200">
                <td className="px-4 py-3 font-mono text-xs">{row.id.slice(0, 8)}</td>
                <td className="px-4 py-3">{row.label}</td>
                <td className="px-4 py-3 text-slate-600">{row.sublabel ?? "—"}</td>
                <td className="px-4 py-3">{row.status ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{row.meta ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
