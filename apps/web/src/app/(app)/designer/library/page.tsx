import { getDomainPacks } from "../_data/designerLoader";
import { PackLibraryClient } from "./PackLibraryClient";

export default async function PackLibraryPage() {
  const { data: domainPacks } = await getDomainPacks();
  return <PackLibraryClient domainPacks={domainPacks} />;
}
