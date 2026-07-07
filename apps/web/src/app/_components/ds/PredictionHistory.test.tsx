import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PredictionHistory, type PredictionHistoryEntry } from "./PredictionHistory";

function mockFetch(data: PredictionHistoryEntry[], status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data }),
  } as unknown as Response);
}

function mockFetchRawArray(data: PredictionHistoryEntry[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response);
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new Error("Network error"));
}

const sampleEntries: PredictionHistoryEntry[] = [
  {
    id: "pred-1",
    prediction: 0.85,
    confidence: 0.92,
    modelVersion: 3,
    createdAt: "2024-06-15T10:30:00Z",
  },
  {
    id: "pred-2",
    prediction: 0.72,
    confidence: 0.78,
    modelVersion: 2,
    createdAt: "2024-06-10T08:15:00Z",
  },
  {
    id: "pred-3",
    prediction: 0.35,
    confidence: 0.45,
    modelVersion: 2,
    createdAt: "2024-06-05T14:00:00Z",
  },
];

describe("PredictionHistory", () => {
  describe("loading state", () => {
    it("shows loading skeletons while fetching", () => {
      const fetchFn = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      const loading = screen.getByRole("status", { name: /loading prediction history/i });
      expect(loading).toBeInTheDocument();
      expect(loading.className).toContain("animate-pulse");
    });
  });

  describe("error state", () => {
    it("shows error message on HTTP error", async () => {
      const fetchFn = mockFetch([], 500);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to load predictions (500)");
    });

    it("shows error message on network failure", async () => {
      const fetchFn = mockFetchNetworkError();
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      expect(screen.getByRole("alert")).toHaveTextContent("Network error loading predictions");
    });
  });

  describe("empty state", () => {
    it("shows empty message when no predictions exist", async () => {
      const fetchFn = mockFetch([]);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(screen.getByText("No prediction history available")).toBeInTheDocument();
      });
    });
  });

  describe("timeline rendering", () => {
    it("renders entries as list items", async () => {
      const fetchFn = mockFetch(sampleEntries);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(screen.getAllByRole("listitem")).toHaveLength(3);
      });
    });

    it("shows formatted prediction values", async () => {
      const fetchFn = mockFetch(sampleEntries);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(screen.getByText("85%")).toBeInTheDocument();
        expect(screen.getByText("72%")).toBeInTheDocument();
        expect(screen.getByText("35%")).toBeInTheDocument();
      });
    });

    it("shows N/A for null predictions", async () => {
      const entries = [{ id: "pred-null", prediction: null, confidence: 0.5, createdAt: "2024-06-15T10:30:00Z" }];
      const fetchFn = mockFetch(entries);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(screen.getByText("N/A")).toBeInTheDocument();
      });
    });

    it("shows model version badges", async () => {
      const fetchFn = mockFetch(sampleEntries);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(screen.getByText("v3")).toBeInTheDocument();
        expect(screen.getAllByText("v2")).toHaveLength(2);
      });
    });

    it("shows confidence percentages", async () => {
      const fetchFn = mockFetch(sampleEntries);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(screen.getByText("92% conf.")).toBeInTheDocument();
        expect(screen.getByText("78% conf.")).toBeInTheDocument();
        expect(screen.getByText("45% conf.")).toBeInTheDocument();
      });
    });

    it("renders date formatted with <time> elements", async () => {
      const fetchFn = mockFetch(sampleEntries);
      const { container } = render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        const timeElements = container.querySelectorAll("time");
        expect(timeElements).toHaveLength(3);
        expect(timeElements[0]).toHaveAttribute("datetime", "2024-06-15T10:30:00Z");
      });
    });
  });

  describe("data fetching", () => {
    it("calls fetch with correct URL parameters", async () => {
      const fetchFn = mockFetch([]);
      render(
        <PredictionHistory entityId="entity-123" domain="tickets" limit={5} fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(fetchFn).toHaveBeenCalledWith(
          "/api/v1/ml/predictions?entityId=entity-123&domain=tickets&limit=5"
        );
      });
    });

    it("encodes entityId and domain in URL", async () => {
      const fetchFn = mockFetch([]);
      render(
        <PredictionHistory entityId="entity with spaces" domain="my domain" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(fetchFn).toHaveBeenCalledWith(
          "/api/v1/ml/predictions?entityId=entity%20with%20spaces&domain=my%20domain&limit=10"
        );
      });
    });

    it("handles response as raw array (not wrapped in data)", async () => {
      const fetchFn = mockFetchRawArray(sampleEntries);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(screen.getAllByRole("listitem")).toHaveLength(3);
      });
    });

    it("defaults limit to 10", async () => {
      const fetchFn = mockFetch([]);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        expect(fetchFn).toHaveBeenCalledWith(
          expect.stringContaining("limit=10")
        );
      });
    });
  });

  describe("dark mode support", () => {
    it("includes dark mode classes on timeline elements", async () => {
      const fetchFn = mockFetch(sampleEntries);
      const { container } = render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        const cards = container.querySelectorAll("[role='listitem'] .rounded-lg");
        expect(cards.length).toBeGreaterThan(0);
        expect(cards[0].className).toContain("dark:bg-gray-800");
        expect(cards[0].className).toContain("dark:border-gray-700");
      });
    });
  });

  describe("accessibility", () => {
    it("has an aria-label on the timeline container", async () => {
      const fetchFn = mockFetch(sampleEntries);
      render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        const list = screen.getByRole("list");
        expect(list).toHaveAttribute("aria-label", "Prediction history timeline");
      });
    });

    it("marks timeline connectors as aria-hidden", async () => {
      const fetchFn = mockFetch(sampleEntries);
      const { container } = render(
        <PredictionHistory entityId="entity-1" domain="leads" fetchFn={fetchFn} />
      );
      await waitFor(() => {
        const hidden = container.querySelectorAll("[aria-hidden='true']");
        expect(hidden.length).toBeGreaterThan(0);
      });
    });
  });
});
