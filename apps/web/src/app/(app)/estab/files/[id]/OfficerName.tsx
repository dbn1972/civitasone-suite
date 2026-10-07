"use client";

import { useEffect, useState } from "react";

/**
 * Resolves an eOffice officer UUID (an HRMS employeeId, as used by the
 * file `currentWith` / movement `toOfficer` values) into a readable label.
 *
 * Strategy: fetch the operator roster (employeeId → {division, deskRole}) and
 * the HRMS employee directory (id → name) once, share them across every
 * instance via a module-level cache, and degrade gracefully to the short id
 * when a name/desk cannot be resolved (e.g. greenfield tenants, missing maps).
 */

type Operator = { employeeId: string; division: string; deskRole: string; employeeName?: string };

const ROLE_LABEL: Record<string, string> = {
  dealing_hand: "Dealing Hand",
  section_officer: "Section Officer",
  under_secretary: "Under Secretary",
  deputy_secretary: "Deputy Secretary",
  director: "Director",
  hod: "Head of Department",
};

export type OfficerMaps = {
  /** employeeId → operator desk metadata */
  operators: Map<string, Operator>;
  /** employee UUID → display name */
  names: Map<string, string>;
};

let cache: OfficerMaps | null = null;
let inflight: Promise<OfficerMaps> | null = null;

/**
 * Test-only: reset the module-level officer-maps cache so a test can control
 * exactly which HRMS/operator payload resolveLabel sees. Not used in app code.
 */
export function __resetOfficerMapsCacheForTest(): void {
  cache = null;
  inflight = null;
}

export async function loadMaps(): Promise<OfficerMaps> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const operators = new Map<string, Operator>();
    const names = new Map<string, string>();
    let anySuccess = false;

    // GAP-ESTAB-FILES-DETAIL-04 (DPDP data minimisation): resolve officer names
    // from the OPERATOR ROSTER, which already carries a server-side-resolved
    // `employeeName` for each enrolled operator (estab-service resolves it via
    // the internal hrms employee-summaries endpoint and returns only
    // name/department — never full HR PII). We no longer pull the whole
    // `/hrms/employees?limit=200` directory into every viewer's browser.
    try {
      const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=false&limit=500");
      if (res.ok) {
        const body = (await res.json()) as { data?: Operator[] } | Operator[];
        const list = Array.isArray(body) ? body : (body.data ?? []);
        for (const o of list) {
          if (o?.employeeId) {
            operators.set(o.employeeId, o);
            if (o.employeeName) names.set(o.employeeId, o.employeeName);
          }
        }
        anySuccess = true;
      }
    } catch {
      /* degrade to short id */
    }

    const maps: OfficerMaps = { operators, names };
    // GAP-ESTAB-FILES-DETAIL-04: only cache on SUCCESS, so a first-load failure
    // (empty maps) doesn't become permanent until a page reload — the next
    // mount retries.
    if (anySuccess) {
      cache = maps;
    }
    inflight = null;
    return maps;
  })();

  return inflight;
}

export function resolveLabel(id: string, maps: OfficerMaps | null): string {
  const shortId = `Officer ${id.slice(0, 8)}`;
  if (!maps) return shortId;
  const name = maps.names.get(id);
  const op = maps.operators.get(id);
  const desk = op ? (ROLE_LABEL[op.deskRole] ?? op.deskRole) : undefined;
  if (name && desk) return `${name} · ${desk}`;
  if (name) return name;
  if (desk) return `${shortId} · ${desk}`;
  return shortId;
}

export function OfficerName({ id, prefix }: { id: string; prefix?: string }) {
  const [maps, setMaps] = useState<OfficerMaps | null>(cache);

  useEffect(() => {
    if (cache) {
      setMaps(cache);
      return;
    }
    let active = true;
    void loadMaps().then((m) => {
      if (active) setMaps(m);
    });
    return () => {
      active = false;
    };
  }, []);

  const label = resolveLabel(id, maps);
  return <>{prefix ?? ""}{label}</>;
}
