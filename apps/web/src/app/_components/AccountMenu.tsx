"use client";

import { useState } from "react";
import { Avatar } from "./ds/Avatar";
import { performLogout } from "@/lib/sync/logout";

/** Account avatar with a sign-out that wipes the local encrypted cache (08-T4). */
export function AccountMenu({ name = "D Nayak" }: { name?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSignOut() {
    setBusy(true);
    await performLogout();
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <Avatar name={name} color="#4f46e5" size="sm" />
      </button>
      {open ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            minWidth: 180,
            background: "var(--surface, #fff)",
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: 6,
            zIndex: 50,
          }}
        >
          <div style={{ padding: "6px 10px", fontSize: 13, fontWeight: 600 }}>{name}</div>
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            disabled={busy}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              fontSize: 13,
              borderRadius: 6,
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "#dc2626",
            }}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
