/**
 * EntityPicker adapters for the works execution forms (GAP-WORKS-EXECUTION-
 * ISSUES-NEW-01 / PHOTOS-NEW-01 / RECORD-PROGRESS-01).
 *
 * Thin wrappers over the shared searchWorks/resolveWorks data client that map
 * a WorkOption ({id, workNumber, description}) to the ds EntityPicker's
 * generic EntityOption ({id, label, sublabel}) shape — so every works form
 * picks a work by number/description instead of a raw UUID, without each form
 * re-implementing the mapping.
 */
import type { EntityOption } from "@/app/_components/ds";
import { searchWorks, resolveWorks, type WorkOption } from "./client";

function toOption(w: WorkOption): EntityOption {
  return {
    id: w.id,
    label: w.workNumber || w.id,
    sublabel: w.description || undefined,
  };
}

export async function searchWorkOptions(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  return (await searchWorks(query, signal)).map(toOption);
}

export async function resolveWorkOptions(ids: string[]): Promise<EntityOption[]> {
  return (await resolveWorks(ids)).map(toOption);
}
