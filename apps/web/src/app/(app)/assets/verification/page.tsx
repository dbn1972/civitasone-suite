"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, PageHeader, DataTable, EmptyState, ErrorState, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

type Verification = { id: string; status: string; verificationDate?: string; location?: string };

export default function AssetVerificationPage() {
  const [rows, setRows] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/proxy/v1/asset/verifications?limit=50", { signal });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const body = await res.json() as { data?: Verification[] };
      setRows(body.data ?? []);
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load]);

  const create = useConfirmAction({
    onConfirm: async (reason) => {
      const res = await fetch("/api/proxy/v1/asset/verifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          verificationDate: new Date().toISOString().slice(0, 10),
          location: "HQ Block",
          notes: reason || "Annual physical verification",
        }),
      });
      if (!res.ok) {
        const human = toHumanError("save", { area: "verification session" });
        throw new Error(`${human.what} ${human.next}`);
      }
      setMessage("Verification session created.");
      await load();
    },
  });

  const tableRows = rows.map((r) => ({
    id: r.id,
    session: r.id.slice(0, 8),
    date: formatIndianDate(r.verificationDate),
    location: r.location ?? "—",
    status: r.status,
  }));

  return (
    <>
      <PageHeader
        title="Physical Verification"
        subtitle="Barcode-driven audit — GFR-aligned write-off before disposal."
        back="/assets/dashboard"
        backLabel="Dashboard"
        actions={<Button type="button" onClick={create.trigger}>+ New verification</Button>}
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "var(--panel)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        {loading ? (
          <EmptyState icon="⏳" title="Loading verification sessions…" />
        ) : loadError ? (
          <ErrorState error={toHumanError("load", { area: "verification sessions" })} onRetry={() => void load()} />
        ) : tableRows.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="No verification sessions"
            message="Start a physical verification to reconcile assets against the register."
            action={<Button type="button" onClick={create.trigger}>+ New verification</Button>}
          />
        ) : (
          <DataTable
            columns={[
              { key: "session", label: "Session" },
              { key: "date", label: "Date" },
              { key: "location", label: "Location" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={tableRows}
            sortable
          />
        )}
      </div>

      <ConfirmDialog
        open={create.open}
        title="Start a new verification session?"
        description="This opens a GFR physical-verification session for stock-take and reconciliation. Add a note describing the scope."
        confirmLabel="Create session"
        requireReason
        reasonLabel="Scope / notes"
        busy={create.busy}
        errorMessage={create.error}
        onConfirm={create.confirm}
        onCancel={create.cancel}
      />
    </>
  );
}
