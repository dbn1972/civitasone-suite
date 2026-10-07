import { Button, PageHeader, Card, EmptyState, DataTable, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { WriteOffCreateForm } from "./WriteOffCreateForm";
import { WriteOffLookupForm } from "./WriteOffLookupForm";

export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType: string;
};

type DcbSummary = { totalDemand: string; totalCollected: string; balance: string };

export type DemandOption = {
  id: string;
  financialYear: string;
  netMinor: string;
  status: string;
};

export type PendingWriteOffRow = {
  id: string;
  decidePath: string;
  assesseeId: string;
  amountLabel: string;
  reason: string;
  statusLabel: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function arrayFromPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: unknown[] }).data;
  }
  return null;
}

function mapAssessees(payload: unknown): AssesseeOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: AssesseeOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const ownerName = raw.ownerName;
    if (typeof id !== "string" || typeof ownerName !== "string") continue;
    mapped.push({
      id,
      ownerName,
      identifierNo: typeof raw.identifierNo === "string" ? raw.identifierNo : "—",
      assesseeType: typeof raw.assesseeType === "string" ? raw.assesseeType : "—",
    });
  }
  return mapped;
}

async function getAssessees(): Promise<LoaderResult<AssesseeOption[]>> {
  return fetchJson<unknown, AssesseeOption[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.write-offs.assessees",
    mapResponse: mapAssessees,
  });
}

async function getDcb(id: string): Promise<LoaderResult<DcbSummary | null>> {
  return fetchJson<unknown, DcbSummary | null>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}/dcb`, null, {
    telemetryKey: "revenue.write-offs.dcb",
    mapResponse: (p) => {
      const d = (p as { data?: DcbSummary })?.data;
      return d && typeof d.balance === "string" ? d : null;
    },
  });
}

// GAP-REVENUE-WRITE-OFFS-03: the assessee's demands, so a write-off can
// reference the specific demand/FY it reduces.
function mapDemands(payload: unknown): DemandOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: DemandOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    mapped.push({
      id: raw.id,
      financialYear: typeof raw.financialYear === "string" ? raw.financialYear : "—",
      netMinor: String(raw.netMinor ?? 0),
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

async function getDemands(assesseeId: string): Promise<LoaderResult<DemandOption[]>> {
  return fetchJson<unknown, DemandOption[]>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/demands`,
    [],
    { telemetryKey: "revenue.write-offs.demands", mapResponse: mapDemands },
  );
}

// GAP-REVENUE-WRITE-OFFS-02: pending write-offs the checker can discover and
// open with one click, instead of pasting a UUID from the maker.
async function getPendingWriteOffs(): Promise<LoaderResult<PendingWriteOffRow[]>> {
  return fetchJson<unknown, PendingWriteOffRow[]>(
    "/api/v1/revenue/write-offs?status=pending&limit=100",
    [],
    {
      telemetryKey: "revenue.write-offs.pending",
      mapResponse: (p) => {
        const rows = arrayFromPayload(p);
        if (!rows) return null;
        const mapped: PendingWriteOffRow[] = [];
        for (const raw of rows) {
          if (!isRecord(raw) || typeof raw.id !== "string") continue;
          mapped.push({
            id: raw.id,
            decidePath: `${raw.id}/decide`,
            assesseeId: typeof raw.assesseeId === "string" ? raw.assesseeId : "",
            amountLabel: formatMoney(typeof raw.amountMinor === "string" || typeof raw.amountMinor === "number" ? raw.amountMinor : null),
            reason: typeof raw.reason === "string" ? raw.reason : "—",
            statusLabel: humanizeStatus(typeof raw.status === "string" ? raw.status : "pending"),
          });
        }
        return mapped;
      },
    },
  );
}

export default async function WriteOffsPage({
  searchParams,
}: {
  searchParams?: { assesseeId?: string };
}) {
  const assesseeId = searchParams?.assesseeId?.trim() || "";

  const { data: assessees, source: assesseesSource } = await getAssessees();
  const { data: pending, source: pendingSource } = await getPendingWriteOffs();

  // GAP-REVENUE-WRITE-OFFS-01: once an assessee is chosen, load their DCB so the
  // write-off amount can be capped at the outstanding balance (like adjustments)
  // and the clerk sees the arrears before typing. Fail closed: if DCB can't load
  // the form stays uncapped-but-disabled server-side via dcbUnavailable.
  let outstandingMinor: string | null = null;
  let dcbUnavailable = false;
  let demands: DemandOption[] = [];
  const selected = assesseeId ? assessees.find((a) => a.id === assesseeId) ?? null : null;
  if (assesseeId) {
    const [dcbRes, demandsRes] = await Promise.all([getDcb(assesseeId), getDemands(assesseeId)]);
    if (dcbRes.source === "error" || !dcbRes.data) {
      dcbUnavailable = true;
    } else {
      outstandingMinor = dcbRes.data.balance;
    }
    demands = demandsRes.data;
  }

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Write-offs"
        subtitle="Write off irrecoverable arrears against an assessee, subject to checker approval."
        back="/revenue"
        actions={assesseesSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Select assessee" padding>
        <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="write-offs-assessee-select" style={{ fontSize: 13, fontWeight: 600 }}>
              Assessee
            </label>
            <select
              id="write-offs-assessee-select"
              name="assesseeId"
              defaultValue={assesseeId}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                minHeight: 44,
                minWidth: 280,
              }}
            >
              <option value="">Select an assessee…</option>
              {assessees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ownerName} — {a.identifierNo} ({a.assesseeType})
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" style={{ minHeight: 44 }}>
            View
          </Button>
        </form>
      </Card>

      {!assesseeId ? (
        <Card title="Write-offs">
          <EmptyState
            icon="🗑️"
            title="Choose an assessee"
            message="Select an assessee above to write off part of their outstanding arrears."
          />
        </Card>
      ) : (
        <WriteOffCreateForm
          assesseeId={assesseeId}
          assesseeName={selected?.ownerName ?? null}
          outstandingMinor={outstandingMinor}
          dcbUnavailable={dcbUnavailable}
          demands={demands}
        />
      )}

      <Card title="Pending write-offs" padding>
        {pendingSource === "error" ? (
          <RefreshErrorState
            error={toHumanError("load", { area: "pending write-offs" })}
            source={{ area: "pending write-offs" }}
          />
        ) : pending.length === 0 ? (
          <EmptyState
            icon="✅"
            title="No pending write-offs"
            message="Write-offs awaiting a checker's decision will appear here."
          />
        ) : (
          <DataTable<PendingWriteOffRow>
            columns={[
              { key: "amountLabel", label: "Amount" },
              { key: "reason", label: "Reason" },
              { key: "statusLabel", label: "Status", cellType: "status" },
            ]}
            rows={pending}
            rowLinkKey="decidePath"
            rowLinkPrefix="/revenue/write-offs/"
            sortable
            filterable
            filterPlaceholder="Filter by reason or amount…"
            pageSize={15}
          />
        )}
      </Card>

      <Card title="Open a write-off by reference" padding>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--ink2)" }}>
          Have a write-off reference from a submission confirmation? Open it directly to decide.
        </p>
        <WriteOffLookupForm />
      </Card>
    </div>
  );
}
