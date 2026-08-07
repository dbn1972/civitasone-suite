"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_STACK = 50;

export function useUndoRedo<T>(initial: T) {
  const [present, setPresent] = useState(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);

  const push = useCallback((next: T) => {
    past.current = [...past.current.slice(-(MAX_STACK - 1)), present];
    future.current = [];
    setPresent(next);
  }, [present]);

  const replace = useCallback((next: T) => {
    setPresent(next);
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.at(-1);
    if (!prev) return false;
    past.current = past.current.slice(0, -1);
    future.current = [present, ...future.current];
    setPresent(prev);
    return true;
  }, [present]);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return false;
    future.current = future.current.slice(1);
    past.current = [...past.current, present];
    setPresent(next);
    return true;
  }, [present]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return { state: present, push, replace, undo, redo };
}
