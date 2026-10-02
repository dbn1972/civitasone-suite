"use client";

import Link from "next/link";

/**
 * Asset cell link inside a row-linked DataTable: stops the click reaching the
 * row's own navigation (which would otherwise also open the policy).
 */
export function AssetLink({ assetId, label }: { assetId: string; label: string }) {
  return (
    <Link className="lnk" href={`/assets/${encodeURIComponent(assetId)}`} onClick={(e) => e.stopPropagation()}>
      {label}
    </Link>
  );
}
