"use client";

import { useMemo, useState } from "react";
import { Button, PageHeader, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { isImportable, parseAssetCsv } from "./parseAssetCsv";

const CSV_FORMAT = "name,code,assetType,cost,orgUnit";
const CSV_EXAMPLE = `${CSV_FORMAT}\n"Chair, executive",FUR/001,movable,"12,500",HQ`;

export default function BulkImportPage() {
  // GAP-ASSETS-BULK-IMPORT-01: start empty -- a pre-filled sample row could be
  // imported into the live register with two clicks. The format is shown as
  // the placeholder instead.
  const [csv, setCsv] = useState("");
  const [message, setMessage] = useState("");

  const parsed = useMemo(() => parseAssetCsv(csv), [csv]);
  const { rows, errors } = parsed;
  const count = rows.length;
  const canImport = isImportable(parsed);
  const totalMinor = useMemo(() => rows.reduce((sum, r) => sum + BigInt(r.acquisitionCostMinor), 0n), [rows]);

  const run = useConfirmAction({
    onConfirm: async () => {
      setMessage("");
      const res = await fetch("/api/proxy/v1/asset/bulk/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assets: rows }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage(`Bulk import accepted — ${rows.length} ${rows.length === 1 ? "asset" : "assets"} queued.`);
      setCsv("");
    },
  });

  return (
    <>
      <PageHeader
        title="Bulk Import"
        subtitle={`Mass asset load — CSV format: ${CSV_FORMAT} (cost in rupees)`}
        back="/assets"
        backLabel="Assets"
      />
      <div className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canImport) return;
            run.trigger();
          }}
          className="pad"
        >
          <label htmlFor="bulk-csv" className="l">CSV data</label>
          <textarea
            id="bulk-csv"
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setMessage(""); }}
            rows={12}
            placeholder={CSV_EXAMPLE}
            aria-describedby="bulk-csv-help"
            aria-invalid={errors.length > 0 || undefined}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 12, borderRadius: 8, border: "1px solid var(--line)", marginTop: 6 }}
          />
          <p id="bulk-csv-help" style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
            A header row starting with &quot;name&quot; is optional. Wrap values containing commas in double quotes.
          </p>
          {errors.length > 0 ? (
            <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "var(--bad)" }}>
              <b>Fix these rows before importing:</b>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {errors.map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}
              </ul>
            </div>
          ) : null}
          <Button type="submit" disabled={!canImport} style={{ marginTop: 12 }}>
            Import {count} {count === 1 ? "asset" : "assets"}
          </Button>
          {message ? (
            <p role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 13, color: "var(--good)" }}>{message}</p>
          ) : null}
        </form>
      </div>

      <ConfirmDialog
        open={run.open}
        title="Import these assets?"
        description={<>This will create <b>{count}</b> asset {count === 1 ? "record" : "records"} with a total acquisition cost of <b>{formatMoney(totalMinor)}</b> in the live asset register. Verify the CSV before proceeding.</>}
        confirmLabel={`Import ${count} ${count === 1 ? "asset" : "assets"}`}
        busy={run.busy}
        errorMessage={run.error}
        onConfirm={run.confirm}
        onCancel={run.cancel}
      />
    </>
  );
}
