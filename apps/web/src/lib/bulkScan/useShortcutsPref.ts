"use client";

import { useCallback, useEffect, useState } from "react";
import { readShortcutsPref, shortcutsPrefKey, writeShortcutsPref } from "./review";

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** "Keyboard shortcuts on/off", remembered per user. Starts on (and renders correctly without storage), then applies the saved choice after mount. */
export function useShortcutsPref(userId: string | null): [boolean, (on: boolean) => void] {
  const key = shortcutsPrefKey(userId);
  const [on, setOn] = useState(true);
  useEffect(() => { setOn(readShortcutsPref(browserStorage(), key)); }, [key]);
  const set = useCallback((v: boolean): void => { setOn(v); writeShortcutsPref(browserStorage(), key, v); }, [key]);
  return [on, set];
}
