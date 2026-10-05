"use client";

import { useCallback, useState } from "react";
import { downloadScannedDocument, type DownloadVariant, type RouteFailure } from "./download";

export interface ScannedDownloadFailure { documentId: string; fileName: string; variant: DownloadVariant; failure: RouteFailure }

/**
 * ONE download flow for every place a filed scanned document can be downloaded (HR, Finance, eOffice record tables and the
 * bulk-scan search view): busy state, the distinct failure (clearance denied / clearance unavailable / permission / not found /
 * generic) and a retry that repeats the same request. Render the failure with `ScannedDownloadAlert`.
 */
export function useScannedDownload() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<ScannedDownloadFailure | null>(null);

  const download = useCallback(async (documentId: string, fileName: string, variant: DownloadVariant = "original"): Promise<void> => {
    setBusyId(documentId);
    setFailure(null);
    const out = await downloadScannedDocument(documentId, variant, fileName);
    setBusyId(null);
    if (!out.ok) setFailure({ documentId, fileName, variant, failure: out.failure });
  }, []);

  const retry = useCallback((): void => {
    if (failure) void download(failure.documentId, failure.fileName, failure.variant);
  }, [failure, download]);

  return { busyId, failure, download, retry };
}
