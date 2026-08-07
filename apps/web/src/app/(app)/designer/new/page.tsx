"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader, Card, HelpTip } from "@/app/_components/ds";
import { createServiceDefinition, slugifyServiceKey, waitForServiceDefinition } from "../_data/designerApi";
import { SERVICE_PATTERN_OPTIONS } from "../_data/designerConstants";

export default function PatternPickerPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [office, setOffice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pattern = SERVICE_PATTERN_OPTIONS.find((p) => p.id === selected);

  const handleCreate = async () => {
    if (!selected || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createServiceDefinition({
        serviceKey: slugifyServiceKey(name.trim()),
        name: name.trim(),
        servicePattern: selected,
        ownerDepartment: office.trim() || undefined,
        channels: ["portal"],
      });
      await waitForServiceDefinition(id);
      router.push(`/designer/${id}/b1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create draft.");
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New Service"
        subtitle="Choose a Service Pattern — each pattern decides which composition blocks apply."
        actions={<Link href="/designer" className="btn ghost">← Library</Link>}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {SERVICE_PATTERN_OPTIONS.map((p) => {
          const active = selected === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p.id)}
              className="card"
              style={{
                textAlign: "left",
                padding: 16,
                cursor: "pointer",
                border: active ? "2px solid var(--primary)" : "1px solid var(--line)",
                background: active ? "var(--primary-soft)" : "var(--panel)",
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }} aria-hidden>
                {p.id === "certificate" ? "📜" : p.id === "booking" ? "📅" : p.id === "collection" ? "💳" : "📣"}
              </div>
              <strong style={{ display: "block", marginBottom: 6 }}>{p.title}</strong>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink2)" }}>{p.description}</p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
                e.g. {p.examples.join(" · ")}
              </p>
            </button>
          );
        })}
      </div>

      {pattern ? (
        <Card title="Service details" padding>
          <div style={{ display: "grid", gap: 16, maxWidth: 480 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Service name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Trade License Renewal"
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Owning office</span>
              <input
                className="input"
                value={office}
                onChange={(e) => setOffice(e.target.value)}
                placeholder="Pre-filled from your office (optional)"
              />
            </label>
            <div>
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>Active blocks: </span>
              <span style={{ fontSize: 13 }}>{pattern.activeBlocks.join(" · ")}</span>
            </div>
            {error ? (
              <p role="alert" style={{ margin: 0, color: "var(--bad-fg)", fontSize: 13 }}>{error}</p>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn primary" disabled={!name.trim() || busy} onClick={() => { void handleCreate(); }}>
                {busy ? "Creating…" : "Create draft"}
              </button>
              <Link href="/designer/library" className="btn ghost">or start from a pack</Link>
            </div>
          </div>
        </Card>
      ) : (
        <p style={{ color: "var(--mut)" }}>
          Select a pattern above, or <Link href="/designer/library">start from a pack</Link>.
        </p>
      )}

      <div style={{ marginTop: 16 }}>
        <HelpTip term="What is a Service Pattern?">
          Patterns fix which of the eight composition blocks apply. You can change the pattern later from Catalogue & Identity — hidden block data is preserved, not deleted.
        </HelpTip>
      </div>
    </>
  );
}
