import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Locations"
      description="Location master, geofences, jurisdictions, infrastructure and map tooling."
      help="locations"
      links={[
        { href: "/locations/list", label: "Locations", note: "Location master list from location-service" },
        { href: "/locations/geofences", label: "Geofences", note: "Geofence definitions and checks" },
        { href: "/locations/jurisdictions", label: "Jurisdictions", note: "Administrative jurisdiction boundaries" },
        { href: "/locations/infrastructure", label: "Infrastructure", note: "Infrastructure assets and facilities" },
        { href: "/locations/maps", label: "Map Viewer", note: "Interactive map workspace" },
        { href: "/locations/maps/monitoring", label: "Map Monitoring", note: "Live monitoring overlay" },
      ]}
    />
  );
}
