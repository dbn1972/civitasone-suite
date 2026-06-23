import { PageHeader } from "../../../../_components/ds";
import { RegisterVendorForm } from "./RegisterVendorForm";

export default function NewVendorPage() {
  return (
    <>
      <PageHeader
        title="Register Vendor"
        subtitle="Add a new vendor to the procurement directory."
        back="/procurement/vendors"
      />
      <RegisterVendorForm />
    </>
  );
}
