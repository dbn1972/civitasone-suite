import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hrAreaSwitchForHref,
  isModuleEnabled,
  moduleSwitches,
  HR_SWITCH,
  PAYROLL_SWITCH,
  RECRUITMENT_SWITCH,
  SWITCH_ENABLERS,
  PLATFORM_MODULE_KEYS,
} from "./moduleMatch";
import { NAV_GROUPS, visibleNavGroups } from "./nav/navModel";
import { PAGE_INDEX } from "./nav/pageIndex";

/**
 * M2 / M7 -- separate HR, Payroll and Recruitment switches, exact key matching.
 *
 * FROZEN REFERENCE: `legacyIsModuleEnabled` is a verbatim copy of the matcher as it
 * was on main (d5af3966d) BEFORE this change (lenient `includes` both ways). It is
 * never edited: it is the "what existing tenants see today" oracle for the parity
 * tests below.
 */
function legacyIsModuleEnabled(
  enabled: string[] | null,
  moduleKey: string | null,
  roles?: readonly string[],
  opts: { platformAlwaysOn?: boolean } = {},
): boolean {
  if (moduleKey === null) return true;
  if (roles?.includes("super_admin") || roles?.includes("platform_admin")) return true;
  const key = moduleKey.toLowerCase();
  if (opts.platformAlwaysOn !== false && PLATFORM_MODULE_KEYS.has(key)) return true;
  if (!enabled) return true;
  const RECOMMENDATION_ALIASES = new Set(["recommendation", "recommendations"]);
  if (RECOMMENDATION_ALIASES.has(key)) {
    if (enabled.some((name) => RECOMMENDATION_ALIASES.has(name))) return true;
  }
  const MODULE_ALIASES: Record<string, string[]> = {
    journey: ["journeys"],
    journeys: ["journey"],
    revenue: ["finance"],
  };
  const aliases = MODULE_ALIASES[key] ?? [];
  if (enabled.some((name) => name === key || aliases.includes(name))) return true;
  return enabled.some((name) => name === key || name.includes(key) || key.includes(name));
}

/** Every moduleKey the web app gates on (ModuleGate layouts, nav, help, setup, tiles). */
const WEB_KEYS = [
  "admin", "advertisement", "ai-agent", "analytics", "animal", "assets", "audit", "billing", "building",
  "catalogue", "cdp", "citizen", "contracts", "court", "crematorium", "crm", "designer", "documents",
  "drainage", "establishment", "estab", "event", "field", "finance", "fire", "grants", "helpdesk", "hr", "hrms",
  "identity", "inspection", "inventory", "journey", "knowledge", "legal", "locations", "loyalty", "market",
  "meeting", "metadata", "notification", "parking", "parks", "procurement", "projects", "recommendation",
  "refund", "reports", "revenue", "roadcut", "sewerage", "shop", "stock", "swm", "telephony", "tenant",
  "themes", "trade", "vendor", "visitor", "workflow", "works",
];

/** Gateway module values of a legacy tenant (services/gateway-service/src/module-guard.ts ROUTE_TO_MODULE). */
const LEGACY_VOCAB = [
  "finance", "procurement", "hrms", "payroll", "projects", "assets", "stock", "grants", "citizen", "legal", "crm",
  "helpdesk", "telephony", "knowledge", "documents", "workflow", "analytics", "meeting", "court", "visitor",
  "inspection", "billing", "inventory", "reports", "establishment", "contracts", "shop", "trade", "building",
  "fire", "advertisement", "vendor", "roadcut", "event", "refund", "sewerage", "swm", "drainage", "parks",
  "animal", "crematorium", "parking", "market", "field", "smarttransfer",
];

/** Composition projection (admin-service gateway-map.ts) of a fully licensed tenant: HR cluster + payroll. */
const COMPOSITION_HR_KEYS = [
  "workforce_core", "establishment", "hrms-payroll", "hrms-training", "hrms-social", "hrms-disciplinary",
  "hrms-deputation", "hrms-contracts", "hrms-assessment", "hrms-id-cards", "hrms-ai", "hrms-rti",
  "hrms-workforce-planning", "hrms-board-intake", "hrms-competency", "hrms-attendance", "hrms-leave",
  "hrms-recruitment", "hrms-appraisal", "hrms-self-service", "payroll",
];
const FULL_COMPOSITION = [...LEGACY_VOCAB.filter((k) => k !== "hrms" && k !== "payroll"), ...COMPOSITION_HR_KEYS];

