import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

/** Test helper: renders a client component inside the app's next-intl provider (en by default, or hi). */
export function renderIntl(ui: ReactElement, locale: "en" | "hi" = "en"): RenderResult {
  const messages = locale === "hi" ? hiMessages : enMessages;
  const wrap = (node: ReactNode) => <NextIntlClientProvider locale={locale} messages={messages}>{node}</NextIntlClientProvider>;
  const result = render(wrap(ui));
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)) };
}
