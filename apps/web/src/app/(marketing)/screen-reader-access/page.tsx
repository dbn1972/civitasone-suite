import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GigwPage } from "../_gigw/GigwPage";

// UAT-P2-D3 (A11Y-19, GIGW 3.0 screen-reader access page).
// The product list is factual; Hindi-voice guidance is DEFERRED-content.
const READERS = [
  { name: "NVDA", kind: "srFree" },
  { name: "JAWS", kind: "srCommercial" },
  { name: "Narrator (Windows)", kind: "srBuiltIn" },
  { name: "VoiceOver (macOS, iOS)", kind: "srBuiltIn" },
  { name: "TalkBack (Android)", kind: "srBuiltIn" },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gigw");
  return { title: `${t("screenReaderTitle")} | CivitasOne` };
}

export default async function ScreenReaderAccessPage() {
  const t = await getTranslations("gigw");
  return (
    <GigwPage
      title={t("screenReaderTitle")}
      intro={t("screenReaderIntro")}
      pendingNotice={t("pendingNotice")}
      pendingSection={t("pendingSection")}
      sections={[]}
    >
      <table className="mt-6 w-full border-collapse text-start text-sm">
        <caption className="sr-only">{t("screenReaderTitle")}</caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-gray-300 py-2 pe-4">{t("srColName")}</th>
            <th scope="col" className="border-b border-gray-300 py-2">{t("srColType")}</th>
          </tr>
        </thead>
        <tbody>
          {READERS.map((r) => (
            <tr key={r.name}>
              <th scope="row" className="border-b border-gray-200 py-2 pe-4 font-medium" lang="en">{r.name}</th>
              <td className="border-b border-gray-200 py-2">{t(r.kind)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </GigwPage>
  );
}
