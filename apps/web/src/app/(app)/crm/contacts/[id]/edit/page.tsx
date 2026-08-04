import { getContactById } from "../../../../../_data/loaders";
import { PageHeader, EmptyState } from "../../../../../_components/ds";
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
  return (
    <EditContactForm
      params={params}
      initial={{
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
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