/** Old nav/tile screens of the HR area all asked for "hrms"; the new switch each now asks for. */
const SWITCH_FAMILY = new Set([HR_SWITCH, PAYROLL_SWITCH, RECRUITMENT_SWITCH]);
const oldKeyFor = (key: string | null) => (key !== null && SWITCH_FAMILY.has(key) ? "hrms" : key);

const ROLE_SETS: Array<readonly string[] | undefined> = [undefined, ["employee"], ["hr_admin"], ["super_admin"]];

describe("switch table (one documented table, exact entries)", () => {
  it("HR on via the hrms-* HR sub-keys, never via hrms-recruitment / hrms-payroll / payroll", () => {
    for (const k of ["hrms-leave", "hrms-attendance", "hrms-appraisal", "hrms-self-service", "hrms-training"]) {
      expect(isModuleEnabled([k], HR_SWITCH), k).toBe(true);
    }
    for (const k of ["hrms-recruitment", "hrms-payroll", "payroll"]) {
      expect(isModuleEnabled([k], HR_SWITCH), k).toBe(false);
    }
  });

  it("Workforce Core alone (SmartTransfer standalone SKU) does not open the HR area (ST-M01-04b, unchanged)", () => {
    expect(moduleSwitches(["workforce_core", "smarttransfer", "workflow"])).toEqual({ hr: false, payroll: false, recruitment: false });
  });

  it("Payroll is on ONLY via payroll (plus the legacy blanket); hrms-payroll is not the Payroll switch", () => {
    expect(isModuleEnabled(["payroll"], PAYROLL_SWITCH)).toBe(true);
    expect(isModuleEnabled(["hrms-payroll"], PAYROLL_SWITCH)).toBe(false);
    // employee composition projects hrms-payroll + every HR sub-key but NOT payroll
    const employeeNoPayroll = ["workforce_core", "establishment", "hrms-payroll", "hrms-training", "hrms-leave"];
    expect(moduleSwitches(employeeNoPayroll)).toEqual({ hr: true, payroll: false, recruitment: false });
  });

  it("Recruitment is on ONLY via hrms-recruitment (plus the legacy blanket)", () => {
    expect(isModuleEnabled(["hrms-recruitment"], RECRUITMENT_SWITCH)).toBe(true);
    expect(isModuleEnabled(["hrms-leave", "payroll"], RECRUITMENT_SWITCH)).toBe(false);
  });

  it("the legacy blanket keys hrms / hr keep turning on HR + Payroll + Recruitment (documented compat rule)", () => {
    expect(moduleSwitches(["hrms"])).toEqual({ hr: true, payroll: true, recruitment: true });
    expect(moduleSwitches(["hr"])).toEqual({ hr: true, payroll: true, recruitment: true });
  });

  it("the old 'hr' screen key is a spelling of the HR switch", () => {
    expect(isModuleEnabled(["hrms-leave"], "hr")).toBe(true);
    expect(isModuleEnabled(["hrms"], "hr")).toBe(true);
    expect(isModuleEnabled(["hr"], "hrms")).toBe(true);
    expect(isModuleEnabled(["hrms-recruitment"], "hr")).toBe(false);
  });

  it("every enabler entry is lower-case and unique per switch", () => {
    for (const [sw, names] of Object.entries(SWITCH_ENABLERS)) {
      expect(new Set(names).size, sw).toBe(names.length);
      for (const n of names) expect(n, sw).toBe(n.toLowerCase());
    }
  });

  it("unknown (null) list shows everything; super_admin / platform_admin bypass", () => {
    expect(moduleSwitches(null)).toEqual({ hr: true, payroll: true, recruitment: true });
    expect(moduleSwitches([], ["super_admin"])).toEqual({ hr: true, payroll: true, recruitment: true });
    expect(moduleSwitches(["finance"], ["platform_admin"])).toEqual({ hr: true, payroll: true, recruitment: true });
    expect(moduleSwitches([])).toEqual({ hr: false, payroll: false, recruitment: false });
  });
});

