import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "./infra.js";
import { COMMANDS } from "../topics.js";

/**
 * The queue transport JSON-encodes the message, and JSON.stringify throws on BigInt
 * ("Do not know how to serialize a BigInt") -> the route answered 500 and nothing was queued
 * (UAT g4: evm/compute, ra-bills, time-extensions, penalties, resources). Money stays bigint
 * paise in the handler; on the wire it is a decimal string, which Postgres coerces to bigint.
 */
export function wireSafe<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as unknown as T;
  if (Array.isArray(value)) return value.map(wireSafe) as unknown as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wireSafe(v)])) as T;
  }
  return value;
}

export type Accepted = { id: string; status: string; correlationId: string };

export async function publishF3Write(
  ctx: RequestContext,
  op: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(COMMANDS.f3RouteWrite, {
    messageId: randomUUID(),
    type: COMMANDS.f3RouteWrite,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: wireSafe({ op, id, tenantId: ctx.tenantId, ...payload }),
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
