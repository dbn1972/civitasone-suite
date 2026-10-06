"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";

/**
 * GAP-GRANTS-SCHEMES-DETAIL-02: close a scheme behind an explicit confirmation
 * with a mandatory reason, instead of a one-click native <form> POST that
 * navigated the browser to the proxy's raw response. Uses the shared
 * ActionButton/ConfirmDialog (maker-checker pattern) and refreshes the page in
 * place on success. The grant-service PATCH .../close endpoint remains the
 * authority (it rejects already-closed schemes with 409).
 */
export function CloseSchemeButton({ schemeId, schemeName }: { schemeId: string; schemeName: string }) {
  const router = useRouter();
  return (
    <ActionButton
      label="Close Scheme"
      className="btn danger"
      danger
      confirmTitle={`Close ${schemeName}?`}
      confirmDescription={
        <>
          Closing this scheme stops it accepting any new applications. This cannot be undone from
          here. A reason is recorded in the audit trail.
        </>
      }
      confirmLabel="Close Scheme"
      requireReason
      reasonLabel="Reason for closing (required)"
      minReasonLength={10}
      maxReasonLength={1000}
      onConfirm={async (reason) => {
        const res = await fetch(`/api/proxy/v1/grants/schemes/${schemeId}/close`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) {
          const human = toHumanError("save", { area: "grant scheme" });
          throw new Error(`${human.what} ${human.next}`);
        }
        router.refresh();
      }}
    />
  );
}
