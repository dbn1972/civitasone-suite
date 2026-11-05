"use client";
import type { ReactNode } from "react";
import { GlobalSearch } from "../GlobalSearch";
import { NotificationBell } from "../NotificationBell";
import { ConnectionStatus } from "../ConnectionStatus";
import { AccountMenu } from "../AccountMenu";
import { MobileNavToggle } from "../MobileNavToggle";
import { AskCivitasOneTrigger } from "../AskCivitasOne";
import { useShellT } from "../useShellT";

interface TopBarProps {
  crumb?: ReactNode;
  userName?: string;
  /** UAT-P2-D3 (A11Y-20, GIGW bilingual): a visible language toggle in the header. Optional; omitted = unchanged. */
  languageToggle?: ReactNode;
  /** Passed to the search page index so it only offers pages the user can open. */
  roles?: string[] | null;
  enabledModules?: string[] | null;
}

function openSearch() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
}

/**
 * UAT-P3 (DS-1): the bar used to be 13-56 px wider than a 360/390 px phone
 * (fixed 26 px padding, a breadcrumb that could not shrink, search hidden,
 * हिन्दी + avatar pushed off-screen), so the whole page panned sideways. Below
 * 768 px the crumb shrinks to the current page (ellipsis), search becomes an
 * icon button, and below 480 px the language toggle folds into the Account
 * menu (which already holds the full language list). The floating "Ask"
 * button (DS-3/DS-10) now lives here instead of over the content.
 * Layout rules: civitas-ds.css "UAT-P3 DS-1"; guarded by topBarFit.test.ts.
 */
export function TopBar({ crumb, userName, languageToggle, roles, enabledModules }: TopBarProps) {
  const t = useShellT("appNav");
  return (
    <header className="tb">
      <MobileNavToggle />
      <nav className="crumb" aria-label={t("topbar.breadcrumb", "Breadcrumb")}>
        {crumb ?? <b>CivitasOne</b>}
      </nav>
      {/* C-01: semantic button replaces readOnly input trap */}
      <button
        className="tb-search"
        type="button"
        aria-label={t("topbar.openSearch", "Open search")}
        aria-keyshortcuts="Control+K"
        onClick={openSearch}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <span className="tb-search-label">{t("topbar.search", "Search…")}</span>
        <kbd aria-hidden="true">Ctrl+K</kbd>
      </button>
      <div className="tb-actions">
        {languageToggle ? <span className="tb-lang-slot">{languageToggle}</span> : null}
        <ConnectionStatus />
        <AskCivitasOneTrigger />
        <NotificationBell />
        <AccountMenu name={userName} />
      </div>
      <GlobalSearch roles={roles} enabledModules={enabledModules} />
    </header>
  );
}
