import { configuredTileUrl } from "@/lib/mapTiles";
import { MonitoringMap } from "../_components/MonitoringMap";

export const metadata = {
  title: "Map monitoring",
  description: "Map-based monitoring dashboard across geospatial domains.",
};

export const dynamic = "force-dynamic";

export default function Page() {
  return <MonitoringMap tileUrl={configuredTileUrl()} />;
}
