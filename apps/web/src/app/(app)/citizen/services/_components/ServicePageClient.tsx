"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublishedServiceRuntime } from "../_data/runtimeApi";
import { channelDisabledMessage, isChannelAllowed, listDraftsForService } from "../_data/runtimeApi";

interface Props {
  service: PublishedServiceRuntime;
  counterMode?: boolean;
}

export function ServicePageClient({ service, counterMode = false }: Props) {
  const [draftBanner, setDraftBanner] = useState<string | null>(null);
  const channel = counterMode ? "counter" : "portal";
  const channelOk = isChannelAllowed(service.channels, channel);

  useEffect(() => {
    if (!channelOk) return;
    void listDraftsForService(service.id).then((drafts) => {
      if (drafts[0]) setDraftBanner(drafts[0].id);
    });
  }, [service.id, channelOk]);

  const applyHref = `/citizen/services/${service.serviceKey}/apply${counterMode ? "?counter=1" : ""}`;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {!channelOk ? (
        <p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--bad-fg, #b42318)" }}>
          {channelDisabledMessage(channel, service.channels)}
        </p>
      ) : null}

      {channelOk && draftBanner ? (
        <div
          className="pad"
          role="status"
          style={{
            background: "var(--warn-bg, #fffaeb)",
            border: "1px solid var(--warn-border, #fec84b)",
            borderRadius: "var(--r-sm)",
            fontSize: 14,
          }}
        >
          Continue where you left off —{" "}
          <Link href={applyHref} style={{ fontWeight: 600 }}>
            Resume draft
          </Link>
        </div>
      ) : null}

      {channelOk ? (
        <Link href={applyHref} className="btn primary" style={{ minHeight: 44, textAlign: "center" }}>
          Apply now
        </Link>
      ) : (
        <button type="button" className="btn primary" style={{ minHeight: 44 }} disabled aria-disabled="true">
          Apply now
        </button>
      )}
    </div>
  );
}
