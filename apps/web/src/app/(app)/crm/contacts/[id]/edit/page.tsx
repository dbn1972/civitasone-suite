import { getTranslations } from "next-intl/server";
import { getContactById } from "../../../../../_data/loaders";
import { PageHeader, EmptyState, maskEmail, maskPhone } from "../../../../../_components/ds";
import { getSessionRoles, hasAnyRole, CRM_PII_READ_ROLES } from "@/lib/auth/roleGuard";
import EditContactForm from "./EditContactForm";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: contact } = await getContactById(params.id);
  if (!contact) {
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
        designation: contact.designation,
        city: contact.city,
        ...(contact.leadStatus ? { leadStatus: contact.leadStatus } : {}),
        ...(contact.marketingConsent !== undefined ? { marketingConsent: contact.marketingConsent } : {}),
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
