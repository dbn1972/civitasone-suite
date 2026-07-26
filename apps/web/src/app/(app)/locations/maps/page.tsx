import { getSessionRoles } from "@/lib/auth/roleGuard";
import { MapViewer } from "./_components/MapViewer";

const MANAGE_ROLES = ["admin", "platform_admin", "location_admin", "gis_admin"];

export const metadata = {
  title: "Map viewer",
  description: "Interactive GIS map viewer with configurable layers.",
};

export default function Page() {
  const roles = getSessionRoles();
  const canManage = roles.some((r) => MANAGE_ROLES.includes(r));
  return <MapViewer canManage={canManage} />;
}
