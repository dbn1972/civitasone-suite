import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../_components/ds";
import { RefreshErrorState } from "../../_components/ds/RefreshErrorState";
import { humanErrorFromFailure } from "@/lib/messages";
import { loadInbox } from "./_data/inboxData";
import { INBOX_TABS, MODULE_REF_TYPES, isModuleKey, type InboxTab, type ModuleKey } from "./_lib/inboxModel";
import { ApprovalsInbox } from "./_components/ApprovalsInbox";
import { InboxTabs } from "./_components/InboxTabs";

export const dynamic = "force-dynamic";

type SearchParams = { tab?: string | string[]; module?: string | string[]; task?: string | string[]; q?: string | string[] };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UX R1: the ONE approvals inbox. /workflow/my-tasks, /procurement/approvals, /hr/leave/approvals
 * and /estab/approvals now 308 here (next.config.mjs), the module queues as ?module= filters.
 * Deep link: ?task=<id> opens that task in the decision panel.
 */
export default async function ApprovalsPage(props: { searchParams?: Promise<SearchParams> }) {
  const sp = (await props.searchParams) ?? {};
  const tabRaw = one(sp.tab);
  const tab: InboxTab = (INBOX_TABS as readonly string[]).includes(tabRaw ?? "") ? (tabRaw as InboxTab) : "waiting";
  const moduleRaw = one(sp.module);
  const module: ModuleKey | "all" = isModuleKey(moduleRaw) ? moduleRaw : "all";
  const q = (one(sp.q) ?? "").trim().slice(0, 100);
  const taskRaw = one(sp.task);
  const task = taskRaw && UUID_RE.test(taskRaw) ? taskRaw : null;
  const refTypes = module !== "all" && module !== "other" ? MODULE_REF_TYPES[module] : undefined;

  const t = await getTranslations("approvalsInbox");
  const data = await loadInbox(tab, { ...(refTypes ? { refTypes } : {}), ...(q ? { q } : {}) });
  const failed = data.source === "error";
  const area = t("loadErrorArea");

  const tabLabels = { nav: t("tabsLabel"), waiting: t("tabs.waiting"), sent: t("tabs.sent"), done: t("tabs.done") };

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/dashboard" help="approvals" />
      {failed ? (
        <>
        <InboxTabs tab={tab} counts={null} module={module} labels={tabLabels} />
        <RefreshErrorState
          error={humanErrorFromFailure({ ...(data.status !== undefined ? { status: data.status } : {}), kind: "load", area })}
          backHref="/dashboard"
          source={{ ...(data.status !== undefined ? { status: data.status } : {}), area }}
        />
        </>
      ) : (
        <ApprovalsInbox
          key={`${tab}:${module}:${q}`}
          tab={tab}
          tasks={data.tasks}
          summaries={data.summaries}
          counts={data.counts}
          total={data.total}
          initialModule={module}
          initialTaskId={task}
          serverQuery={q}
          tabLabels={tabLabels}
        />
      )}
    </>
  );
}
