"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Resolves an eOffice officer UUID (an HRMS employeeId, as used by the
 * file `currentWith` / movement `toOfficer` values) into a readable label.
 *
 * Strategy: fetch the operator roster (employeeId → {division, deskRole}) once,
 * share it across every instance via a module-level cache, and resolve any id
 * the roster cannot name through ONE batched /estab/officers/resolve request.
 * An officer that still cannot be named reads "Unknown employee" -- never an id.
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

// GAP-ESTAB-FILES-DETAIL-04 (SF-17b batched lookup): names for the ids a screen
// actually renders are resolved by ONE batched GET /v1/estab/officers/resolve per
// tick (the service returns only {id, displayName, departmentName}), so an
// officer beyond the operator roster still gets a name. Only successful answers
// are remembered (hit or confirmed miss); a failed request is retried next mount.
const resolvedNames = new Map<string, string>();
const confirmedMisses = new Set<string>();
const wanted = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushWaiters: Array<() => void> = [];
const RESOLVE_CHUNK = 100;

async function flushResolve(): Promise<void> {
  flushTimer = null;
  const ids = [...wanted];
  wanted.clear();
  const waiters = flushWaiters;
  flushWaiters = [];
  try {
    for (let i = 0; i < ids.length; i += RESOLVE_CHUNK) {
      const chunk = ids.slice(i, i + RESOLVE_CHUNK);
      try {
        const res = await fetch(`/api/proxy/v1/estab/officers/resolve?ids=${chunk.map(encodeURIComponent).join(",")}`);
        if (!res.ok) continue;
        const body = (await res.json()) as { data?: Array<{ id: string; displayName: string }> };
        const hit = new Set<string>();
        for (const o of body.data ?? []) {
          if (o?.id && o.displayName) {
            resolvedNames.set(o.id, o.displayName);
            hit.add(o.id);
          }
        }
        for (const id of chunk) if (!hit.has(id)) confirmedMisses.add(id);
      } catch {
        /* degrade to "Unknown employee"; retried on the next mount */
      }
    }
  } finally {
    for (const w of waiters) w();
  }
}

/** Queue ids for the next batched resolve; resolves once that batch has been answered. */
export function requestOfficerNames(ids: readonly string[]): Promise<void> {
  const need = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id) && !resolvedNames.has(id) && !confirmedMisses.has(id));
  if (need.length === 0) return Promise.resolve();
  for (const id of need) wanted.add(id);
  return new Promise<void>((resolve) => {
    flushWaiters.push(resolve);
    if (!flushTimer) flushTimer = setTimeout(() => void flushResolve(), 0);
  });
}

/**
 * Test-only: reset the module-level officer-maps cache so a test can control
 * exactly which HRMS/operator payload resolveLabel sees. Not used in app code.
 */
export function __resetOfficerMapsCacheForTest(): void {
  cache = null;
  inflight = null;
  resolvedNames.clear();
  confirmedMisses.clear();
  wanted.clear();
  flushWaiters = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
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

/**
 * `unknownLabel` is the localised "Unknown employee" (SF-17b): an officer the
 * roster cannot name is never shown as an id or an id fragment.
 */
export function resolveLabel(id: string, maps: OfficerMaps | null, unknownLabel: string): string {
  const shortId = unknownLabel;
  if (!maps) return shortId;
  const name = maps.names.get(id) ?? resolvedNames.get(id);
  const op = maps.operators.get(id);
  const desk = op ? (ROLE_LABEL[op.deskRole] ?? op.deskRole) : undefined;
  if (name && desk) return `${name} · ${desk}`;
  if (name) return name;
  if (desk) return `${shortId} · ${desk}`;
  return shortId;
}

export function OfficerName({ id, prefix }: { id: string; prefix?: string }) {
  const tFallback = useTranslations("employeeFallback");
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

  // Batched lookup for an id the roster could not name (not an N+1: every
  // OfficerName on the screen queues into the same single request).
  const [, bump] = useState(0);
  useEffect(() => {
    if (!maps || maps.names.has(id)) return;
    let active = true;
    void requestOfficerNames([id]).then(() => {
      if (active) bump((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, [id, maps]);

  const label = resolveLabel(id, maps, tFallback("unknownEmployee"));
  return <>{prefix ?? ""}{label}</>;
}

/**
 * Renders an officer name the service has ALREADY resolved (note author, current
 * holder). An empty/absent name is "unresolved" and shows the localised fallback;
 * never looked up by id.
 */
export function ResolvedOfficerName({ name }: { name?: string | null }) {
  const tFallback = useTranslations("employeeFallback");
  return <>{name ? name : tFallback("unknownEmployee")}</>;
}