describe("no neighbour turn-on (no prefix / substring matching)", () => {
  it("enabled hrms-recruitment alone turns on neither Payroll nor HR core", () => {
    expect(moduleSwitches(["hrms-recruitment"])).toEqual({ hr: false, payroll: false, recruitment: true });
  });
  it("enabled payroll alone does not turn on Recruitment or HR core", () => {
    expect(moduleSwitches(["payroll"])).toEqual({ hr: false, payroll: true, recruitment: false });
  });
  it("finance does not turn on fin-prefixed or finance-prefixed keys, and vice versa", () => {
    expect(isModuleEnabled(["finance"], "fin")).toBe(false);
    expect(isModuleEnabled(["fin"], "finance")).toBe(false);
    expect(isModuleEnabled(["finance"], "finance-reports")).toBe(false);
    expect(isModuleEnabled(["finance-reports"], "finance")).toBe(false);
    expect(isModuleEnabled(["finance"], "financial")).toBe(false);
  });
  it("hrms-contracts does not turn on the Contracts module (it used to via substring)", () => {
    expect(isModuleEnabled(["hrms-contracts"], "contracts")).toBe(false);
    expect(isModuleEnabled(["contracts"], "contracts")).toBe(true);
  });
  it("singular/plural neighbours only through the explicit alias tables", () => {
    expect(isModuleEnabled(["projects"], "project")).toBe(false);
    expect(isModuleEnabled(["asset"], "assets")).toBe(false);
    expect(isModuleEnabled(["inventory"], "stock")).toBe(false);
    expect(isModuleEnabled(["recommendations"], "recommendation")).toBe(true);
    expect(isModuleEnabled(["journeys"], "journey")).toBe(true);
    expect(isModuleEnabled(["finance"], "revenue")).toBe(true);
    expect(isModuleEnabled(["establishment"], "estab")).toBe(true);
    expect(isModuleEnabled(["estab"], "establishment")).toBe(true);
  });
  it("for every pair of distinct web keys, enabling one never enables the other (aliases excepted)", () => {
    const allowed = new Set([
      "hr>hrms", "hrms>hr", "journey>journeys", "estab>establishment", "establishment>estab", "finance>revenue",
    ]);
    for (const a of WEB_KEYS) {
      for (const b of WEB_KEYS) {
        if (a === b || PLATFORM_MODULE_KEYS.has(b)) continue;
        if (SWITCH_FAMILY.has(a) || a === "hr") continue; // the HR switch table is covered above
        if (allowed.has(`${a}>${b}`)) continue;
        expect(isModuleEnabled([a], b, undefined, { platformAlwaysOn: false }), `${a} must not enable ${b}`).toBe(false);
      }
    }
  });
});

