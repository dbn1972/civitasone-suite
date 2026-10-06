import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock ModuleGate to capture the moduleKey prop.
let capturedModuleKey: string | null = null;
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ moduleKey, children }: { moduleKey: string; children: React.ReactNode }) => {
    capturedModuleKey = moduleKey;
    return <>{children}</>;
  },
}));

import DesignerLayout from "./layout";

describe("DesignerLayout (GAP-DESIGNER-HOME-05)", () => {
  it("uses 'designer' moduleKey instead of 'citizen'", () => {
    render(<DesignerLayout><span>child</span></DesignerLayout>);
    expect(capturedModuleKey).toBe("designer");
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
