"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard button for kiosk / shared PCs with no configured mail client
 * (GAP-CONTACT-HOME-01 step 3). Degrades silently where the Clipboard API is absent.
 */
export function CopyAddressButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard blocked (permissions / insecure context) — leave state unchanged;
      // the address is still visible next to this button.
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label ?? `Copy ${value}`}
      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
