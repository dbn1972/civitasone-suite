import { PageHeader } from "../../../../_components/ds";
import { OnboardingDetail } from "./OnboardingDetail";

/** P1-9 — Customer onboarding case detail (stage + KYC actions). */
export default function Page({ params }: { params: { id: string } }) {
  return (
    <>
      <PageHeader title="Onboarding Case" back="/crm/onboarding" backLabel="Customer Onboarding" />
      <OnboardingDetail id={params.id} />
    </>
  );
}
