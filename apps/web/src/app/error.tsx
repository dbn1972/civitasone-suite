"use client";

import { useEffect } from "react";
import { PageHeader, Card, EmptyState } from "@/app/_components/ds";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root application error:", error);
  }, [error]);

  return (
    <>
      <PageHeader
        title="Something went wrong"
        subtitle="An unexpected error occurred. Please try again."
      />
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <div className="mx-auto max-w-2xl">
          <Card padding>
            <div
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              style={{ textAlign: "center" }}
            >
              <EmptyState
                icon="⚠️"
                title="Something went wrong"
                message="An unexpected error occurred. Please try again."
                action={
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 12,
                      marginTop: 8,
                    }}
                  >
                    <button
                      type="button"
                      className="btn primary"
                      style={{ minHeight: 44, minWidth: 120 }}
                      onClick={reset}
                    >
                      Try again
                    </button>
                    {error.digest ? (
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--muted, #64748b)",
                          margin: 0,
                          fontFamily: "monospace",
                        }}
                      >
                        Correlation ID: {error.digest}
                      </p>
                    ) : null}
                  </div>
                }
              />
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
