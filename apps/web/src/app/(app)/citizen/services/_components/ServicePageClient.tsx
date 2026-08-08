"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublishedServiceRuntime } from "../_data/runtimeApi";
import { listDraftsForService } from "../_data/runtimeApi";

interface Props {
  service: PublishedServiceRuntime;
  counterMode?: boolean;
}

export function ServicePageClient({ service, counterMode = false }: Props) {
  const [draftBanner, setDraftBanner] = useState<string | null>(null);

  useEffect(() => {
    void listDraftsForService(service.id).then((drafts) => {
      if (drafts[0]) setDraftBanner(drafts[0].id);
    });
  }, [service.id]);

  const applyHref = `/citizen/services/${service.serviceKey}/apply${counterMode ? "?counter=1" : ""}`;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {draftBanner ? (
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

      <Link href={applyHref} className="btn primary" style={{ minHeight: 44, textAlign: "center" }}>
        Apply now
      </Link>
    </div>
  );
}
