"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";
import { confidenceBand } from "@/lib/bulkScan/status";
import type { ReviewPage } from "@/lib/bulkScan/types";
import {
  bboxPercent, clampPan, fitView, MAX_ZOOM, MIN_ZOOM, panByKey, panToReveal, rotateBy, zoomAt, zoomLabel, ZOOM_STEP,
  type PanDirection, type Size, type ViewState,
} from "@/lib/bulkScan/viewer";

const ARROWS: Record<string, PanDirection> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

interface Props {
  page: ReviewPage;
  pageCount: number;
  view: ViewState;
  onViewChange: (v: ViewState) => void;
  activeWord: number | null;
  onActiveWord: (i: number | null) => void;
  threshold: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  /** set by the workspace to ask the viewer to scroll a word into view (e.g. when a word is chosen in the text panel) */
  reveal: { index: number; seq: number } | null;
  /** incremented by the workspace to ask for a re-fit (keyboard `f` / `0`) */
  fitSeq: number;
  /** ask the workspace to re-read the review (re-signs the short-lived page image URL) */
  onRetryImage?: () => void;
}

/**
 * Page image with word-box overlay. Zoom / rotate / pan are driven by lib/bulkScan/viewer maths; the overlay boxes live inside
 * the same transformed element so they always follow the image. Keyboard: arrows pan while the viewer has focus; the
 * workspace owns +/-/r/0/[/] and friends.
 */
