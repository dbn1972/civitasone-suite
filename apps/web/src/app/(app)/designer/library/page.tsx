import { getDomainPacks, getServicePacks } from "../_data/designerLoader";
import type { ServicePackLoaderRow } from "../_data/designerLoader";
import type { ServicePackDto } from "../_data/packLibraryApi";
import { PackLibraryClient } from "./PackLibraryClient";

/** GAP-DESIGNER-LIBRARY-05: both packs and domainPacks load through the server
 * loader so the initial render has both, and errors for both surface together. */
export default async function PackLibraryPage() {
  const [{ data: domainPacks, source: domainSource }, { data: serverPacks, source: packsSource }] =
    await Promise.all([getDomainPacks(), getServicePacks()]);

  // Convert ServicePackLoaderRow to ServicePackDto shape (same fields).
  const initialPacks: ServicePackDto[] = serverPacks.map((p: ServicePackLoaderRow) => ({
    id: p.id,
    packKey: p.packKey,
    domainPackKey: p.domainPackKey,
    name: p.name,
    servicePattern: p.servicePattern,
    feeModel: p.feeModel,
    hoaCode: p.hoaCode,
    statutoryReferences: p.statutoryReferences,
    manifest: p.manifest,
    version: p.version,
    status: p.status,
  }));

  return (
    <PackLibraryClient
      domainPacks={domainPacks}
      domainPacksFailed={domainSource === "error"}
      initialPacks={initialPacks}
      initialPacksFailed={packsSource === "error"}
    />
  );
}
