"use client";

import { createTranslator, useTranslations } from "next-intl";
import enMessages from "@/messages/en.json";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Translator for the shared `estabW2` message namespace (en + hi in
 * src/messages). Inside the app's NextIntlClientProvider this is the normal
 * next-intl translator for the viewer's locale. When a component is rendered
 * with no provider (isolated unit tests), it falls back to the English
 * messages instead of throwing, the same pattern DataTable uses.
 */
export function useEstabT(namespace: string = "estabW2"): Translate {
  try {
    return useTranslations(namespace as never) as unknown as Translate;
  } catch {
    return createTranslator({
      locale: "en",
      messages: enMessages as unknown as Record<string, never>,
      namespace: namespace as never,
    }) as unknown as Translate;
  }
}
