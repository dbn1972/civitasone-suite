"use client";

/**
 * The two slow, below-the-fold sections of the employee profile, loaded after the page (UX-R5 performance,
 * S-11). Each read publishes a DPDP audit-on-read event and waited 4.5-5.3 s for the broker on UAT, which held
 * the whole profile when it was rendered on the server. The profile, statutory and lifecycle cards now render
 * immediately; these fill in once the page has loaded, with the same three states (error / empty / data) and
 * the same role gating (the page only mounts them for roles the backend admits).
 */
import { useTranslations } from "next-intl";
import { Card, SkeletonRow } from "@/app/_components/ds";
import { useDeferredResource } from "@/app/_components/deferredLoad";
import { hrScannedDocumentsPath, mapHrScannedDocuments, type HrScannedDocument } from "@/lib/hr/scannedDocuments";
import { ScannedDocumentsSection } from "./ScannedDocumentsSection";
import { MedicalInsuranceCard } from "../../medical/_components/MedicalInsuranceCard";
import { MedicalInsuranceForm } from "../../medical/_components/MedicalInsuranceForm";
import { mapInsuranceResponse, type MedicalInsurance } from "../../medical/_components/insuranceTypes";

const NO_DOCS: HrScannedDocument[] = [];

function LoadingRows({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label}>
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

export function DeferredScannedDocuments({ employeeId, backHref }: { employeeId: string; backHref: string }) {
  const t = useTranslations("hrScannedDocuments");
  const result = useDeferredResource(hrScannedDocumentsPath(employeeId), NO_DOCS, mapHrScannedDocuments);
  if (!result) {
    return (
      <Card title={t("cardTitle")}>
        <LoadingRows label={t("loading")} />
      </Card>
    );
  }
  return <ScannedDocumentsSection result={Array.isArray(result.data) ? result : { ...result, data: [] }} backHref={backHref} />;
}

export function insurancePath(employeeId: string): string {
  return `/api/v1/hrms/medical/insurance?employeeId=${encodeURIComponent(employeeId)}`;
}

export function DeferredMedicalInsurance({ employeeId, canReveal, canEdit }: { employeeId: string; canReveal: boolean; canEdit: boolean }) {
  const t = useTranslations("medicalInsurance");
  // 404 is a real answer ("no record on file"), exactly like the server loader (insuranceData.ts).
  const result = useDeferredResource<MedicalInsurance | null>(insurancePath(employeeId), null, mapInsuranceResponse, { notFoundAs: null });
  if (!result) {
    return (
      <Card title={t("title")} padding>
        <LoadingRows label={t("title")} />
      </Card>
    );
  }
  return (
    <MedicalInsuranceCard result={result} canReveal={canReveal}>
      {canEdit && result.source !== "error" && <MedicalInsuranceForm employeeId={employeeId} initial={result.data} />}
    </MedicalInsuranceCard>
  );
}
