import { getRtiDetail } from "../../_data/loaders";
import { RTIDetailClient } from "./RTIDetailClient";
import { getSessionRoles, RTI_APPELLATE_ROLES } from "@/lib/auth/roleGuard";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { data: rti, source } = await getRtiDetail(params.id);
  return <RTIDetailClient id={params.id} initialRti={rti} initialSource={source} canDecideAppeal={getSessionRoles().some((r) => RTI_APPELLATE_ROLES.includes(r))} />;
}
