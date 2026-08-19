"use client";
import type { ReactNode } from "react";
import { GlobalSearch } from "../GlobalSearch";
import { NotificationBell } from "../NotificationBell";
import { ConnectionStatus } from "../ConnectionStatus";
import { AccountMenu } from "../AccountMenu";
import { MobileNavToggle } from "../MobileNavToggle";

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
      {/* C-01: semantic button replaces readOnly input trap */}
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
      {/* H-08/H-09: reduced from 8 controls to 3; DarkMode + Language moved to AccountMenu */}
      <div className="tb-actions">
        <ConnectionStatus />
        <NotificationBell />
        <AccountMenu name={userName} />
      </div>
      <GlobalSearch />
    </header>
  );
}
