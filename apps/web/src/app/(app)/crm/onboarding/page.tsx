import { PageHeader } from "../../../_components/ds";
import { OnboardingList } from "./OnboardingList";

/** P1-9 — Customer onboarding cases (list → detail → stage/KYC actions). */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Customer Onboarding"
        subtitle="Cases opened when a deal is won — track each customer through the onboarding stages and KYC gate."
        back="/crm"
        backLabel="CRM"
      />
      <OnboardingList />
    </>
  );
}
