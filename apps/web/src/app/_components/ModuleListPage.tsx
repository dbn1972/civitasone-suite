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
  /**
   * GAP-IDENTITY-{API-KEYS,BREAKGLASS}-06 / SESSIONS-06 / USERS-06 / WEBAUTHN-06:
   * optional client-side back link rendered by PageHeader (next/link, no full
   * reload), replacing hand-built <a href> breadcrumbs. Optional so existing
   * consumers are unaffected.
   */
  back?: string;
  backLabel?: string;
  /** Human noun for the failure state (GAP-IDENTITY-*-05), e.g. "sessions". */
  errorArea?: string;
  /**
   * GAP-THEMES-TEMPLATES-06: optional fixed offline cache key. ModuleListPage
   * normally derives the key from slugify(title); when the title is
   * translated (next-intl) that would change/split the per-user cache on a
   * locale switch, so a locale-independent key can be passed instead.
   */
  cacheKey?: string;
}

function slugify(s: string): string {
  return `module.${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

export function ModuleListPage({ title, description, rows, source, children, back, backLabel, errorArea, cacheKey }: ModuleListPageProps) {
  return (
    <>
      <PageHeader
        title={title}
        subtitle={description}
        {...(back ? { back } : {})}
        {...(backLabel ? { backLabel } : {})}
      />
      {/* UX-012: the data-source badge now lives inside ModuleListTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      {children}
      <ModuleListTable
        cacheKey={cacheKey ?? slugify(title)}
        rows={rows}
        source={source === "error" ? "error" : "api"}
        {...(errorArea ? { errorArea } : {})}
        {...(back ? { backHref: back } : {})}
      />
    </>
  );
}
