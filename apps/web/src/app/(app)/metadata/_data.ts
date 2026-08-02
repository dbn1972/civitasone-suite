import { fetchJson } from "@/app/_lib/api";

export async function getMetadataEntities() {
  try {
    const res = await fetchJson<{ data: unknown[] }>("/api/v1/metadata/entities");
    return { data: res.data ?? [], source: "live" as const };
  } catch {
    return { data: [] as unknown[], source: "error" as const };
  }
}
