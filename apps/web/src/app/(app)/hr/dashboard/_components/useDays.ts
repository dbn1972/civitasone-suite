/**
 * GAP-HR-DASHBOARD-05: "N day(s)" through next-intl's ICU plural
 * (dashboardDays.count) instead of a hand-rolled `day${n !== 1 ? "s" : ""}`.
 *
 * Falls back to the same English rule when there is no NextIntlClientProvider
 * (component tests render these directly with none) -- the app itself always
 * has one, so real pages get the translated, locale-correct plural.
 */
import { useTranslations } from "next-intl";

export function englishDays(count: number): string {
  return `${count} day${count !== 1 ? "s" : ""}`;
}

export function englishMonthEnds(days: string): string {
  return `Month ends in ${days}`;
}

/**
 * GAP-HR-DASHBOARD-05: "Month ends in {days}" -- the honest label for what the
 * dashboard's payroll nudges actually count (calendar days to month-end; the
 * app has no payroll cutoff calendar to source a real deadline from). Same
 * provider-optional fallback as useDays.
 */
export function useMonthEnds(): (days: string) => string {
  try {
    const t = useTranslations("dashboardDays");
    return (days) => t("monthEnds", { days });
  } catch {
    return englishMonthEnds;
  }
}

export function useDays(): (count: number) => string {
  try {
    const t = useTranslations("dashboardDays");
    return (count) => t("count", { count });
  } catch {
    return englishDays;
  }
}
