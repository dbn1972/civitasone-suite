"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

export function InstallStepActions({
  id,
  status,
  title,
  isRequired,
}: {
  id: string;
  status: string;
  title: string;
  isRequired: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const done = status === "completed";

  async function action(verb: "run" | "skip" | "retry") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy/v1/install/steps/${id}/${verb}`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.text()) || `Failed to ${verb} step.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${verb} this step. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  function onSkip() {
    if (isRequired) {
      setConfirmSkip(true);
      return;
    }
    void action("skip");
  }

  const btn =
    "inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}
          disabled={busy || done}
          aria-busy={busy}
          onClick={() => void action("run")}
        >
          Run
        </button>
        <button
          type="button"
          className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
          disabled={busy || done}
          aria-busy={busy}
          onClick={() => void action("retry")}
        >
          Retry
        </button>
        <button
          type="button"
          className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
          disabled={busy || done}
          aria-busy={busy}
          onClick={onSkip}
        >
          Skip
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmSkip}
        title={`Skip required step "${title}"?`}
        description="This step is required for a complete installation. Skipping it may leave the tenant workspace partially provisioned. You can re-run it later from this wizard."
        confirmLabel="Skip step"
        cancelLabel="Keep step"
        danger
        busy={busy}
        onConfirm={() => {
          setConfirmSkip(false);
          void action("skip");
        }}
        onCancel={() => setConfirmSkip(false)}
      />
    </div>
  );
}
