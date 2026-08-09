"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import { CatalogueB1Form, type CatalogueB1Values } from "../../_components/CatalogueB1Form";
import { ApplicantTypesForm, type ApplicantTypesValues } from "../../_components/ApplicantTypesForm";
import { GovernanceLinkageBuilder } from "../../_components/GovernanceLinkageBuilder";
import { fetchServiceDefinition } from "../../_data/designerApi";
import { usePhase3Config } from "../../_data/usePhase3Config";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";

export default function DesignerB1Page() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();

  // FN-27/FN-28/FN-18 — service-level governance metadata belongs with identity.
  const phase3 = usePhase3Config(params.id);

  const queryPattern = search.get("pattern") ?? "certificate";
  const queryName = search.get("name") ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initial, setInitial] = useState<CatalogueB1Values | null>(null);
  const [applicantInitial, setApplicantInitial] = useState<ApplicantTypesValues | null>(null);
  const [meta, setMeta] = useState({ name: queryName || "Untitled service", pattern: queryPattern, version: 1, status: "draft" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const def = await fetchServiceDefinition(params.id);
        if (cancelled) return;
        const pattern = def.servicePattern ?? queryPattern;
        setMeta({
          name: def.name,
          pattern,
          version: def.version,
          status: def.status,
        });
        setInitial({
          name: def.name,
          serviceKey: def.serviceKey,
          ownerDepartment: def.ownerDepartment ?? "",
          slaDays: def.slaDays ?? "",
          channels: def.channels?.length ? def.channels : ["portal"],
          statutoryReferences: def.statutoryReferences ?? [],
          servicePattern: pattern,
        });
        setApplicantInitial({
          allowedApplicantTypes: def.allowedApplicantTypes?.length ? def.allowedApplicantTypes : ["citizen"],
          applicantTypeRejectMessage: def.applicantTypeRejectMessage ?? "",
          profileAttributeBindings: def.profileAttributeBindings ?? [],
          servicePattern: pattern,
        });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load draft.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params.id, queryPattern]);

  const patternMeta = SERVICE_PATTERN_OPTIONS.find((p) => p.id === meta.pattern);
  const hidden = hiddenBlocksForPattern(meta.pattern);

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status: b.id === "b1" ? "in-progress" : "empty",
      })),
    [hidden],
  );

  if (loading) {
    return <p style={{ color: "var(--mut)" }}>Loading draft…</p>;
  }

  if (error || !initial || !applicantInitial) {
    return (
      <div>
        <p style={{ color: "var(--bad-fg)" }}>{error ?? "Draft not found."}</p>
        <Link href="/designer" className="btn ghost">← Library</Link>
      </div>
    );
  }

  return (
    <WizardShell
      serviceName={meta.name}
      patternLabel={patternMeta?.title ?? meta.pattern}
      version={meta.version}
      status={meta.status}
      saveState={saveState}
      blocks={blocks}
      activeBlockId="b1"
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
      onNext={() => router.push(`/designer/${params.id}/b2`)}
      help={
        <HelpTip term="Catalogue & Identity">
          Set the service name, owning office, channels, SLA, and who may apply (citizen, company, institution, anonymous).
        </HelpTip>
      }
    >
      <CatalogueB1Form
        definitionId={params.id}
        initial={initial}
        onSaveState={setSaveState}
        onPatternChange={(pattern) => setMeta((m) => ({ ...m, pattern }))}
      />
      <div style={{ marginTop: 16 }}>
        <ApplicantTypesForm
          definitionId={params.id}
          initial={applicantInitial}
          servicePattern={meta.pattern}
          onSaveState={setSaveState}
        />
      </div>
      <div style={{ marginTop: 16 }}>
        <GovernanceLinkageBuilder
          appeal={phase3.config.appealLinkage ?? null}
          rti={phase3.config.rtiLinkage ?? null}
          locales={phase3.config.locales}
          onAppealChange={(appealLinkage) => void phase3.patch({ appealLinkage })}
          onRtiChange={(rtiLinkage) => void phase3.patch({ rtiLinkage })}
          onLocalesChange={(locales) => void phase3.patch({ locales })}
        />
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Link href="/designer" className="btn ghost">← Library</Link>
      </div>
    </WizardShell>
  );
}
