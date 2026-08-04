/**
 * CM-001 addresses — CQRS write path. create/update/delete are all keyed on the
 * address id; publishCrmCommand derives the messageId from `${type}:${id}` so the
 * three never collide in `_inbox.processed` (the roles-module lesson).
 */
import type { RequestContext } from "@civitasone/types";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";
import type { CreateAddressBody, UpdateAddressBody } from "./validators.js";

export type { Accepted };

export const createAddress = (
  ctx: RequestContext,
  id: string,
  body: CreateAddressBody,
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.createAddress, id, {
    ownerType: body.ownerType,
    ownerId: body.ownerId,
    addressType: body.addressType,
    line1: body.line1,
    line2: body.line2 ?? null,
    city: body.city ?? null,
    state: body.state ?? null,
    pincode: body.pincode ?? null,
    country: body.country ?? "IN",
    isPrimary: body.isPrimary ?? false,
  });

export const updateAddress = (
  ctx: RequestContext,
  id: string,
  body: UpdateAddressBody,
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.updateAddress, id, { changed: body });

export const deleteAddress = (ctx: RequestContext, id: string): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.deleteAddress, id, {});
