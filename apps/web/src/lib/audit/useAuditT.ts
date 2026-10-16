"use client";

import { createTranslator, useTranslations } from "next-intl";
import enMessages from "@/messages/en.json";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Translator for the `auditW2` message namespace (en + hi in src/messages).
 * Inside the app's NextIntlClientProvider it is the normal next-intl
 * translator for the viewer's locale. Rendered with no provider (isolated unit
 * tests) it falls back to the English messages instead of throwing, the same
 * pattern as useEstabT and DataTable.
 */
export function useAuditT(): Translate {
  try {
    return useTranslations("auditW2") as unknown as Translate;
  } catch {
    return createTranslator({
      locale: "en",
      messages: enMessages as unknown as Record<string, never>,
      namespace: "auditW2" as never,
    }) as unknown as Translate;
  }
}
