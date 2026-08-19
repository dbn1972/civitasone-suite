"use client";

import { useState } from "react";
import { Avatar } from "./ds/Avatar";
import { DarkModeToggle } from "./DarkModeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { performLogout } from "@/lib/sync/logout";

/** Account avatar with preferences (dark mode, language) and sign-out. */
export function AccountMenu({ name = "User" }: { name?: string }) {
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
            minWidth: 220,
            background: "var(--panel, #fff)",
            border: "1px solid var(--line, rgba(0,0,0,0.1))",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: 6,
            zIndex: 50,
          }}
        >
          {/* User name header */}
          <div style={{ padding: "6px 10px 10px", fontSize: 13, fontWeight: 650, borderBottom: "1px solid var(--line, #eee)", marginBottom: 4 }}>
            {name}
          </div>

          {/* Preferences section */}
          <div style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--mut, #667085)", marginTop: 2 }}>
            Preferences
          </div>

          {/* Dark mode toggle row */}
          <div
            role="menuitem"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, fontSize: 13 }}
          >
            <span>Appearance</span>
            <DarkModeToggle />
          </div>

          {/* Language switcher row */}
          <div
            role="menuitem"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, fontSize: 13, marginBottom: 4 }}
          >
            <span>Language</span>
            <LanguageSwitcher />
          </div>

          <div style={{ borderTop: "1px solid var(--line, #eee)", marginTop: 4, paddingTop: 4 }}>
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
        </div>
      ) : null}
    </div>
  );
}