describe("parity with the pre-change matcher (existing tenants see exactly what they see today)", () => {
  // Nav items, search-index entries and hub tiles as they are NOW, with the key the OLD code gave them.
  const navItems = NAV_GROUPS.flatMap((g) => g.items);
  const searchEntries = [...PAGE_INDEX];
  const hubHrefs = [
    ...readFileSync(join(__dirname, "../app/(app)/hr/page.tsx"), "utf8").matchAll(/href: "(\/hr[^"]*)"/g),
  ].map((m) => m[1]);

  const LISTS: Array<{ name: string; list: string[] }> = [
    { name: "fully-licensed government tenant (legacy keys)", list: LEGACY_VOCAB },
    { name: "fully-licensed government tenant (composition keys)", list: FULL_COMPOSITION },
    { name: "legacy tenant hrms+payroll+establishment+finance", list: ["hrms", "payroll", "establishment", "finance"] },
    { name: "legacy tenant with only hrms", list: ["hrms"] },
    { name: "legacy tenant with the hr alias", list: ["hr", "finance", "estab"] },
    { name: "legacy finance-only tenant", list: ["finance"] },
    { name: "legacy tenant without any HR key", list: LEGACY_VOCAB.filter((k) => k !== "hrms" && k !== "payroll") },
    ...LEGACY_VOCAB.map((k) => ({ name: `leave-one-out ${k}`, list: LEGACY_VOCAB.filter((x) => x !== k) })),
  ];

  it("found the real nav items, search entries and hub tiles to compare", () => {
    expect(navItems.length).toBeGreaterThan(60);
    expect(searchEntries.length).toBeGreaterThan(navItems.length);
    expect(hubHrefs.length).toBeGreaterThan(80);
    expect(hubHrefs.some((h) => h.startsWith("/hr/payroll"))).toBe(true);
    expect(hubHrefs).toContain("/hr/recruitment");
  });

  for (const { name, list } of LISTS) {
    // A legacy tenant that has payroll but neither hrms nor hr never saw the HR area; it now sees the Payroll
    // entries (the intended separation), so it is asserted separately below, not as parity.
    const payrollWithoutBlanket = list.includes("payroll") && !list.includes("hrms") && !list.includes("hr");
    const isLegacyLike = !list.some((k) => k.startsWith("hrms-") || k === "workforce_core");

    it(`${name}: nav items have the same visibility as before`, () => {
      if (payrollWithoutBlanket && isLegacyLike) return;
      for (const roles of ROLE_SETS) {
        for (const item of navItems) {
          for (const platformAlwaysOn of [true, false]) {
            const o = legacyIsModuleEnabled(list, oldKeyFor(item.moduleKey), roles, { platformAlwaysOn });
            const n = isModuleEnabled(list, item.moduleKey, roles, { platformAlwaysOn });
            expect(n, `${item.id} (${item.moduleKey}) roles=${roles?.join()} always=${platformAlwaysOn}`).toBe(o);
          }
        }
      }
    });

    it(`${name}: search-index entries have the same visibility as before`, () => {
      if (payrollWithoutBlanket && isLegacyLike) return;
      for (const e of searchEntries) {
        const o = legacyIsModuleEnabled(list, oldKeyFor(e.moduleKey ?? null), undefined, { platformAlwaysOn: false });
        const n = isModuleEnabled(list, e.moduleKey ?? null, undefined, { platformAlwaysOn: false });
        expect(n, `${e.id} (${e.moduleKey})`).toBe(o);
      }
    });

    it(`${name}: every /hr hub tile has the same visibility as before`, () => {
      if (payrollWithoutBlanket && isLegacyLike) return;
      for (const href of hubHrefs) {
        const o = legacyIsModuleEnabled(list, "hrms");
        const n = isModuleEnabled(list, hrAreaSwitchForHref(href));
        expect(n, href).toBe(o);
      }
    });

    it(`${name}: every other module key (route gates, help, setup) resolves as before`, () => {
      if (!isLegacyLike) return; // composition lists are covered by the intended-difference tests below
      for (const key of WEB_KEYS) {
        if (SWITCH_FAMILY.has(key) || key === "hr") continue;
        expect(isModuleEnabled(list, key), key).toBe(legacyIsModuleEnabled(list, key));
        expect(isModuleEnabled(list, key, ["super_admin"]), key).toBe(true);
      }
    });
  }

  it("fully-licensed composition tenant: only Contracts-style neighbour differences are intended (none for the full list)", () => {
    for (const key of WEB_KEYS) {
      if (key === "hr") continue;
      const old = legacyIsModuleEnabled(FULL_COMPOSITION, oldKeyFor(key));
      expect(isModuleEnabled(FULL_COMPOSITION, key), key).toBe(old);
    }
  });

  it("the sidebar for a fully-licensed tenant is identical to the old sidebar, group by group", () => {
    for (const list of [LEGACY_VOCAB, FULL_COMPOSITION]) {
      const roles = ["super_admin"] as const;
      const now = visibleNavGroups({ enabledModules: list, roles: [...roles] }).map((g) => [g.id, g.items.map((i) => i.id)]);
      const before = NAV_GROUPS.map((g) => [
        g.id,
        g.items.filter((i) => legacyIsModuleEnabled(list, oldKeyFor(i.moduleKey), [...roles], { platformAlwaysOn: false })).map((i) => i.id),
      ]).filter(([, ids]) => (ids as string[]).length > 0);
      expect(now).toEqual(before);
    }
  });

  it("documented difference: a legacy tenant with payroll but no hrms/hr key now sees the Payroll entries (and still no HR core)", () => {
    const list = ["payroll", "finance"];
    expect(legacyIsModuleEnabled(list, "hrms")).toBe(false);
    expect(moduleSwitches(list)).toEqual({ hr: false, payroll: true, recruitment: false });
  });
});

