/** GFR 2017 / PFMS mandate: dates displayed as dd/MM/yyyy in Indian locale. */
export function formatIndianDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
