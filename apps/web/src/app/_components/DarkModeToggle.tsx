"use client";

import React, { useState, useEffect } from "react";

type Theme = "light" | "dark" | "system";

export function DarkModeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = localStorage.getItem("civitas-theme") as Theme | null;
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
    localStorage.setItem("civitas-theme", next);
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
