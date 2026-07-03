"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "civitasone.recent.";
const MAX_RECENT = 10;

function getStorageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function readRecent(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getStorageKey(key));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecent(key: string, values: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(key), JSON.stringify(values));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/**
 * Appends a value to the recent-values list for a given key.
 * Deduplicates and caps at max (default 10).
 */
export function saveRecentValue(key: string, value: string, max: number = MAX_RECENT): void {
  const current = readRecent(key);
  const deduped = current.filter((v) => v !== value);
  const updated = [value, ...deduped].slice(0, max);
  writeRecent(key, updated);
}

/**
 * Returns recent values filtered by a fuzzy query string.
 * Matches if any word in the query appears in the value (case-insensitive).
 */
export function suggestFromRecent(key: string, query: string): string[] {
  const values = readRecent(key);
  if (!query.trim()) return values;
  const lower = query.toLowerCase();
  return values.filter((v) => v.toLowerCase().includes(lower));
}

/**
 * React hook that provides recent values for a given key,
 * re-reads from localStorage on mount and after saves.
 */
export function useRecentValues(key: string, max: number = MAX_RECENT) {
  const [values, setValues] = useState<string[]>([]);

  useEffect(() => {
    setValues(readRecent(key));
  }, [key]);

  const save = useCallback(
    (value: string) => {
      saveRecentValue(key, value, max);
      setValues(readRecent(key));
    },
    [key, max],
  );

  const suggest = useCallback(
    (query: string) => suggestFromRecent(key, query),
    [key],
  );

  return { values, save, suggest };
}

/**
 * Returns the most-recently-used value for a field (first item in recents).
 */
export function useSmartDefault(key: string): string | undefined {
  const [value, setValue] = useState<string | undefined>(undefined);

  useEffect(() => {
    const recents = readRecent(key);
    setValue(recents[0]);
  }, [key]);

  return value;
}
