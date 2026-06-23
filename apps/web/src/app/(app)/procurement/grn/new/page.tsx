import { PageHeader } from "../../../../_components/ds";
import { CreateGRNForm } from "./CreateGRNForm";

export default function NewGRNPage() {
  return (
    <>
      <PageHeader
        title="New Goods Receipt Note"
        subtitle="Record received quantities and inspection — three-way match is computed automatically."
        back="/procurement/grn"
      />
      <CreateGRNForm />
    </>
  );
}
