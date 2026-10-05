import { describe, it, expect } from "vitest";
import {
  bboxPercent, bboxToViewport, clampPan, clampZoom, fitView, fitZoom, INITIAL_VIEW, MAX_ZOOM, MIN_ZOOM, panByKey, panToReveal, rotateBBox, rotatedSize,
  rotateBy, rotateVector, zoomAt, zoomLabel, type ViewState,
} from "./viewer";

const PAGE = { w: 1000, h: 500 };

describe("rotation", () => {
  it("steps in 90 degree increments both ways and wraps", () => {
    expect(rotateBy(0, 1)).toBe(90);
    expect(rotateBy(270, 1)).toBe(0);
    expect(rotateBy(0, -1)).toBe(270);
    expect(rotateBy(90, 4)).toBe(90);
  });
  it("swaps page size for 90 and 270", () => {
    expect(rotatedSize(PAGE, 0)).toEqual(PAGE);
    expect(rotatedSize(PAGE, 90)).toEqual({ w: 500, h: 1000 });
    expect(rotatedSize(PAGE, 270)).toEqual({ w: 500, h: 1000 });
    expect(rotatedSize(PAGE, 180)).toEqual(PAGE);
  });
  it("rotates vectors clockwise in screen space", () => {
    expect(rotateVector(1, 0, 90)).toEqual({ x: -0, y: 1 });
    expect(rotateVector(1, 0, 180)).toEqual({ x: -1, y: -0 });
    expect(rotateVector(1, 0, 270)).toEqual({ x: 0, y: -1 });
  });
  it("rotates bbox coordinates into the rotated page", () => {
    const box = { x0: 100, y0: 50, x1: 300, y1: 100 };
    expect(rotateBBox(box, PAGE, 0)).toEqual(box);
    // 90 deg cw on a 1000x500 page -> 500x1000: (x,y) -> (h - y, x)
    expect(rotateBBox(box, PAGE, 90)).toEqual({ x0: 400, y0: 100, x1: 450, y1: 300 });
    // 180: (x,y) -> (w - x, h - y)
    expect(rotateBBox(box, PAGE, 180)).toEqual({ x0: 700, y0: 400, x1: 900, y1: 450 });
    // 270: (x,y) -> (y, w - x)
    expect(rotateBBox(box, PAGE, 270)).toEqual({ x0: 50, y0: 700, x1: 100, y1: 900 });
  });
  it("four quarter turns bring a box back", () => {
    let box = { x0: 10, y0: 20, x1: 60, y1: 80 };
    let size = PAGE;
    for (let i = 0; i < 4; i++) { box = rotateBBox(box, size, 90); size = rotatedSize(size, 90); }
    expect(box).toEqual({ x0: 10, y0: 20, x1: 60, y1: 80 });
  });
});

describe("zoom, fit and pan", () => {
  it("clamps zoom", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
  });
  it("fits the rotated page into the viewport", () => {
    expect(fitZoom({ w: 532, h: 532 }, PAGE, 0, 16)).toBeCloseTo(0.5);
    // rotated 90: page is 500 wide x 1000 tall, so height is the limit
    expect(fitZoom({ w: 532, h: 532 }, PAGE, 90, 16)).toBeCloseTo(0.5);
    expect(fitView({ w: 1032, h: 532 }, PAGE, 0)).toEqual({ zoom: 1, rotation: 0, panX: 0, panY: 0 });
  });
  it("zooms about an anchor so the point under the cursor stays put", () => {
    const v: ViewState = { zoom: 1, rotation: 0, panX: 0, panY: 0 };
    const z = zoomAt(v, 2, { x: 100, y: 0 });
    expect(z.zoom).toBe(2);
    expect(z.panX).toBe(-100);
    expect(zoomAt(v, 2).panX).toBe(0);
  });
  it("arrow keys move the content the way the arrow points to more content", () => {
    expect(panByKey(INITIAL_VIEW, "right").panX).toBe(-60);
    expect(panByKey(INITIAL_VIEW, "left").panX).toBe(60);
    expect(panByKey(INITIAL_VIEW, "down").panY).toBe(-60);
    expect(panByKey(INITIAL_VIEW, "up", 10).panY).toBe(10);
  });
  it("clamps panning so part of the page always stays visible", () => {
    const v = clampPan({ ...INITIAL_VIEW, panX: 99999, panY: -99999 }, PAGE, { w: 600, h: 400 });
    expect(v.panX).toBe(500 + 300 - 48);
    expect(v.panY).toBe(-(250 + 200 - 48));
  });
  it("labels zoom as a percentage", () => { expect(zoomLabel(1.25)).toBe("125%"); });
});

describe("bbox to viewport", () => {
  const viewport = { w: 1000, h: 500 };
  it("maps a page box to screen pixels at zoom 1, no rotation (page fills the viewport)", () => {
    expect(bboxToViewport({ x0: 100, y0: 50, x1: 300, y1: 100 }, PAGE, INITIAL_VIEW, viewport)).toEqual({ x0: 100, y0: 50, x1: 300, y1: 100 });
  });
  it("applies zoom about the page centre and pan", () => {
    const r = bboxToViewport({ x0: 500, y0: 250, x1: 600, y1: 300 }, PAGE, { ...INITIAL_VIEW, zoom: 2, panX: 10, panY: -5 }, viewport);
    expect(r).toEqual({ x0: 510, y0: 245, x1: 710, y1: 345 });
  });
  it("applies rotation to the box", () => {
    const v = { ...INITIAL_VIEW, rotation: 90 as const };
    // rotated page is 500x1000 centred in a 1000x500 viewport: origin x = 250, y = -250
    expect(bboxToViewport({ x0: 100, y0: 50, x1: 300, y1: 100 }, PAGE, v, viewport)).toEqual({ x0: 250 + 400, y0: -250 + 100, x1: 250 + 450, y1: -250 + 300 });
  });
  it("panToReveal centres a word, rotation aware", () => {
    const box = { x0: 100, y0: 50, x1: 300, y1: 100 };
    const v = panToReveal(box, PAGE, INITIAL_VIEW);
    const r = bboxToViewport(box, PAGE, v, viewport);
    expect((r.x0 + r.x1) / 2).toBeCloseTo(500);
    expect((r.y0 + r.y1) / 2).toBeCloseTo(250);
    const v90 = panToReveal(box, PAGE, { ...INITIAL_VIEW, rotation: 90, zoom: 2 });
    const r90 = bboxToViewport(box, PAGE, v90, viewport);
    expect((r90.x0 + r90.x1) / 2).toBeCloseTo(500);
    expect((r90.y0 + r90.y1) / 2).toBeCloseTo(250);
  });
  it("percent boxes for the overlay are relative to the unrotated page", () => {
    expect(bboxPercent({ x0: 100, y0: 50, x1: 300, y1: 100 }, PAGE)).toEqual({ x: 10, y: 10, width: 20, height: 10 });
  });
});
