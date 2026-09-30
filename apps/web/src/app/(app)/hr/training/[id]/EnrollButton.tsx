"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button } from "../../../../_components/ds";

export interface EnrollButtonProps {
  trainingId: string;
  /**
   * The viewer's own hrms_employees.id (from getMyProfile()), or null when
   * they have no linked employee record. POST /v1/hrms/nominations requires
   * a syntactically valid employeeId in the body, but a non-HR caller's
   * value is IGNORED server-side and force-replaced with their own resolved
   * id anyway (training/routes.ts resolveOwnEmployeeIdIfNonHr) -- this is
   * only ever sent for a self-enrol, so there's nothing to look up or pick.
   */
  employeeId: string | null;
}

/**
 * GAP-HR-TRAINING-01: posts to the existing, already-secured
 * POST /v1/hrms/nominations (self-scoped for any non-HR caller; see this
 * folder's page.tsx doc comment for why the enrolment-flow decision this
 * item was blocked on is already resolved in shipped code).
 */
export function EnrollButton({ trainingId, employeeId }: EnrollButtonProps) {
  const t = useTranslations("trainingDetail");
  const router = useRouter();
  const formError = useFormError("training nomination");
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");

  if (!employeeId) {
    return <p className="text-sm text-slate-500">{t("noEmployeeLink")}</p>;
  }

  if (state === "done") {
    return <p role="status" className="text-sm font-medium text-emerald-700">{t("enrolled")}</p>;
  }

  async function handleEnroll() {
    setState("submitting");
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/nominations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trainingId, employeeId }),
      });

      if (!res.ok) {
        await formError.fromResponse(res, "save");
        setState("idle");
        return;
      }

      setState("done");
      // GAP-HR-TRAINING-NEW-01's cache.invalidateResource fix makes this an
      // immediately-fresh re-render, not a stale cached list.
      router.refresh();
    } catch {
      formError.fromException("save");
      setState("idle");
    }
  }

  return (
    <div>
      <Button
        variant="primary"
        onClick={handleEnroll}
        disabled={state === "submitting"}
        aria-busy={state === "submitting"}
      >
        {state === "submitting" ? t("enrolling") : t("enrollCta")}
      </Button>
      {formError.message && (
        <p role="alert" aria-live="assertive" className="text-sm text-red-600 mt-2">{formError.message}</p>
      )}
    </div>
  );
}
