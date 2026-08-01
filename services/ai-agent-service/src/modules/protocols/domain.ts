/**
 * protocols/domain.ts — AG-005 open agent-interoperability protocol rules.
 * Pure functions only.
 */

export type ProtocolName = "mcp" | "a2a" | "openai_tools" | "anthropic_tools";

export const PROTOCOLS: readonly ProtocolName[] = ["mcp", "a2a", "openai_tools", "anthropic_tools"];

/**
 * What each protocol is expected to expose. Used to describe a registration
 * before its endpoint has been probed, so the console can show a meaningful
 * descriptor for a freshly registered endpoint instead of an empty object.
 */
const PROTOCOL_TRAITS: Record<ProtocolName, { transport: string; discovery: string; streaming: boolean }> = {
  mcp: { transport: "jsonrpc", discovery: "tools/list", streaming: true },
  a2a: { transport: "https", discovery: "agent-card", streaming: true },
  openai_tools: { transport: "https", discovery: "tools-schema", streaming: false },
  anthropic_tools: { transport: "https", discovery: "tools-schema", streaming: false },
};

export function validateProtocol(protocol: string): string | null {
  if (!PROTOCOLS.includes(protocol as ProtocolName)) {
    return `protocol must be one of: ${PROTOCOLS.join(", ")}`;
  }
  return null;
}

/**
 * Endpoint validation. Plain http is rejected outright: an interop endpoint
 * carries prompts and tool arguments, and those must never cross the wire in
 * clear text. Loopback is allowed so a tenant can register a sidecar.
 */
export function validateEndpoint(endpoint: unknown): string | null {
  if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
    return "endpoint is required";
  }
  if (endpoint.length > 500) {
    return "endpoint must be at most 500 characters";
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "endpoint must be an absolute URL";
  }
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    return "endpoint must use https (http is allowed only for loopback)";
  }
  return null;
}

export interface CapabilityInput {
  name?: unknown;
  description?: unknown;
  version?: unknown;
}

export interface Capability {
  name: string;
  description: string | null;
  version: string | null;
}

/** Normalise a declared capability list: drop nameless entries, dedupe by name. */
export function normalizeCapabilities(input: unknown): Capability[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Capability[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as CapabilityInput;
    if (typeof entry.name !== "string" || entry.name.trim().length === 0) continue;
    const key = entry.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: entry.name.trim(),
      description: typeof entry.description === "string" ? entry.description : null,
      version: typeof entry.version === "string" ? entry.version : null,
    });
  }
  return out;
}

export interface CapabilityDescriptor {
  protocol: ProtocolName;
  endpoint: string;
  enabled: boolean;
  transport: string;
  discovery: string;
  streaming: boolean;
  capabilities: Capability[];
  capabilityCount: number;
}

/** Build the discovered capability descriptor served by GET /protocols/:id/capabilities. */
export function buildCapabilityDescriptor(input: {
  protocol: string;
  endpoint: string;
  enabled: boolean;
  capabilities: unknown;
}): CapabilityDescriptor {
  const protocol = (PROTOCOLS.includes(input.protocol as ProtocolName)
    ? input.protocol
    : "mcp") as ProtocolName;
  const traits = PROTOCOL_TRAITS[protocol];
  const capabilities = normalizeCapabilities(input.capabilities);

  return {
    protocol,
    endpoint: input.endpoint,
    enabled: input.enabled,
    transport: traits.transport,
    discovery: traits.discovery,
    streaming: traits.streaming,
    capabilities,
    capabilityCount: capabilities.length,
  };
}
