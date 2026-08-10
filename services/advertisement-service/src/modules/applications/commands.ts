import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateApplicationInput {
  advertiserName: string;
  advertiserOrg: string;
  advertisementType: string;
  location: {
    lat?: number | undefined;
    lng?: number | undefined;
    address: string;
    ward?: string | undefined;
    zone?: string | undefined;
  };
  dimensions: {
    widthFt: number;
    heightFt: number;
    areaInSqFt: number;
  };
  structuralDetails?: {
    material?: string | undefined;
    foundation?: string | undefined;
    height?: number | undefined;
    illumination?: string | undefined;
  } | undefined;
  creative?: string | undefined;
  documents?: Array<{ docType: string; fileId: string; uploadedAt: string }> | undefined;
}

export async function createApplication(ctx: RequestContext, body: CreateApplicationInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createApplication, id, { id, ...body });
}

export async function submitApplication(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.submitApplication, id, { id });
}
