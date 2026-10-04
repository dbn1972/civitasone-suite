"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { useAsyncMutation } from "@/lib/useAsyncMutation";
import type { PtVersionsPayload } from "./viewModel";

/**
 * GAP-PAYROLL-STATUTORY-PT-04: the tenant switch behind maker != checker for PT
 * changes (default ON). Turning it ON takes effect at once; turning it OFF is a
 * request that a DIFFERENT payroll administrator must approve (it then shows in
 * the pending list), and needs a reason.
 */
export function PtMakerCheckerSetting({ enabled, offPending }: { enabled: boolean; offPending: boolean }) {
  const t = useTranslations("ptApprovals");
  const router = useRouter();
  const formError = useFormError(t("settingArea"));
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const wanted = useRef<{ enabled: boolean; reason?: string }>({ enabled: true });

  const mutation = useAsyncMutation<{ id: string }, PtVersionsPayload>({
    mutate: async () => {
      let res: Response;
      try {
        res = await browserFetch("v1/payroll/statutory/pt/settings", {
          method: "PUT",
          body: JSON.stringify({ makerCheckerEnabled: wanted.current.enabled, ...(wanted.current.reason ? { reason: wanted.current.reason } : {}) }),
        });
      } catch (caught) {
        throw UserFacingError.from(formError.fromException("save", caught));
      }
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
      return (await res.json()) as { id: string };
    },
    // The switch change is visible in the versions read model: ON flips the flag; OFF shows up as a pending request.
    poll: async () => {
      const res = await browserFetch("v1/payroll/statutory/pt/versions");
      if (!res.ok) throw new Error("not available");
      return (await res.json()) as PtVersionsPayload;
    },
    isDone: (v) => (wanted.current.enabled ? v.makerChecker === true && !v.pending.some((x) => x.kind === "checker_off") : v.pending.some((x) => x.kind === "checker_off")),
    onConfirmed: () => {
      setOpen(false);
      setMessage(wanted.current.enabled ? t(enabled ? "cancelOffDone" : "settingOnDone") : t("settingOffSubmitted"));
      router.refresh();
    },
    onTimeout: () => { setOpen(false); setMessage(t("stillProcessing")); },
    maxAttempts: 8,
  });
  const busy = mutation.isBusy;

  async function submit(reason?: string) {
    // Cancelling a pending turn-off request is "switch ON" again; otherwise flip the switch.
    wanted.current = { enabled: offPending ? true : !enabled, ...(reason ? { reason } : {}) };
    setDialogError(undefined);
    mutation.reset();
    await mutation.run();
  }

  return (
    <Card title={t("settingTitle")} padding>
      <div style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13 }}>{enabled ? t("settingOn") : t("settingOff")}</p>
        {offPending && <p role="note" className="pill warn" style={{ margin: 0, width: "fit-content" }}>{t("settingOffPending")}</p>}
        {message && <p role="status" aria-live="polite" className="pill good" style={{ margin: 0, width: "fit-content" }}>{message}</p>}
        <div>
          <Button type="button" variant="ghost" style={{ minHeight: 44 }} disabled={busy} onClick={() => { setDialogError(undefined); setOpen(true); }}>
            {enabled ? (offPending ? t("cancelOff") : t("turnOff")) : t("turnOn")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={open}
        title={enabled ? (offPending ? t("cancelOffTitle") : t("turnOffTitle")) : t("turnOnTitle")}
        confirmLabel={enabled ? (offPending ? t("cancelOffConfirm") : t("turnOffConfirm")) : t("turnOnConfirm")}
        danger={enabled && !offPending}
        requireReason={enabled && !offPending}
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("turnOffReasonLabel")}
        busy={busy}
        errorMessage={dialogError ?? mutation.error ?? undefined}
        description={<p style={{ margin: 0 }}>{enabled ? (offPending ? t("cancelOffDescription") : t("turnOffDescription")) : t("turnOnDescription")}</p>}
        onConfirm={(reason) => void submit(reason)}
        onCancel={() => !busy && setOpen(false)}
      />
    </Card>
  );
}
