/**
 * Test helper: RTL's `render` wrapped in an English NextIntlClientProvider, so a
 * component that calls useTranslations() renders its real (en) copy and the
 * existing assertions stay unchanged. Re-exports the rest of RTL untouched.
 */
import type { ReactElement, ReactNode } from "react";
import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function IntlWrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

export * from "@testing-library/react";

export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return rtlRender(ui, { wrapper: IntlWrapper, ...options });
}
