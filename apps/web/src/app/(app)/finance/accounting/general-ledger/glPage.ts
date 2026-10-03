import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";

/** Rows per ledger page. The server bounds it (limit <= 100), so the page never holds the whole ledger. */
export const GL_PAGE_SIZE = 25;

export const GL_TABS = ["All", "Payment", "Receipt", "Journal"] as const;
export type GlTab = (typeof GL_TABS)[number];
export const GL_TAB_TYPE: Record<GlTab, "payment" | "receipt" | "journal" | undefined> = {
  All: undefined,
  Payment: "payment",
  Receipt: "receipt",
  Journal: "journal",
};

export type GlView = { fy: string; tab: GlTab; q: string; page: number };

type Sp = Record<string, string | string[] | undefined> | undefined;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? "" : v ?? "");

/** Normalise the URL search params into a safe view (bad values fall back to defaults, never throw). */
export function parseGlView(sp: Sp, now: Date = new Date()): GlView {
  const fyRaw = first(sp?.fy).trim();
  const fy = isValidFinancialYearLabel(fyRaw) ? fyRaw : currentFinancialYear(now);
  const typeRaw = first(sp?.type).trim().toLowerCase();
  const tab: GlTab = typeRaw === "" ? "All" : GL_TABS.find((t) => (GL_TAB_TYPE[t] as string | undefined) === typeRaw) ?? "All";
  const q = first(sp?.q).trim().slice(0, 100);
  const pageN = Number.parseInt(first(sp?.page), 10);
  const page = Number.isFinite(pageN) && pageN >= 1 && pageN <= 100_000 ? pageN : 1;
  return { fy, tab, q, page };
}

/** Query string for a view; defaults are omitted so URLs stay short. */
export function glQuery(view: GlView, now: Date = new Date()): string {
  const p = new URLSearchParams();
  if (view.fy !== currentFinancialYear(now)) p.set("fy", view.fy);
  const type = GL_TAB_TYPE[view.tab];
  if (type) p.set("type", type);
  if (view.q) p.set("q", view.q);
  if (view.page > 1) p.set("page", String(view.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** "1–25 of 4,812" style range for the footer; empty set -> zeros. */
export function glRange(page: number, pageSize: number, total: number): { from: number; to: number; pages: number } {
  if (total <= 0) return { from: 0, to: 0, pages: 1 };
  const from = (page - 1) * pageSize + 1;
  return { from: Math.min(from, total), to: Math.min(page * pageSize, total), pages: Math.max(1, Math.ceil(total / pageSize)) };
}
