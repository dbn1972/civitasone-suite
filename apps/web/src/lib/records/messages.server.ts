import { getTranslations } from "next-intl/server";
import { asRecordT, type RecordT } from "./messages";

/** Server pages: the `recordUi` translator in the request locale, to pass to personLabel / outcomeLine / ... */
export async function getRecordT(): Promise<RecordT> {
  return asRecordT(await getTranslations("recordUi"));
}
