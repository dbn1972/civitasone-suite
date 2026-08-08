"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "@/app/_components/ds";
import type { PublishedServiceRuntime } from "../_data/runtimeApi";
import { formatFee, listDraftsForService } from "../_data/runtimeApi";

interface Props {
  service: PublishedServiceRuntime;
  counterMode?: boolean;
}

const CHANNEL_LABELS: Record<string, string> = {
  portal: "Portal",
  mobile: "Mobile",
  counter: "Counter / CSC",
  whatsapp: "WhatsApp",
  api: "API",
};

export function ServicePageClient({ service, counterMode = false }: Props) {
  const [draftBanner, setDraftBanner] = useState<string | null>(null);

  useEffect(() => {
    void listDraftsForService(service.id).then((drafts) => {
      if (drafts[0]) setDraftBanner(drafts[0].id);
    });
  }, [service.id]);

  const applyHref = `/citizen/services/${service.serviceKey}/apply${counterMode ? "?counter=1" : ""}`;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <StatusPill status="published" label="Open for applications" />
        {service.channels.map((ch) => (
          <span
            key={ch}
            style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: "var(--r-sm)",
              background: "var(--bg)",
              border: "1px solid var(--line)",
              color: "var(--ink2)",
            }}
          >
            {CHANNEL_LABELS[ch] ?? ch}
          </span>
        ))}
      </div>

      <dl
        style={{
          margin: 0,
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        }}
      >
        <div>
          <dt style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>Fee</dt>
          <dd style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>
            {formatFee(service.feeFromMinor, service.feeCurrency)}
          </dd>
        </div>
        <div>
          <dt style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>Time to decide</dt>
          <dd style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>
            {service.slaDays
              ? `${service.slaDays} working day${service.slaDays === 1 ? "" : "s"}`
              : "As per office schedule"}
          </dd>
        </div>
      </dl>

      {service.slaDays ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
          SLA promise: offices aim to decide within <strong>{service.slaDays} working days</strong> of
          submission (counted from the day your application is received).
        </p>
      ) : null}

      {service.requiredDocuments.length > 0 ? (
        <div>
          <strong style={{ fontSize: 14 }}>Documents needed</strong>
          <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
            {service.requiredDocuments.map((d) => (
              <li
                key={d.docType}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: "var(--r-sm)",
                  border: "1px solid var(--line)",
                  background: "var(--bg)",
                  fontSize: 14,
                  minHeight: 44,
                }}
              >
                <span aria-hidden style={{ color: "var(--primary)", fontWeight: 700, marginTop: 1 }}>
                  ☐
                </span>
                <span style={{ flex: 1 }}>
                  {d.label}
                  {d.mandatory ? (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--bad-fg)",
                        background: "var(--bad-bg)",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      Required
                    </span>
                  ) : (
                    <span style={{ marginLeft: 8, fontSize: 11, color: "var(--mut)" }}>Optional</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
          No documents are required to start — the office may ask for evidence during review.
        </p>
      )}

      {draftBanner ? (
        <div
          className="pad"
          role="status"
          style={{
            background: "var(--warn-bg)",
            border: "1px solid var(--warn-border)",
            borderRadius: "var(--r-sm)",
            fontSize: 14,
          }}
        >
          Continue where you left off —{" "}
          <Link href={applyHref} style={{ fontWeight: 600, color: "var(--warn-fg)" }}>
            Resume draft
          </Link>
        </div>
      ) : null}

      <Link
        href={applyHref}
        className="btn primary"
        style={{ minHeight: 44, textAlign: "center", fontSize: 16 }}
      >
        {draftBanner ? "Resume application" : "Apply now"}
      </Link>
    </div>
  );
}
