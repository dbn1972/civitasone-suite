import type { ReactNode } from "react";
import { PageHeader } from "./ds";
import type { ModuleRowSummary } from "@civitasone/types";
import type { LoaderSource } from "../_data/apiClient";
import { ModuleListTable } from "./ModuleListTable";

interface ModuleListPageProps {
  title: string;
  description: string;
  rows: ModuleRowSummary[];
  source: LoaderSource;
  children?: ReactNode;
}

function slugify(s: string): string {
  return `module.${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

export function ModuleListPage({ title, description, rows, source, children }: ModuleListPageProps) {
  return (
    <>
      <PageHeader title={title} subtitle={description} />
      {/* UX-012: the data-source badge now lives inside ModuleListTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      {children}
      <ModuleListTable cacheKey={slugify(title)} rows={rows} source={source === "error" ? "error" : "api"} />
    </>
  );
}
