import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusTimeline, formDesignFromService } from "./StatusTimeline";

describe("StatusTimeline", () => {
  it("renders done/current/upcoming steps", () => {
    render(
      <StatusTimeline
        steps={[
          { id: "1", label: "Submitted", state: "done", date: "8 Aug 2026" },
          { id: "2", label: "Under review", state: "current", slaDaysRemaining: 12 },
          { id: "3", label: "Issued", state: "upcoming" },
        ]}
      />,
    );
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText(/12d SLA/)).toBeInTheDocument();
    expect(screen.getByText("Issued")).toBeInTheDocument();
  });
});

describe("formDesignFromService", () => {
  it("extracts embedded formDesign", () => {
    const design = formDesignFromService([
      { formDesign: { sections: [{ id: "s", label: "S", fieldIds: [] }], fields: {} } },
    ]);
    expect(design?.sections).toHaveLength(1);
  });
});
