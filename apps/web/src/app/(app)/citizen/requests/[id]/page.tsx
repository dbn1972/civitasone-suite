import { getGrievanceDetail } from "../../_data/loaders";
import { RequestDetailClient } from "./RequestDetailClient";
import { getSessionRoles, hasAnyRole, CITIZEN_OFFICER_ROLES } from "@/lib/auth/roleGuard";

export default async function Page({ params }: { params: { id: string } }) {
  // GAP-CITIZEN-REQUESTS-DETAIL-01: pass the caller's role so the client
  // component can hide officer actions from citizens. The backend is still
  // authoritative; this only prevents confusing 403s in the UI.
  const isOfficer = hasAnyRole(getSessionRoles(), CITIZEN_OFFICER_ROLES);
  const { data: grievance, source } = await getGrievanceDetail(params.id);
  return <RequestDetailClient id={params.id} initialGrievance={grievance} initialSource={source} isOfficer={isOfficer} />;
}
