"use client";

import { useState } from "react";
import { PageHeader, ConfirmDialog, useConfirmAction } from "../../../_components/ds";

export default function BulkImportPage() {
  const [csv, setCsv] = useState("name,code,assetType,cost,orgUnit\nSample Laptop,LAP/001,it,45000,HQ");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const parsedCount = csv
    .trim()
    .split("\n")
    .slice(1)
    .filter(Boolean).length;

  const run = useConfirmAction({
    onConfirm: async () => {
      setMessage("");
      setIsError(false);
      const lines = csv.trim().split("\n").slice(1);
      const assets = lines.filter(Boolean).map((line) => {
        const [name, code, assetType, cost, orgUnit] = line.split(",").map((s) => s.trim());
        return {
          name,
          code,
          assetType: assetType || "fixed",
          acquisitionCostMinor: Math.round(Number(cost || "0") * 100),
          orgUnit: orgUnit || undefined,
        };
      });
      const res = await fetch("/api/proxy/v1/asset/bulk/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assets }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage(`Bulk import accepted — ${assets.length} assets queued.`);
    },
  });

  return (
    <>
      <PageHeader
        title="Bulk Import"
        subtitle="Mass asset load — CSV format: name,code,assetType,cost,orgUnit"
        back="/assets"
        backLabel="Assets"
      />
      <div className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run.trigger();
          }}
          className="pad"
        >
          <label htmlFor="bulk-csv" className="l">CSV data</label>
          <textarea
            id="bulk-csv"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={12}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 12, borderRadius: 8, border: "1px solid var(--line)", marginTop: 6 }}
          />
          <button type="submit" className="btn primary" disabled={parsedCount === 0} style={{ marginTop: 12 }}>
            Import {parsedCount} {parsedCount === 1 ? "asset" : "assets"}
          </button>
          {message ? (
            <p role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 13, color: isError ? "var(--bad)" : "var(--good)" }}>{message}</p>
          ) : null}
        </form>
      </div>

      <ConfirmDialog
        open={run.open}
        title="Import these assets?"
        description={<>This will create <b>{parsedCount}</b> asset {parsedCount === 1 ? "record" : "records"} in the live fixed-asset register. Verify the CSV before proceeding.</>}
        confirmLabel={`Import ${parsedCount} assets`}
        busy={run.busy}
        errorMessage={run.error}
        onConfirm={run.confirm}
        onCancel={run.cancel}
      />
    </>
  );
}
