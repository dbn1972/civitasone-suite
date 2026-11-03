"use client";
/**
 * UAT-P2-D3 (A11Y-08): the saved theme was applied only when DarkModeToggle
 * mounted inside the (closed) account menu, so every page load reverted to
 * light. Mounted once in the root layout, this applies the stored choice
 * (DarkModeToggle's "civitas-theme" key) as the app hydrates. A client effect
 * (not an inline <head> script) keeps the root layout free of a nonce /
 * headers() read, which would make Next stream <title> into <body>.
 * Storage errors are ignored; no stored value keeps the light default.
 */
import { useLayoutEffect } from "react";

export const THEME_STORAGE_KEY = "civitas-theme";

export function applyStoredTheme(): void {
  try {
    const t = window.localStorage.getItem(THEME_STORAGE_KEY);
    const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch {
    /* storage blocked: keep the light default */
  }
}

export function ThemeInit() {
  useLayoutEffect(() => {
    applyStoredTheme();
  }, []);
  return null;
}
