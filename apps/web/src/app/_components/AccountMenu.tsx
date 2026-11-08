"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Avatar } from "./ds/Avatar";
import { useMenuKeyboard } from "./ds/useMenuKeyboard";
import { DarkModeToggle } from "./DarkModeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { performLogout } from "@/lib/sync/logout";
import { useShellT } from "./useShellT";
import { ASK_OPEN_EVENT } from "./AskCivitasOne";

/** Account avatar with preferences (dark mode, language) and sign-out. */
export function AccountMenu({ name = "User" }: { name?: string }) {
  const t = useShellT("appNav");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  // UAT-P2-D3 (A11Y-09): Escape / arrow keys / focus in and back / click outside.
  useMenuKeyboard(open, close, triggerRef, menuRef);

  async function onSignOut() {
    setBusy(true);
    await performLogout();
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("topbar.accountMenu", "Account menu")}
        className="tb-account"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <Avatar name={name} color="#4f46e5" size="sm" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t("topbar.accountMenu", "Account menu")}
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            minWidth: 220,
            maxWidth: "calc(100vw - 24px)",
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
          <div style={{ padding: "4px 10px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--mut, #667085)", marginTop: 2 }}>
            {t("topbar.preferences", "Preferences")}
          </div>

          {/* Dark mode toggle row */}
          <div
            role="group"
            aria-labelledby={`${menuId}-appearance`}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, fontSize: 13 }}
          >
            <span id={`${menuId}-appearance`}>{t("topbar.appearance", "Appearance")}</span>
            <DarkModeToggle />
          </div>

          {/* Language switcher row */}
          <div
            role="group"
            aria-labelledby={`${menuId}-language`}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, fontSize: 13, marginBottom: 4 }}
          >
            <span id={`${menuId}-language`}>{t("topbar.language", "Language")}</span>
            <LanguageSwitcher />
          </div>

          <div style={{ borderTop: "1px solid var(--line, #eee)", marginTop: 4, paddingTop: 4 }}>
            {/* Phones (< 480 px): the header Ask button is hidden to make room for the language toggle. */}
            <button
              type="button"
              role="menuitem"
              className="am-ask"
              onClick={() => {
                close();
                window.dispatchEvent(new CustomEvent(ASK_OPEN_EVENT));
              }}
              style={{ width: "100%", textAlign: "start", padding: "8px 10px", fontSize: 13, borderRadius: 6, border: "none", background: "none", cursor: "pointer", color: "inherit" }}
            >
              {t("topbar.askMenu", "Ask CivitasOne")}
            </button>
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
              {busy ? t("topbar.signingOut", "Signing out…") : t("topbar.signOut", "Sign out")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
