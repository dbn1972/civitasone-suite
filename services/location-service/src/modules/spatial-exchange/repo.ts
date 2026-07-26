import { sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";

export type ImportFeature =
  | { kind: "geojson"; name: string | null; geometry: unknown; properties: Record<string, unknown>; type: string }
  | { kind: "kml"; name: string | null; geometryXml: string; properties: Record<string, unknown>; type: string };

/**
 * SVC-117: persist parsed features into location.spatial_features inside the
 * tenant-GUC transaction (RLS enforced). Returns the number of features stored.
 */
export async function importFeatures(
  tenantId: string,
  actorId: string,
  dataset: string,
  source: "geojson" | "kml",
  features: ImportFeature[],
): Promise<number> {
  let stored = 0;
  await db.transaction(async (tx) => {
    for (const f of features) {
      const geomExpr = f.kind === "geojson"
        ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326)`
        : sql`ST_SetSRID(ST_Force2D(ST_GeomFromKML(${f.geometryXml})), 4326)`;
      await tx.execute(sql`
        INSERT INTO location.spatial_features (tenant_id, dataset, name, feature_type, geom, properties, source, created_by)
        VALUES (${tenantId}, ${dataset}, ${f.name}, ${f.type}, ${geomExpr}, ${JSON.stringify(f.properties)}::jsonb, ${source}, ${actorId})
      `);
      stored++;
    }
  });
  return stored;
}

export type ExportedFeature = {
  id: string;
  name: string | null;
  featureType: string;
  properties: Record<string, unknown>;
  geojson: string; // ST_AsGeoJSON geometry
  kml: string;     // ST_AsKML geometry
};

/** SVC-117: read a dataset's features with both GeoJSON and KML geometry serialisations. */
export async function exportFeatures(tenantId: string, dataset: string, limit: number): Promise<ExportedFeature[]> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, name, feature_type, properties,
           ST_AsGeoJSON(geom) AS geojson,
           ST_AsKML(geom) AS kml
    FROM location.spatial_features
    WHERE tenant_id = ${tenantId} AND dataset = ${dataset}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `));
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? null,
    featureType: r.feature_type as string,
    properties: (r.properties as Record<string, unknown>) ?? {},
    geojson: r.geojson as string,
    kml: r.kml as string,
  }));
}

/** Build a GeoJSON FeatureCollection from exported rows. */
export function toGeoJson(features: ExportedFeature[]): { type: "FeatureCollection"; features: Array<Record<string, unknown>> } {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      id: f.id,
      geometry: JSON.parse(f.geojson),
      properties: { ...f.properties, ...(f.name ? { name: f.name } : {}) },
    })),
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Build a KML document from exported rows. */
export function toKml(dataset: string, features: ExportedFeature[]): string {
  const placemarks = features.map((f) => {
    const name = f.name ? `<name>${escapeXml(f.name)}</name>` : "";
    return `<Placemark>${name}${f.kml}</Placemark>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(dataset)}</name>${placemarks}</Document></kml>`;
}
