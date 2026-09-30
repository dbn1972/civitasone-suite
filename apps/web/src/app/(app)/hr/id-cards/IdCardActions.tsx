"use client";

/**
 * GAP-HR-ID-CARDS-01: the backend has always fully supported suspend/revoke/
 * reactivate (services/hrms-service/src/modules/id-cards/routes.ts, all
 * three gated to the same ID_CARDS_ROLES and already audited via
 * COMMANDS.idCardSuspend/Revoke/Reactivate) -- the register page just never
 * exposed any of it. Mirrors this app's established
 * ActionButton+ConfirmDialog pattern (see locations/list/LocationActions.tsx)
 * rather than a bespoke dialog.
 */
import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";

type Props = {
  id: string;
  holderName: string;
  /** The row's effective status (post GAP-HR-ID-CARDS-03 derivation) -- gates which action(s) apply. */
  status: string;
};

async function patchIdCard(id: string, action: "suspend" | "revoke" | "reactivate", reason?: string): Promise<void> {
  const res = await fetch(`/api/proxy/v1/hrms/id-cards/${id}/${action}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  if (!res.ok) {
    let message = `Could not ${action} the card. Please try again.`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      // non-JSON error body -- fall back to the generic message above.
    }
    throw new Error(message);
  }
}

export function IdCardActions({ id, holderName, status }: Props) {
  const router = useRouter();

  // GAP-HR-ID-CARDS-01's own Acceptance list: active -> Suspend + Revoke;
  // suspended -> Reactivate + Revoke; revoked/expired -> none (the backend
  // 404s suspend/revoke/reactivate outside their allowed from-status
  // anyway -- routes.ts's own WHERE ... AND status = '...' guards -- so this
  // is a UX courtesy, not the real boundary).
  if (status !== "active" && status !== "suspended") return null;

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {status === "active" && (
        <ActionButton
          label="Suspend"
          className="btn ghost"
          requireReason
          reasonLabel="Reason for suspension"
          confirmTitle="Suspend this ID card?"
          confirmDescription={`This immediately suspends ${holderName}'s card. Physical/gate access relying on this card will stop working until it is reactivated.`}
          confirmLabel="Suspend card"
          onConfirm={(reason) => patchIdCard(id, "suspend", reason)}
          onSuccess={() => router.refresh()}
        />
      )}
      {status === "suspended" && (
        <ActionButton
          label="Reactivate"
          className="btn ghost"
          confirmTitle="Reactivate this ID card?"
          confirmDescription={`This restores ${holderName}'s card to active status.`}
          confirmLabel="Reactivate card"
          onConfirm={() => patchIdCard(id, "reactivate")}
          onSuccess={() => router.refresh()}
        />
      )}
      {/* Revoke is irreversible (no un-revoke route exists) -- danger + a
          required reason, per GAP-HR-ID-CARDS-01's own Risk note. */}
      <ActionButton
        label="Revoke"
        className="btn ghost"
        danger
        requireReason
        reasonLabel="Reason for revocation"
        confirmTitle="Revoke this ID card?"
        confirmDescription={`This permanently revokes ${holderName}'s card. Revoking cannot be undone -- a new card must be issued afterwards if needed.`}
        confirmLabel="Revoke card"
        onConfirm={(reason) => patchIdCard(id, "revoke", reason)}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}
