"use client";

import { useState } from "react";
import { DataTable, Tabs, TabPanel, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";

const progressColumns = [
  { key: "work", label: "Work", sortable: true },
  { key: "scope", label: "Scope", sortable: true },
  { key: "target", label: "Target", align: "right" as const, sortable: true },
  { key: "achievement", label: "Achievement", align: "right" as const, sortable: true },
  { key: "percentage", label: "%", align: "right" as const, sortable: true },
];

const issueColumns = [
  { key: "work", label: "Work", sortable: true },
  { key: "description", label: "Description", sortable: true },
  { key: "raisedDate", label: "Raised", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

const TABS = ["Progress", "Issues"] as const;

export function ExecutionTable({
  progress,
  issues,
  progressSource,
  issuesSource,
}: {
  progress: Record<string, unknown>[];
  issues: Record<string, unknown>[];
  // GAP-WORKS-EXECUTION-02: the two fetches are independent; a failure of one
  // must never flag the other. Each drives its OWN useSeededResource call.
  progressSource: "api" | "error";
  issuesSource: "api" | "error";
}) {
  const [active, setActive] = useState<string>(TABS[0]);
  const {
    data: progressData,
    provenance: progressProvenance,
    offline: progressOffline,
    cachedAt: progressCachedAt,
  } = useSeededResource(
    "works-execution-progress",
    progress,
    progressSource,
    (rows) => rows.length === 0,
  );
  const {
    data: issuesData,
    provenance: issuesProvenance,
    offline: issuesOffline,
    cachedAt: issuesCachedAt,
  } = useSeededResource("works-execution-issues", issues, issuesSource, (rows) => rows.length === 0);

  // GAP-WORKS-EXECUTION-02: when a tab's fetch failed and there is nothing
  // cached, show a real retry state in place of the table — not an empty
  // "no data" state that masks the failure.
  const loadError = toHumanError("load");

  return (
    <div>
      <Tabs tabs={[...TABS]} active={active} onChange={setActive} ariaLabel="Execution view" idPrefix="works-execution" />

      {active === "Progress" ? (
        <TabPanel idPrefix="works-execution" active={active}>
          <DataSourceBadge
            provenance={progressProvenance ?? "live"}
            cachedAt={progressCachedAt}
            offline={progressOffline}
          />
          {progressProvenance === "error-no-data" ? (
            <RefreshErrorState
              error={{ ...loadError, actions: ["retry", "back"] }}
              backHref="/works"
              source={{ area: "works", status: 500 }}
            />
          ) : (
            <DataTable
              columns={progressColumns}
              rows={progressData}
              sortable
              filterable
              filterPlaceholder="Search works..."
              pageSize={15}
              exportable
              exportFilename="works-execution-progress"
              emptyIcon="🏗️"
              emptyTitle="No execution data"
              emptyMessage="Execution progress records will appear here."
              rowHref={(row) => "/works/execution/" + String(row.workId ?? "")}
            />
          )}
        </TabPanel>
      ) : (
        <TabPanel idPrefix="works-execution" active={active}>
          <DataSourceBadge
            provenance={issuesProvenance ?? "live"}
            cachedAt={issuesCachedAt}
            offline={issuesOffline}
          />
          {issuesProvenance === "error-no-data" ? (
            <RefreshErrorState
              error={{ ...loadError, actions: ["retry", "back"] }}
              backHref="/works"
              source={{ area: "works", status: 500 }}
            />
          ) : (
            <DataTable
              columns={issueColumns}
              rows={issuesData}
              sortable
              filterable
              filterPlaceholder="Search issues..."
              pageSize={15}
              exportable
              exportFilename="works-execution-issues"
              emptyIcon="🚧"
              emptyTitle="No issues found"
              emptyMessage="Execution issues will appear here once raised."
              rowHref={(row) => "/works/execution/" + String(row.workId ?? "")}
            />
          )}
        </TabPanel>
      )}
    </div>
  );
}
