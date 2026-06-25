import { RTIDetailClient } from "./RTIDetailClient";

export default function Page({ params }: { params: { id: string } }) {
  return <RTIDetailClient id={params.id} />;
}
