"use client";
import { useState } from "react";
import { FollowUpModal } from "./FollowUpModal";

export function FollowUpButton({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" type="button" onClick={() => setOpen(true)}>
        + Create Follow-up
      </button>
      {open && <FollowUpModal accountId={accountId} onClose={() => setOpen(false)} />}
    </>
  );
}
