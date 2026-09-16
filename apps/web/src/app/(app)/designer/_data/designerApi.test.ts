import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createServiceDefinition,
  fetchA11yPreview,
  fetchServiceAnalytics,
  fetchServiceDefinition,
  updateServiceDefinition,
} from "./designerApi";

/**
 * UX-016: designerApi.ts's parseAccepted used to throw the raw response
 * body text (falling back to `Request failed (${status}).`), and
 * fetchServiceDefinition/fetchA11yPreview/fetchServiceAnalytics each threw
 * their own `Could not <do thing> (${status}).` — the same class of leak
 * useFormError closes for components (UX-003). This module is a plain
 * async data client, not a component, so it can't use that hook; every
 * site now goes through the same catalogued toHumanError vocabulary
 * instead and never reads the response body at all, so it structurally
 * cannot leak it.
 */
describe("designerApi — never leaks raw status or server text on failure", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("createServiceDefinition throws a clerk-safe message, never the raw HTTP status or server text", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "catalogue-service unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const err = await createServiceDefinition({
      serviceKey: "trade-license",
      name: "Trade License",
      servicePattern: "certificate",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b503\b/);
    expect(message).not.toContain("catalogue-service unavailable");
    expect(message).toMatch(/couldn't save/i);
  });

  it("updateServiceDefinition throws the same clerk-safe message on failure", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const err = await updateServiceDefinition("def-1", { name: "Renamed" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\b500\b/);
  });

  it("fetchServiceDefinition throws a clerk-safe message, never the raw HTTP status", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const err = await fetchServiceDefinition("def-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b404\b/);
    expect(message).toMatch(/couldn't load/i);
  });

  it("fetchA11yPreview throws a clerk-safe message, never the raw HTTP status", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const err = await fetchA11yPreview("def-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\b500\b/);
  });

  it("fetchServiceAnalytics throws a clerk-safe message, never the raw HTTP status", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const err = await fetchServiceAnalytics("def-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\b500\b/);
  });
});
