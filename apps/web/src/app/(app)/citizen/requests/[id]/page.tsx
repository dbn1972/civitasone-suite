import { getGrievanceDetail } from "../../_data/loaders";
import { RequestDetailClient } from "./RequestDetailClient";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: grievance, source } = await getGrievanceDetail(params.id);
  return <RequestDetailClient id={params.id} initialGrievance={grievance} initialSource={source} />;
}
