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

type Operator = { employeeId: string; division: string; deskRole: string };
type Employee = { id: string; name?: string; employeeId?: string; designation?: string };

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

async function loadMaps(): Promise<OfficerMaps> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const operators = new Map<string, Operator>();
    const names = new Map<string, string>();

    // Operator roster — the valid markable desks.
    try {
      const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=false&limit=500");
      if (res.ok) {
        const body = (await res.json()) as { data?: Operator[] } | Operator[];
        const list = Array.isArray(body) ? body : (body.data ?? []);
        for (const o of list) {
          if (o?.employeeId) operators.set(o.employeeId, o);
        }
      }
    } catch {
      /* degrade to short id */
    }

    // HRMS directory — name resolution (optional).
    try {
      const res = await fetch("/api/proxy/v1/hrms/employees?limit=200");
      if (res.ok) {
        const body = (await res.json()) as { data?: Employee[] } | Employee[];
        const list = Array.isArray(body) ? body : (body.data ?? []);
        for (const e of list) {
          if (e?.id && e.name) names.set(e.id, e.name);
        }
      }
    } catch {
      /* degrade to short id */
    }

    cache = { operators, names };
    inflight = null;
    return cache;
  })();

  return inflight;
}

function resolveLabel(id: string, maps: OfficerMaps | null): string {
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
