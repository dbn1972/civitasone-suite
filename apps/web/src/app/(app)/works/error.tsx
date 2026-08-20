"use client";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function WorksError({ error, reset }: ErrorProps) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 320,
        gap: 16,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 52,
          height: 52,
          background: "var(--primary, #00439C)",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 24,
          fontWeight: 800,
        }}
      >
        C
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Something went wrong in Works</h2>
      <p style={{ color: "var(--mut, #667085)", fontSize: 13.5, maxWidth: 380, margin: 0 }}>
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      {error.digest && (
        <p style={{ color: "var(--mut, #667085)", fontSize: 12, margin: 0 }}>
          Reference: <code>{error.digest}</code>
        </p>
      )}
      <button
        type="button"
        className="btn"
        onClick={reset}
        style={{ marginTop: 8 }}
      >
        Reload section
      </button>
    </div>
  );
}
