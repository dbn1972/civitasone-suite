import { HttpError } from "../../shared/context.js";
import type { ImportFeature } from "./repo.js";

export const MAX_BYTES = 4 * 1024 * 1024; // 4 MB bounded input
export const MAX_FEATURES = 5000;

const GEOJSON_GEOM_TYPES = new Set([
  "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection",
]);

/** Parse a GeoJSON FeatureCollection (or single Feature) into import features. */
export function parseGeoJson(input: unknown): ImportFeature[] {
  const root = input as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown };
  if (!root || typeof root !== "object") throw new HttpError(400, "INVALID_GEOJSON", "body must be a GeoJSON object");

  let rawFeatures: Array<{ geometry?: { type?: string }; properties?: Record<string, unknown> }>;
  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features)) throw new HttpError(400, "INVALID_GEOJSON", "FeatureCollection.features must be an array");
    rawFeatures = root.features as typeof rawFeatures;
  } else if (root.type === "Feature") {
    rawFeatures = [root as typeof rawFeatures[number]];
  } else {
    throw new HttpError(400, "INVALID_GEOJSON", "expected a Feature or FeatureCollection");
  }

  if (rawFeatures.length === 0) throw new HttpError(400, "INVALID_GEOJSON", "no features to import");
  if (rawFeatures.length > MAX_FEATURES) throw new HttpError(413, "TOO_MANY_FEATURES", `at most ${MAX_FEATURES} features`);

  return rawFeatures.map((f, i) => {
    const geom = f.geometry;
    if (!geom || typeof geom !== "object" || typeof geom.type !== "string" || !GEOJSON_GEOM_TYPES.has(geom.type)) {
      throw new HttpError(400, "INVALID_GEOJSON", `feature ${i} has an invalid geometry`);
    }
    const props = (f.properties && typeof f.properties === "object" ? f.properties : {}) as Record<string, unknown>;
    const name = typeof props.name === "string" ? props.name : null;
    return { kind: "geojson", name, geometry: geom, properties: props, type: geom.type };
  });
}

const PLACEMARK_RE = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
const NAME_RE = /<name\b[^>]*>([\s\S]*?)<\/name>/i;
const GEOM_RE = /<(Point|LineString|Polygon|MultiGeometry|LinearRing)\b[\s\S]*?<\/\1>/i;

/** Parse a KML document into import features (one per Placemark with a geometry). */
export function parseKml(kml: string): ImportFeature[] {
  const features: ImportFeature[] = [];
  let m: RegExpExecArray | null;
  PLACEMARK_RE.lastIndex = 0;
  while ((m = PLACEMARK_RE.exec(kml)) !== null) {
    const block = m[1] ?? "";
    const gm = GEOM_RE.exec(block);
    if (!gm) continue;
    const nameMatch = NAME_RE.exec(block);
    const name = nameMatch ? nameMatch[1]!.trim() : null;
    features.push({ kind: "kml", name, geometryXml: gm[0], properties: name ? { name } : {}, type: gm[1]! });
    if (features.length > MAX_FEATURES) throw new HttpError(413, "TOO_MANY_FEATURES", `at most ${MAX_FEATURES} features`);
  }
  if (features.length === 0) throw new HttpError(400, "INVALID_KML", "no Placemark geometries found");
  return features;
}
