import { DesignerHomeClient } from "./DesignerHomeClient";
import { getDesignerServices, getDomainPacks } from "./_data/designerLoader";
import { getSessionRoles, DESIGNER_AUTHOR_ROLES } from "@/lib/auth/roleGuard";

export default async function DesignerHomePage() {
  const [servicesResult, domainPacksResult] = await Promise.all([
    getDesignerServices(),
    getDomainPacks(),
  ]);

  // GAP2-DESIGNER-HOME-01: compute authoring permission server-side (the JWT
  // roles are only available in a Server Component) and pass it to the client so
  // the "New Service" affordance is hidden from a non-admin. citizen-service's
  // catalogue routes remain the authority (403 on write); this is the matching
  // web gate so a non-admin never sees a control that would only fail on submit.
  const canAuthor = DESIGNER_AUTHOR_ROLES.some((r) => getSessionRoles().includes(r));

  // GAP-DESIGNER-HOME-01: a failed services load must not render as zero
  // counts + "No services yet" (which invites duplicate service creation).
  // Surface the loader source so the client can show an honest error state.
  return (
    <DesignerHomeClient
      services={servicesResult.data}
      domainPacks={domainPacksResult.data}
      servicesSource={servicesResult.source}
      domainPacksSource={domainPacksResult.source}
      canAuthor={canAuthor}
    />
  );
}
