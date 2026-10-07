import { getTranslations } from "next-intl/server";
import { OfflineActions } from "./OfflineActions";

/**
 * Offline fallback served by the service worker when a navigation has no cached
 * copy and the network is unavailable (01-T1).
 *
 * GAP-OFFLINE-HOME-03: styling now uses the design-system tokens (var(--bg),
 * var(--ink), var(--ink2)) and the `.btn` classes from civitas-ds.css (loaded by
 * the root layout) instead of hard-coded light-mode hex, so the page follows the
 * `.dark` theme and the real brand `--primary` colour.
 *
 * GAP-OFFLINE-HOME-04: all copy comes from the next-intl `offlinePage` namespace
 * (en + hi) rather than hard-coded English, for field / low-connectivity users.
 *
 * This page was previously `force-static`; it is now rendered per-request so the
 * resolved locale (cookie -> default) is applied. The service worker precaches
 * whatever response it receives at install/runtime, so static export is not
 * required for the offline fallback to work.
 */
export default async function OfflinePage() {
  const t = await getTranslations("offlinePage");

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <section style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 48 }} aria-hidden>
          📡
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)", marginTop: 12 }}>{t("title")}</h1>
        <p style={{ color: "var(--ink2)", marginTop: 8, fontSize: 14, lineHeight: 1.5 }}>{t("intro")}</p>
        <OfflineActions />
      </section>
    </main>
  );
}
