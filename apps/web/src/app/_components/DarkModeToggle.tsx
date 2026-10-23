"use client";

import React, { useState, useEffect } from "react";

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
  const label = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";

  return (
    <button
      onClick={cycle}
      type="button"
      className="iconbtn"
      title={`Theme: ${label}`}
      style={{ position: "relative" }}
    >
      {icon}
    </button>
  );
}
