import { getTranslations } from "next-intl/server";
import { getContactById } from "../../../../../_data/loaders";
import { PageHeader, EmptyState, maskEmail, maskPhone } from "../../../../../_components/ds";
import { LoadErrorState } from "../../../../../_components/ds/LoadErrorState";
import { getSessionRoles, hasAnyRole, CRM_PII_READ_ROLES } from "@/lib/auth/roleGuard";
import EditContactForm from "./EditContactForm";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: contact, source, status, errorMessage } = await getContactById(params.id);
  if (!contact) {
    // GAP-CRM-CONTACTS-DETAIL-EDIT-04: an API outage used to render the same
    // bare "Contact not found" as a real 404, so a transient failure looked
    // like a deleted record. Only a genuine 404 is "not found"; anything else
    // is a transient failure (Retry) or a 403 (access-restricted copy).
    if (source === "error" && status !== 404) {
      const tErr = await getTranslations("crmContactEdit");
      return (
        <>
          <PageHeader title={tErr("editTitle")} back="/crm/contacts" />
          <LoadErrorState result={{ status, errorMessage }} area={tErr("loadArea")} backHref="/crm/contacts" backLabel={tErr("backLabel")} />
        </>
      );
    }
    return (
      <>
        <PageHeader title="Edit Contact" back="/crm/contacts" />
        <EmptyState icon="👤" title="Contact not found" />
      </>
    );
  }
  // DPDP: only CRM_PII_READ_ROLES get the clear email/phone prefilled. Everyone
  // else gets masked placeholders and empty fields; an untouched field sends no
  // change (buildContactPatch compares against the undefined initial value), so
  // the stored value is only ever replaced when the user retypes it.
  const canViewPii = hasAnyRole(getSessionRoles(), CRM_PII_READ_ROLES);
  const t = await getTranslations("crmContactEdit");
  return (
    <EditContactForm
      params={params}
      {...(canViewPii
        ? {}
        : {
            maskedPii: {
              hint: t("piiHiddenHint"),
              ...(contact.email ? { email: maskEmail(contact.email) } : {}),
              ...(contact.phone ? { phone: maskPhone(contact.phone) } : {}),
            },
          })}
      initial={{
        name: contact.name,
        ...(canViewPii ? { email: contact.email, phone: contact.phone } : {}),
        organization: contact.organization,
        ...(contact.accountId ? { accountId: contact.accountId } : {}),
        designation: contact.designation,
        city: contact.city,
        ...(contact.leadStatus ? { leadStatus: contact.leadStatus } : {}),
        ...(contact.marketingConsent !== undefined ? { marketingConsent: contact.marketingConsent } : {}),
        ...(contact.consentPurpose ? { consentPurpose: contact.consentPurpose } : {}),
        ...(contact.consentChannel ? { consentChannel: contact.consentChannel } : {}),
        ...(contact.consentUpdatedAt ? { consentUpdatedAt: contact.consentUpdatedAt } : {}),
        ...(contact.gstin ? { gstin: contact.gstin } : {}),
        ...(contact.pan ? { pan: contact.pan } : {}),
        ...(contact.pincode ? { pincode: contact.pincode } : {}),
        ...(contact.leadSource ? { leadSource: contact.leadSource } : {}),
        ...(contact.temperature ? { temperature: contact.temperature } : {}),
        ...(contact.priority ? { priority: contact.priority } : {}),
        ...(contact.segment ? { segment: contact.segment } : {}),
        ...(contact.product ? { product: contact.product } : {}),
        ...(contact.region ? { region: contact.region } : {}),
        ...(contact.expectedValueMinor ? { expectedValueMinor: contact.expectedValueMinor } : {}),
      }}
    />
  );
}
