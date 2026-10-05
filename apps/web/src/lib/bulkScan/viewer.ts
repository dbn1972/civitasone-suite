/**
 * Page-image viewer geometry: zoom, rotation (90 degree steps), pan and word-box transforms. Pure maths so the
 * keyboard- and pointer-driven viewer is fully unit-testable.
 *
 * Model: the page (w x h, in page pixels) sits centred in the viewport. The view is { zoom, rotation (0|90|180|270
 * clockwise), panX, panY (screen px) }. A page point maps to the screen as:
 *   centre-relative offset (dx, dy) -> rotate clockwise by `rotation` -> scale by `zoom` -> + pan -> + viewport centre.
 */
import type { BBox } from "./types";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;
export const PAN_STEP_PX = 60;

export type Rotation = 0 | 90 | 180 | 270;

export interface ViewState {
  zoom: number;
  rotation: Rotation;
  panX: number;
  panY: number;
}
export interface Size { w: number; h: number }

export const INITIAL_VIEW: ViewState = { zoom: 1, rotation: 0, panX: 0, panY: 0 };

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Size of the page after rotation (90/270 swap width and height). */
export function rotatedSize(page: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270 ? { w: page.h, h: page.w } : { w: page.w, h: page.h };
}

/** Next rotation, `steps` x 90 degrees clockwise (negative = counter-clockwise). */
export function rotateBy(rotation: Rotation, steps: number): Rotation {
  const deg = (((rotation + steps * 90) % 360) + 360) % 360;
  return deg as Rotation;
}

/** Largest zoom at which the whole (rotated) page fits the viewport, minus `padding` px on each side. */
export function fitZoom(viewport: Size, page: Size, rotation: Rotation, padding = 16): number {
  const r = rotatedSize(page, rotation);
  if (r.w <= 0 || r.h <= 0) return 1;
  const z = Math.min(Math.max(1, viewport.w - padding * 2) / r.w, Math.max(1, viewport.h - padding * 2) / r.h);
  return clampZoom(z);
}

export function fitView(viewport: Size, page: Size, rotation: Rotation): ViewState {
  return { zoom: fitZoom(viewport, page, rotation), rotation, panX: 0, panY: 0 };
}

/** Zoom by `factor` keeping the screen point `anchor` (relative to the viewport centre) fixed. */
export function zoomAt(view: ViewState, factor: number, anchor: { x: number; y: number } = { x: 0, y: 0 }): ViewState {
  const zoom = clampZoom(view.zoom * factor);
  const k = zoom / view.zoom;
  return { ...view, zoom, panX: anchor.x - (anchor.x - view.panX) * k, panY: anchor.y - (anchor.y - view.panY) * k };
}

/** Rotate a page-space vector (dx, dy) clockwise (screen coordinates, y down). */
export function rotateVector(dx: number, dy: number, rotation: Rotation): { x: number; y: number } {
  switch (rotation) {
    case 90: return { x: -dy, y: dx };
    case 180: return { x: -dx, y: -dy };
    case 270: return { x: dy, y: -dx };
    default: return { x: dx, y: dy };
  }
}

/**
 * A word/field box expressed in the coordinates of the ROTATED page (origin top-left of the rotated page, size
 * rotatedSize(page, rotation)). Rotation 0 returns the box unchanged.
 */
export function rotateBBox(b: BBox, page: Size, rotation: Rotation): BBox {
  const cx = page.w / 2;
  const cy = page.h / 2;
  const rs = rotatedSize(page, rotation);
  const corners = [
    rotateVector(b.x0 - cx, b.y0 - cy, rotation), rotateVector(b.x1 - cx, b.y0 - cy, rotation),
    rotateVector(b.x0 - cx, b.y1 - cy, rotation), rotateVector(b.x1 - cx, b.y1 - cy, rotation),
  ];
  const xs = corners.map((c) => c.x + rs.w / 2);
  const ys = corners.map((c) => c.y + rs.h / 2);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Screen rectangle (relative to the viewport's top-left) of a page-space box under `view`. */
export function bboxToViewport(b: BBox, page: Size, view: ViewState, viewport: Size): BBox {
  const r = rotateBBox(b, page, view.rotation);
  const rs = rotatedSize(page, view.rotation);
  const ox = viewport.w / 2 + view.panX - (rs.w / 2) * view.zoom;
  const oy = viewport.h / 2 + view.panY - (rs.h / 2) * view.zoom;
  return { x0: ox + r.x0 * view.zoom, y0: oy + r.y0 * view.zoom, x1: ox + r.x1 * view.zoom, y1: oy + r.y1 * view.zoom };
}

/** New pan that centres a page-space box in the viewport at the current zoom/rotation. */
export function panToReveal(b: BBox, page: Size, view: ViewState): ViewState {
  const r = rotateBBox(b, page, view.rotation);
  const rs = rotatedSize(page, view.rotation);
  const cx = (r.x0 + r.x1) / 2 - rs.w / 2;
  const cy = (r.y0 + r.y1) / 2 - rs.h / 2;
  return { ...view, panX: -cx * view.zoom, panY: -cy * view.zoom };
}

/** Keep the page from being dragged completely out of the viewport (at least `keep` px stays visible). */
export function clampPan(view: ViewState, page: Size, viewport: Size, keep = 48): ViewState {
  const rs = rotatedSize(page, view.rotation);
  const maxX = (rs.w * view.zoom) / 2 + viewport.w / 2 - keep;
  const maxY = (rs.h * view.zoom) / 2 + viewport.h / 2 - keep;
  return { ...view, panX: Math.min(maxX, Math.max(-maxX, view.panX)), panY: Math.min(maxY, Math.max(-maxY, view.panY)) };
}

export type PanDirection = "left" | "right" | "up" | "down";
/** Arrow keys move the VIEW (content follows the arrow's direction: ArrowRight shows more of the right side). */
export function panByKey(view: ViewState, dir: PanDirection, step = PAN_STEP_PX): ViewState {
  switch (dir) {
    case "left": return { ...view, panX: view.panX + step };
    case "right": return { ...view, panX: view.panX - step };
    case "up": return { ...view, panY: view.panY + step };
    case "down": return { ...view, panY: view.panY - step };
  }
}

/** Percent box (0..100 of the UNROTATED page) used to position the overlay inside the page element, which is itself transformed. */
export function bboxPercent(b: BBox, page: Size): { x: number; y: number; width: number; height: number } {
  return { x: (b.x0 / page.w) * 100, y: (b.y0 / page.h) * 100, width: ((b.x1 - b.x0) / page.w) * 100, height: ((b.y1 - b.y0) / page.h) * 100 };
}

export const zoomLabel = (z: number): string => `${Math.round(z * 100)}%`;
