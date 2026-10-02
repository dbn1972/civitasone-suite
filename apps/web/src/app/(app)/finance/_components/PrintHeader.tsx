"use client";

/**
 * Print-only header for finance statements/ledger pages
 * (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-05). Hidden on screen; in the
 * browser print / save-as-PDF output it names the document, its period scope
 * and when it was generated, so a printout is never mistaken for an official
 * server-issued statement. The sidebar/topbar are already hidden in
 * @media print (civitas-ds.css).
 */
import { useEffect, useState } from "react";
import { formatIndianDateTime } from "@/lib/formatters";

export function PrintHeader({ title, scope }: { title: string; scope: string }) {
  const [generated, setGenerated] = useState("");
  useEffect(() => {
    setGenerated(formatIndianDateTime(new Date()));
  }, []);
  return (
    <div className="fin-print-header" data-testid="fin-print-header">
      <h1>{title}</h1>
      <p>
        {scope}
        {generated ? ` · Generated ${generated} IST` : ""} · Computer-generated print of the on-screen view; not an
        official signed statement.
      </p>
    </div>
  );
}
