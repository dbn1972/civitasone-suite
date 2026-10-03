"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageHeader, DataTable, EmptyState, ErrorState, SkeletonTable } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { summariseItems, type VerificationItem } from "../sessions";

/**
 * GAP-ASSETS-VERIFICATION-02: read-only session detail -- the assets recorded
 * against one physical-verification session (GET .../verifications/:id/items).
 */
export default function VerificationSessionPage() {
  const id = String(useParams<{ id: string }>().id ?? "");
  const [items, setItems] = useState<VerificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/proxy/v1/asset/verifications/${encodeURIComponent(id)}/items`, { signal });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const body = await res.json() as { data?: VerificationItem[] };
      setItems(body.data ?? []);
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const summary = summariseItems(items);
  const rows = items.map((i) => ({
    id: i.id,
    assetId: i.assetId,
    condition: i.condition,
    found: i.foundAtLocation === false ? "Not found" : "Found",
    remarks: i.remarks ?? "—",
  }));

  return (
    <>
      <PageHeader
        title={`Verification session ${id.slice(0, 8)}`}
        subtitle={loading || loadError ? "Assets recorded against this physical-verification session." : `${summary.total} recorded · ${summary.found} found · ${summary.missing} not found`}
        back="/assets/verification"
        backLabel="Verification sessions"
      />
      <div className="card">
        {loading ? (
          <SkeletonTable rows={5} />
        ) : loadError ? (
          <ErrorState error={toHumanError("load", { area: "verification session" })} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <EmptyState icon="🔍" title="No assets recorded yet" message="No asset has been recorded against this session." />
        ) : (
          <DataTable
            columns={[
              { key: "assetId", label: "Asset", render: (r) => <Link href={`/assets/${String(r.assetId)}`} title={String(r.assetId)}>{String(r.assetId).slice(0, 8)}</Link> },
              { key: "condition", label: "Condition", cellType: "status" },
              { key: "found", label: "At location" },
              { key: "remarks", label: "Remarks" },
            ]}
            rows={rows}
            pageSize={25}
            sortable
          />
        )}
      </div>
    </>
  );
}
