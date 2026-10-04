import { describePayDay, weekdayName } from "./payGroupSchedule";

/** Minimal translate signature shared by `useTranslations` and `getTranslations`. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The pay day as display text ("28th", "Last day of month", "Friday",
 * "Friday (odd weeks)"), by frequency. `t` is the `payGroupCard` namespace.
 */
export function formatPayDay(t: Translate, locale: string, group: Parameters<typeof describePayDay>[0]): string {
  const payDay = describePayDay(group);
  if (payDay.kind === "lastDay") return t("payDayLastDay");
  if (payDay.kind === "dayOfMonth") return t("payDayValue", { day: payDay.day });
  if (payDay.kind === "weekday") return weekdayName(payDay.weekday, locale);
  if (payDay.kind === "biWeekly") {
    return t("payDayBiWeekly", {
      weekday: weekdayName(payDay.weekday, locale),
      weeks: payDay.parity === 0 ? t("weeksEven") : payDay.parity === 1 ? t("weeksOdd") : t("weeksAlternate"),
    });
  }
  return t("payDayLegacy", { day: payDay.day });
}

const FREQUENCY_LABEL_KEYS: Record<string, string> = {
  monthly: "frequencyMonthly",
  bi_weekly: "frequencyBiWeekly",
  weekly: "frequencyWeekly",
};

/** Frequency display label (payGroupCard namespace); unknown values fall back to the raw code only as a last resort. */
export function frequencyLabel(t: Translate, frequency: string): string {
  const key = FREQUENCY_LABEL_KEYS[frequency];
  return key ? t(key) : frequency;
}
