import { getRtiDetail } from "../../_data/loaders";
import { RTIDetailClient } from "./RTIDetailClient";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { data: rti, source } = await getRtiDetail(params.id);
  return <RTIDetailClient id={params.id} initialRti={rti} initialSource={source} />;
}
