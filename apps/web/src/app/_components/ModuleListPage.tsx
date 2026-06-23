import type { ReactNode } from "react";
import { DataSourceBadge } from "./DataSourceBadge";
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
      {source === "error" ? <DataSourceBadge source={source} /> : null}
      {children}
      <ModuleListTable cacheKey={slugify(title)} rows={rows} source={source === "error" ? "error" : "api"} />
    </>
  );
}
