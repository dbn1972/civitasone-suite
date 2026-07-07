/**
 * CivitasMap component tests.
 *
 * Validates:
 * - Renders with correct ARIA attributes
 * - Limits markers to maxMarkers (200 default)
 * - Shows truncation notice when markers exceed max
 * - Handles keyboard focus states
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CivitasMap, type MapMarker } from "./CivitasMap";

// Minimal test environment — jsdom doesn't run iframe scripts, but we can test
// the component's React rendering and accessibility markup.

describe("CivitasMap", () => {
  it("renders with default ARIA attributes", () => {
    const { container } = render(<CivitasMap />);

    const region = container.querySelector('[role="region"]');
    expect(region).toBeTruthy();
    expect(region?.getAttribute("aria-label")).toBe("Map view");
  });

  it("renders iframe with correct title for accessibility", () => {
    render(<CivitasMap />);

    const iframe = screen.getByTitle("Interactive map showing locations");
    expect(iframe).toBeTruthy();
    expect(iframe.tagName.toLowerCase()).toBe("iframe");
  });

  it("renders screen-reader instructions", () => {
    const { container } = render(<CivitasMap />);

    const instructions = container.querySelector(".sr-only");
    expect(instructions).toBeTruthy();
    expect(instructions?.textContent).toContain("arrow keys");
    expect(instructions?.textContent).toContain("zoom");
  });

  it("does not show truncation notice when markers <= maxMarkers", () => {
    const markers: MapMarker[] = [
      { id: "1", lat: 28.6, lng: 77.2, label: "Delhi" },
      { id: "2", lat: 19.0, lng: 72.8, label: "Mumbai" },
    ];

    const { container } = render(<CivitasMap markers={markers} />);
    const notice = container.querySelector('[role="status"]');
    expect(notice).toBeNull();
  });

  it("shows truncation notice when markers exceed maxMarkers", () => {
    const markers: MapMarker[] = Array.from({ length: 210 }, (_, i) => ({
      id: String(i),
      lat: 20 + i * 0.01,
      lng: 78 + i * 0.01,
      label: `Location ${i}`,
    }));

    const { container } = render(<CivitasMap markers={markers} maxMarkers={200} />);
    const notice = container.querySelector('[role="status"]');
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toContain("200");
    expect(notice?.textContent).toContain("210");
  });

  it("respects custom maxMarkers prop", () => {
    const markers: MapMarker[] = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      lat: 20 + i,
      lng: 78 + i,
    }));

    const { container } = render(<CivitasMap markers={markers} maxMarkers={10} />);
    const notice = container.querySelector('[role="status"]');
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toContain("10");
    expect(notice?.textContent).toContain("15");
  });

  it("renders with custom height", () => {
    const { container } = render(<CivitasMap height="600px" />);
    const region = container.querySelector('[role="region"]');
    expect(region).toBeTruthy();
    expect((region as HTMLElement).style.height).toBe("600px");
  });

  it("applies custom className", () => {
    const { container } = render(<CivitasMap className="custom-map" />);
    const region = container.querySelector('[role="region"]');
    expect(region?.classList.contains("custom-map")).toBe(true);
  });

  it("iframe is keyboard focusable (tabIndex=0)", () => {
    render(<CivitasMap />);
    const iframe = screen.getByTitle("Interactive map showing locations");
    expect(iframe.getAttribute("tabindex")).toBe("0");
  });

  it("iframe sandboxed with allow-scripts only", () => {
    render(<CivitasMap />);
    const iframe = screen.getByTitle("Interactive map showing locations");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("handles marker click callback via postMessage", () => {
    const onMarkerClick = vi.fn();
    render(<CivitasMap onMarkerClick={onMarkerClick} />);

    // Simulate postMessage from iframe
    const event = new MessageEvent("message", {
      data: { type: "marker-click", marker: { id: "1", lat: 28.6, lng: 77.2, label: "Delhi" } },
    });
    window.dispatchEvent(event);

    expect(onMarkerClick).toHaveBeenCalledWith({
      id: "1",
      lat: 28.6,
      lng: 77.2,
      label: "Delhi",
    });
  });

  it("does not call onMarkerClick for unrelated messages", () => {
    const onMarkerClick = vi.fn();
    render(<CivitasMap onMarkerClick={onMarkerClick} />);

    const event = new MessageEvent("message", {
      data: { type: "something-else", value: 42 },
    });
    window.dispatchEvent(event);

    expect(onMarkerClick).not.toHaveBeenCalled();
  });
});
