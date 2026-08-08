"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";
import {
  activateDomainPackStage3,
  fetchDomainPacksForInstall,
  type DomainPackActivateResult,
  type DomainPackListItem,
} from "./domainPackApi";
import {
  MUNICIPAL_DOMAIN_PACK_KEY,
  outcomeLabels,
  type DomainPackCatalogEntry,
} from "./domainPackCatalog";

export type DomainPackActivatePanelProps = {
  /** Compact embed on the installer wizard vs full page. */
  variant?: "embedded" | "page";
  /** Pre-select a pack key (defaults to municipal-in-v1). */
  initialPackKey?: string;
};

export function DomainPackActivatePanel({
  variant = "page",
  initialPackKey = MUNICIPAL_DOMAIN_PACK_KEY,
}: DomainPackActivatePanelProps) {
  const router = useRouter();
  const [packs, setPacks] = useState<DomainPackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(initialPackKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DomainPackActivateResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await fetchDomainPacksForInstall();
      if (!cancelled) {
        setPacks(data);
        setSelectedKey((current) =>
          data.some((p) => p.domainPackKey === current) ? current : (data[0]?.domainPackKey ?? current),
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = packs.find((p) => p.domainPackKey === selectedKey) ?? packs[0];

  async function doActivate() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await activateDomainPackStage3(
        selected.domainPackKey,
        selected.outcomes.map((o) => o.packKey),
      );
      setResult(accepted);
      setConfirmOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not activate Domain Pack.");
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section
      aria-labelledby="domain-pack-stage3-heading"
      className={
        variant === "embedded"
          ? "rounded-xl border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm"
          : "rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Install Stage 3
          </p>
          <h2 id="domain-pack-stage3-heading" className="mt-1 text-lg font-semibold text-slate-900">
            Domain Pack — browse &amp; activate
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Choose a Domain Pack to import service drafts for local review. For{" "}
            <span className="font-medium text-slate-800">{MUNICIPAL_DOMAIN_PACK_KEY}</span>, activation
            yields editable <span className="font-medium">TL</span>,{" "}
            <span className="font-medium">PGR</span>, and <span className="font-medium">Water</span>{" "}
            catalogue drafts (DoD §13(f)).
          </p>
        </div>
        {variant === "embedded" ? (
          <Link
            href="/install/domain-packs"
            className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
          >
            Open full panel →
          </Link>
        ) : (
          <Link href="/install" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            ← Installer wizard
          </Link>
        )}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Loading Domain Packs…
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Domain Pack library">
          {packs.map((pack) => {
            const active = pack.domainPackKey === selected?.domainPackKey;
            return (
              <li key={pack.domainPackKey}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedKey(pack.domainPackKey);
                    setResult(null);
                    setError(null);
                  }}
                  className={`w-full rounded-lg border p-4 text-left transition ${
                    active
                      ? "border-indigo-500 bg-white ring-2 ring-indigo-200"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{pack.name}</span>
                    {pack.recommended ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-mono text-xs text-slate-500">{pack.domainPackKey}</p>
                  <p className="mt-2 text-sm text-slate-600">{pack.summary}</p>
                  <p className="mt-2 text-xs font-medium text-slate-700">
                    Outcome: {outcomeLabels(pack)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? <OutcomePreview pack={selected} /> : null}

      {result ? (
        <div
          role="status"
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          <p className="font-medium">Activation accepted (Stage {result.stageNumber})</p>
          <p className="mt-1">
            Pack <span className="font-mono">{result.domainPackKey}</span> queued. Expected drafts:{" "}
            {result.packKeys.length > 0
              ? result.packKeys.map((k) => k.replace(/^pack:/, "")).join(", ")
              : outcomeLabels(selected!)}
            . Open the{" "}
            <Link href="/designer" className="font-medium underline">
              Service Designer
            </Link>{" "}
            to review editable drafts in this session.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}
          disabled={busy || loading || !selected || Boolean(result)}
          aria-busy={busy}
          onClick={() => setConfirmOpen(true)}
        >
          {result ? "Activated" : "Activate Domain Pack"}
        </button>
        {result ? (
          <Link
            href="/designer"
            className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
          >
            Review drafts
          </Link>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Activate ${selected?.name ?? "Domain Pack"}?`}
        description={
          selected ? (
            <span>
              This runs Install Stage 3 for{" "}
              <strong className="font-mono">{selected.domainPackKey}</strong> and imports{" "}
              <strong>{outcomeLabels(selected)}</strong> as editable catalogue drafts. Services stay
              draft until published.
            </span>
          ) : undefined
        }
        confirmLabel="Activate"
        cancelLabel="Cancel"
        busy={busy}
        errorMessage={error ?? undefined}
        onConfirm={() => void doActivate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}

function OutcomePreview({ pack }: { pack: DomainPackCatalogEntry }) {
  const isMunicipal = pack.domainPackKey === MUNICIPAL_DOMAIN_PACK_KEY;
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-900">
        {isMunicipal ? (
          <>
            <span className="font-mono text-indigo-800">{pack.domainPackKey}</span>
            {" → "}
            <span className="text-slate-800">TL / PGR / Water</span>
            <span className="ms-1 font-normal text-slate-600">editable drafts</span>
          </>
        ) : (
          <>
            Activation outcome for <span className="font-mono">{pack.domainPackKey}</span>
          </>
        )}
      </p>
      <ol className="mt-3 space-y-2" aria-label="Service packs imported on activate">
        {pack.outcomes.map((o) => (
          <li
            key={o.packKey}
            className="flex flex-wrap items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">
              {o.shortLabel}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">{o.label}</p>
              <p className="text-xs text-slate-500">{o.description}</p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">{o.packKey}</p>
            </div>
            <span className="text-xs text-slate-500">draft</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
