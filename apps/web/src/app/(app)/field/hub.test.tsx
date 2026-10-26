import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils/intl-render";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const roles: { current: string[] } = { current: [] };
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => roles.current };
});

import FieldHub from "./page";

describe("Field hub agent-roster tile", () => {
  it("is hidden from a field agent (the roster endpoint is supervisor-only)", async () => {
    roles.current = ["field_agent"];
    render(await FieldHub());
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
  });

  it("is shown to a field supervisor", async () => {
    roles.current = ["field_admin"];
    render(await FieldHub());
    expect(screen.getByText("Agents")).toBeInTheDocument();
  });
});

// GAP-FIELD-HOME-04: hub strings come from next-intl, with real en AND hi keys.
describe("Field hub i18n", () => {
  const KEYS = [
    "title", "subtitle",
    "tasksTitle", "tasksDescription",
    "visitsTitle", "visitsDescription",
    "routesTitle", "routesDescription",
    "agentsTitle", "agentsDescription",
    "syncTitle", "syncDescription",
  ];

  it("has every hub key in both en and hi, and hi is really translated", () => {
    const en = (enMessages as unknown as Record<string, Record<string, string>>).fieldHub;
    const hi = (hiMessages as unknown as Record<string, Record<string, string>>).fieldHub;
    expect(en).toBeTruthy();
    expect(hi).toBeTruthy();
    for (const k of KEYS) {
      expect(en![k], `en.fieldHub.${k}`).toBeTruthy();
      expect(hi![k], `hi.fieldHub.${k}`).toBeTruthy();
      expect(hi![k], `hi.fieldHub.${k} must differ from English`).not.toBe(en![k]);
    }
  });

  it("renders the header and tile copy from the message catalogue", async () => {
    roles.current = ["field_admin"];
    render(await FieldHub());
    const en = (enMessages as unknown as Record<string, Record<string, string>>).fieldHub!;
    expect(screen.getByText(en.title!)).toBeInTheDocument();
    expect(screen.getByText(en.visitsDescription!)).toBeInTheDocument();
    expect(screen.getByText(en.agentsDescription!)).toBeInTheDocument();
  });
});