export function PageViewer({ page, pageCount, view, onViewChange, activeWord, onActiveWord, threshold, onPrevPage, onNextPage, reveal, fitSeq, onRetryImage }: Props) {
  const t = useTranslations("bulkScan");
  const box = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ w: 640, h: 560 });
  const [natural, setNatural] = useState<Size | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const helpId = useId();
  const fitted = useRef<number | null>(null);

  // The word boxes are in the page-image pixel space, so the image's own size is authoritative (the server's page extents are only the furthest word edge).
  const pageSize: Size = useMemo(() => natural ?? { w: Math.max(1, page.width), h: Math.max(1, page.height) }, [natural, page.width, page.height]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (): void => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setViewport({ w: r.width, h: r.height }); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setNatural(null); setImgFailed(false); fitted.current = null; }, [page.pageNumber, page.imageUrl]);

  // Fit the page once its size is known (and whenever the page changes).
  useEffect(() => {
    if (fitted.current === page.pageNumber) return;
    fitted.current = page.pageNumber;
    onViewChange(fitView(viewport, pageSize, view.rotation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.pageNumber, natural, viewport.w, viewport.h]);

  useEffect(() => {
    if (reveal === null) return;
    const w = page.words[reveal.index];
    if (w) onViewChange(clampPan(panToReveal(w.bbox, pageSize, view), pageSize, viewport));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq]);

  useEffect(() => {
    if (fitSeq > 0) onViewChange(fitView(viewport, pageSize, view.rotation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSeq]);

  const apply = (v: ViewState): void => onViewChange(clampPan(v, pageSize, viewport));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const dir = ARROWS[e.key];
    if (!dir || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    apply(panByKey(view, dir));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-word]")) return;
    drag.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d) apply({ ...view, panX: d.panX + (e.clientX - d.x), panY: d.panY + (e.clientY - d.y) });
  };
  const endDrag = (): void => { drag.current = null; };

  const words = useMemo(() => page.words.map((w, i) => ({ w, i, pct: bboxPercent(w.bbox, pageSize), band: confidenceBand(w.confidence, threshold) })), [page.words, pageSize, threshold]);

  return (
    <div>
      <div role="toolbar" aria-label={t("viewer.toolbar")} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <Button size="sm" variant="ghost" onClick={() => apply(zoomAt(view, 1 / ZOOM_STEP))} disabled={view.zoom <= MIN_ZOOM} aria-label={t("viewer.zoomOut")}>−</Button>
        <span role="status" aria-live="polite" aria-label={t("viewer.zoomLevel")} style={{ minWidth: 48, textAlign: "center" }}>{zoomLabel(view.zoom)}</span>
        <Button size="sm" variant="ghost" onClick={() => apply(zoomAt(view, ZOOM_STEP))} disabled={view.zoom >= MAX_ZOOM} aria-label={t("viewer.zoomIn")}>+</Button>
        <Button size="sm" variant="ghost" onClick={() => onViewChange(fitView(viewport, pageSize, view.rotation))}>{t("viewer.fit")}</Button>
        <Button size="sm" variant="ghost" onClick={() => apply({ ...view, rotation: rotateBy(view.rotation, -1) })} aria-label={t("viewer.rotateLeft")}>⟲</Button>
        <Button size="sm" variant="ghost" onClick={() => apply({ ...view, rotation: rotateBy(view.rotation, 1) })} aria-label={t("viewer.rotateRight")}>⟳</Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" onClick={onPrevPage} disabled={page.pageNumber <= 1} aria-label={t("viewer.prevPage")}>‹</Button>
        <span aria-live="polite">{t("viewer.pageOf", { page: page.pageNumber, total: pageCount })}</span>
        <Button size="sm" variant="ghost" onClick={onNextPage} disabled={page.pageNumber >= pageCount} aria-label={t("viewer.nextPage")}>›</Button>
      </div>
      {/* The page is a focusable group so the arrow keys can pan it; every pointer action has a keyboard equivalent (toolbar buttons and shortcuts). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div tabIndex={0}
        ref={box} role="group" aria-label={t("viewer.label", { page: page.pageNumber })} aria-describedby={helpId}
        onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); apply(zoomAt(view, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)); } }}
        style={{ position: "relative", direction: "ltr", overflow: "hidden", height: 560, background: "var(--line2)", border: "1px solid var(--line)", borderRadius: 8, touchAction: "none", cursor: drag.current ? "grabbing" : "grab" }}
      >
        <div
          style={{
            position: "absolute", insetInlineStart: "50%", top: "50%", width: pageSize.w, height: pageSize.h, background: "#fff",
            transform: `translate(calc(-50% + ${view.panX}px), calc(-50% + ${view.panY}px)) scale(${view.zoom}) rotate(${view.rotation}deg)`,
          }}
          data-testid="page-surface"
        >
          {page.imageUrl && !imgFailed ? (
            <img src={page.imageUrl} alt={t("viewer.pageAlt", { page: page.pageNumber })} draggable={false} width={pageSize.w} height={pageSize.h}
              onLoad={(e) => { const el = e.currentTarget; if (el.naturalWidth > 0) setNatural({ w: el.naturalWidth, h: el.naturalHeight }); }}
              onError={() => setImgFailed(true)}
              style={{ display: "block", width: "100%", height: "100%", userSelect: "none" }} />
          ) : (
            // Explicit, accessible state: the recognised text, fields and word list for this page remain available beside it.
            <div role="status" data-testid="no-image" style={{ padding: 24, color: "var(--ink)", fontSize: 16 }}>
              <strong><span aria-hidden="true">🖼 </span>{t("viewer.noImage")}</strong>
              <p style={{ margin: "8px 0" }}>{imgFailed ? t("viewer.imageFailed") : t("viewer.noImageHelp")}</p>
              {imgFailed && onRetryImage ? <button type="button" className="btn sm" onClick={onRetryImage}>{t("viewer.retryImage")}</button> : null}
            </div>
          )}
          {words.map(({ w, i, pct, band }) => (
            // Hover/click here is a pointer convenience; the same word is reachable by keyboard in the word list beside the page.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
            <div
              key={i} data-word={i} data-band={band} data-active={activeWord === i ? "true" : "false"} title={`${w.text} (${Math.round((w.confidence ?? 0) * 100)}%)`}
              onMouseEnter={() => onActiveWord(i)} onMouseLeave={() => onActiveWord(null)} onClick={() => onActiveWord(i)}
              style={{
                position: "absolute", insetInlineStart: `${pct.x}%`, top: `${pct.y}%`, width: `${pct.width}%`, height: `${pct.height}%`, boxSizing: "border-box",
                // Confidence is shown by line style as well as colour: solid = high, dashed = medium, dotted = low.
                border: `${activeWord === i ? 3 : 1}px ${band === "high" ? "solid" : band === "medium" ? "dashed" : "dotted"} ${band === "high" ? "var(--good)" : band === "medium" ? "var(--warn)" : "var(--bad)"}`,
                background: activeWord === i ? "rgba(23,92,211,.25)" : "transparent",
              }}
            />
          ))}
        </div>
      </div>
      <p id={helpId} style={{ fontSize: 12, margin: "6px 0 0", color: "var(--ink2)" }}>{t("viewer.help")}</p>
    </div>
  );
}