describe("HR-only tenant (HR on, no Payroll, no Recruitment): menus, tiles, search hide", () => {
  const hrOnly = ["finance", "workflow", "workforce_core", "hrms-leave", "hrms-attendance", "hrms-payroll", "hrms-training"];
  const ids = (list: string[], roles: string[]) =>
    visibleNavGroups({ enabledModules: list, roles }).flatMap((g) => g.items.map((i) => i.id));
  const PAYROLL_ITEMS = ["hrPayrollRuns", "hrSalarySlips", "hrDdos", "myPayslips", "myTaxDeclaration"];

  it("sidebar keeps HR items and drops every payroll item", () => {
    const visible = ids(hrOnly, ["hr_admin", "payroll_admin", "employee", "super_admin_not"]);
    for (const id of ["hr", "hrEmployees", "hrLeaveApprovals", "myLeave", "myAttendance", "myProfile"]) expect(visible, id).toContain(id);
    for (const id of PAYROLL_ITEMS) expect(visible, id).not.toContain(id);
  });

  it("with Payroll switched on the payroll items are back", () => {
    const visible = ids([...hrOnly, "payroll"], ["hr_admin", "payroll_admin", "employee"]);
    for (const id of PAYROLL_ITEMS) expect(visible, id).toContain(id);
  });

  it("recruitment off drops the recruitment tiles but keeps payroll tiles; payroll off the reverse", () => {
    const tilesFor = (list: string[]) =>
      ["/hr/recruitment", "/hr/jd-templates", "/hr/payroll", "/hr/payroll/gpf", "/hr/leave"].filter((h) =>
        isModuleEnabled(list, hrAreaSwitchForHref(h)),
      );
    expect(tilesFor(["hrms-leave", "payroll"])).toEqual(["/hr/payroll", "/hr/payroll/gpf", "/hr/leave"]);
    expect(tilesFor(["hrms-leave", "hrms-recruitment"])).toEqual(["/hr/recruitment", "/hr/jd-templates", "/hr/leave"]);
    expect(tilesFor(["hrms-leave"])).toEqual(["/hr/leave"]);
  });

  it("search-index entries for payroll pages are hidden when Payroll is off", () => {
    const payrollEntries = PAGE_INDEX.filter((e) => e.href.startsWith("/hr/payroll"));
    expect(payrollEntries.length).toBeGreaterThan(3);
    for (const e of payrollEntries) {
      expect(isModuleEnabled(hrOnly, e.moduleKey ?? null, undefined, { platformAlwaysOn: false }), e.id).toBe(false);
      expect(isModuleEnabled([...hrOnly, "payroll"], e.moduleKey ?? null, undefined, { platformAlwaysOn: false }), e.id).toBe(true);
    }
  });
});

describe("hrAreaSwitchForHref", () => {
  it("maps payroll and recruitment prefixes exactly, everything else to HR", () => {
    expect(hrAreaSwitchForHref("/hr/payroll")).toBe(PAYROLL_SWITCH);
    expect(hrAreaSwitchForHref("/hr/payroll/salary-slips")).toBe(PAYROLL_SWITCH);
    expect(hrAreaSwitchForHref("/hr/recruitment")).toBe(RECRUITMENT_SWITCH);
    expect(hrAreaSwitchForHref("/hr/recruitment/new")).toBe(RECRUITMENT_SWITCH);
    expect(hrAreaSwitchForHref("/hr/jd-templates")).toBe(RECRUITMENT_SWITCH);
    expect(hrAreaSwitchForHref("/hr/payrollx")).toBe(HR_SWITCH);
    expect(hrAreaSwitchForHref("/hr/recruitmentx")).toBe(HR_SWITCH);
    expect(hrAreaSwitchForHref("/hr/leave")).toBe(HR_SWITCH);
    expect(hrAreaSwitchForHref("/hr/loans")).toBe(HR_SWITCH);
  });
});
