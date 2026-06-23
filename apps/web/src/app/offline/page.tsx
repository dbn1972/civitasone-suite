export const dynamic = "force-static";

/** Offline fallback served by the service worker when a navigation has no cached
 * copy and the network is unavailable (01-T1). */
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
        padding: 24,
      }}
    >
      <section style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 48 }} aria-hidden>
          📡
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "#0f172a", marginTop: 12 }}>You&apos;re offline</h1>
        <p style={{ color: "#475569", marginTop: 8, fontSize: 14, lineHeight: 1.5 }}>
          This page isn&apos;t available offline yet. Previously visited screens and your queued changes are saved on
          this device and will sync automatically when you reconnect.
        </p>
        <a
          href="/dashboard"
          style={{
            display: "inline-block",
            marginTop: 16,
            padding: "8px 16px",
            borderRadius: 8,
            background: "#4f46e5",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Go to dashboard
        </a>
      </section>
    </main>
  );
}
