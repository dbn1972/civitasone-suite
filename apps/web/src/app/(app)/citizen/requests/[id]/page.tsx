import { RequestDetailClient } from "./RequestDetailClient";

export default function Page({ params }: { params: { id: string } }) {
  return <RequestDetailClient id={params.id} />;
}
