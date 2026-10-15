import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import enMessages from "@/messages/en.json";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Server-component translator for the `auditW2` namespace. Falls back to the
 * English messages when there is no request scope (isolated unit tests).
 */
export async function getAuditT(): Promise<Translate> {
  try {
    return (await getTranslations("auditW2")) as unknown as Translate;
  } catch {
    return createTranslator({
      locale: "en",
      messages: enMessages as unknown as Record<string, never>,
      namespace: "auditW2" as never,
    }) as unknown as Translate;
  }
}
