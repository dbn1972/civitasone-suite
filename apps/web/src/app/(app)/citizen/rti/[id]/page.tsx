import { getRtiDetail } from "../../_data/loaders";
import { RTIDetailClient } from "./RTIDetailClient";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: rti, source } = await getRtiDetail(params.id);
  return <RTIDetailClient id={params.id} initialRti={rti} initialSource={source} />;
}
