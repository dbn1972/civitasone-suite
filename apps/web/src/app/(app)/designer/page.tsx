import { DesignerHomeClient } from "./DesignerHomeClient";
import { getDesignerServices, getDomainPacks } from "./_data/designerLoader";

export default async function DesignerHomePage() {
  const [servicesResult, domainPacksResult] = await Promise.all([
    getDesignerServices(),
    getDomainPacks(),
  ]);

  // GAP-DESIGNER-HOME-01: a failed services load must not render as zero
  // counts + "No services yet" (which invites duplicate service creation).
  // Surface the loader source so the client can show an honest error state.
  return (
    <DesignerHomeClient
      services={servicesResult.data}
      domainPacks={domainPacksResult.data}
      servicesSource={servicesResult.source}
      domainPacksSource={domainPacksResult.source}
    />
  );
}
