"use client";
import type { ReactNode } from "react";
import { GlobalSearch } from "../GlobalSearch";
import { NotificationBell } from "../NotificationBell";
import { DarkModeToggle } from "../DarkModeToggle";
import { ConnectionStatus } from "../ConnectionStatus";
import { AccountMenu } from "../AccountMenu";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { VoiceNav } from "../VoiceNav";
import { MobileNavToggle } from "../MobileNavToggle";
import { LanguageToggle } from "../LanguageToggle";

interface TopBarProps {
  crumb?: ReactNode;
  userName?: string;
}

function openSearch() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
}

export function TopBar({ crumb, userName }: TopBarProps) {
  return (
    <header className="tb">
      <MobileNavToggle />
      <nav className="crumb" aria-label="Breadcrumb">
        {crumb ?? <b>CivitasOne</b>}
      </nav>
      {/* C-01 fix: replace readOnly input trap with a proper button */}
      <button
        className="tb-search"
        type="button"
        aria-label="Open search"
        aria-keyshortcuts="Control+K"
        onClick={openSearch}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <span>Search…</span>
        <kbd aria-hidden="true">Ctrl+K</kbd>
      </button>
      <div className="tb-actions">
        <ConnectionStatus />
        <VoiceNav />
        <LanguageToggle />
        <LanguageSwitcher />
        <DarkModeToggle />
        {/* C-02 fix: replace emoji + title-only with aria-label + SVG icon */}
        <button
          className="iconbtn"
          type="button"
          aria-label="Analytics overview"
          onClick={openSearch}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6"  y1="20" x2="6"  y2="14"/>
          </svg>
        </button>
        <NotificationBell />
        <AccountMenu name={userName} />
      </div>
      <GlobalSearch />
    </header>
  );
}
