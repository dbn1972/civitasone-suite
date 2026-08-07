import { DesignerHomeClient } from "./DesignerHomeClient";
import { getDesignerServices, getDomainPacks } from "./_data/designerLoader";

export default async function DesignerHomePage() {
  const [{ data: services }, { data: domainPacks }] = await Promise.all([
    getDesignerServices(),
    getDomainPacks(),
  ]);

  return <DesignerHomeClient services={services} domainPacks={domainPacks} />;
}
