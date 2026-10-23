"use client";

import { useEffect, useState } from "react";

/**
 * Departments/divisions a file can be opened in: the distinct `division` values of
 * the enrolled eOffice operators (estab-service /operators). One source for every
 * estab screen that picks a department (new file, DAK open-file), so a typo can
 * never mint a new department (GAP-ESTAB-FILES-NEW-03).
 */
export type EstabDivisions = {
  loaded: boolean;
  failed: boolean;
  /** The list was refused (403): this role cannot read the operator directory, so there is no pick-list for it. */
  forbidden: boolean;
  divisions: string[];
};

export function useEstabDivisions(): EstabDivisions {
  const [state, setState] = useState<EstabDivisions>({ loaded: false, failed: false, forbidden: false, divisions: [] });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=true&limit=500", { signal: controller.signal });
        if (!res.ok) {
          setState({ loaded: true, failed: true, forbidden: res.status === 403, divisions: [] });
          return;
        }
        const body = (await res.json()) as { data?: Array<{ division?: string }> } | Array<{ division?: string }>;
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        const divisions = [...new Set(rows.map((o) => o.division).filter((d): d is string => typeof d === "string" && d.length > 0))].sort();
        setState({ loaded: true, failed: false, forbidden: false, divisions });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setState({ loaded: true, failed: true, forbidden: false, divisions: [] });
      }
    })();
    return () => controller.abort();
  }, []);
  return state;
}
