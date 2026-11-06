"use client";

import React, { useState, useEffect } from "react";
import { useShellT } from "./useShellT";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "civitas-theme";

// Storage can throw (SecurityError with site data blocked) or hold a junk value;
// neither may unmount the tree, so React state alone drives the in-session theme.
function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : null;
  } catch {
    return null;
  }
}

function writeStored(v: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* storage blocked: keep the in-session theme only */
  }
}

export function DarkModeToggle() {
  const t = useShellT("appNav");
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = readStored();
    if (stored) {
      setTheme(stored);
      applyTheme(stored);
    }
  }, []);

  const applyTheme = (t: Theme) => {
    const root = document.documentElement;
    if (t === "dark") {
      root.classList.add("dark");
    } else if (t === "light") {
      root.classList.remove("dark");
    } else {
      // system
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
  };

  const cycle = () => {
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    applyTheme(next);
    writeStored(next);
  };

  const icon = theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "💻";
  const themeName = (v: string) =>
    v === "dark" ? t("topbar.themeDark", "Dark") : v === "light" ? t("topbar.themeLight", "Light") : t("topbar.themeSystem", "System");
  const label = themeName(theme);
  const nextLabel = themeName(theme === "dark" ? "system" : theme === "light" ? "dark" : "light");

  return (
    <button
      onClick={cycle}
      type="button"
      className="iconbtn"
      title={t("topbar.themeTitle", "Theme: {current}", { current: label })}
      // UAT-P2-D3 (A11Y-11): the name was the emoji ("sun"); say the state and the action.
      aria-label={t("topbar.themeLabel", "Theme: {current}. Switch to {next}", { current: label, next: nextLabel })}
      style={{ position: "relative" }}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
