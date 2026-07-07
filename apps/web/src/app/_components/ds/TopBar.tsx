"use client";
import type { ReactNode } from "react";
import { GlobalSearch } from "../GlobalSearch";
import { NotificationBell } from "../NotificationBell";
import { DarkModeToggle } from "../DarkModeToggle";
import { ConnectionStatus } from "../ConnectionStatus";
import { AccountMenu } from "../AccountMenu";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { VoiceNav } from "../VoiceNav";

interface TopBarProps {
  crumb?: ReactNode;
}

export function TopBar({ crumb }: TopBarProps) {
  return (
    <header className="tb">
      <nav className="crumb" aria-label="Breadcrumb">
        {crumb ?? <b>CivitasOne</b>}
      </nav>
      <div className="tb-search">
        <span style={{ fontSize: 14 }}>🔍</span>
        <input
          placeholder="Search… (Ctrl+K)"
          aria-label="Search"
          onFocus={(e) => {
            e.target.blur();
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
          }}
          readOnly
        />
      </div>
      <div className="tb-actions">
        <ConnectionStatus />
        <VoiceNav />
        <LanguageSwitcher />
        <DarkModeToggle />
        <button className="iconbtn" title="Analytics" type="button">📊</button>
        <NotificationBell />
        <AccountMenu />
      </div>
      <GlobalSearch />
    </header>
  );
}
