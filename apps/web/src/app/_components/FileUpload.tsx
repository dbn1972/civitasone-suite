"use client";

import React, { useState, useRef, useCallback } from "react";

interface FileUploadProps {
  accept?: string;
  maxSizeMB?: number;
  onUpload?: (file: File) => void;
  label?: string;
}

export function FileUpload({
  accept,
  maxSizeMB = 10,
  onUpload,
  label = "Upload File",
}: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (f: File) => {
      setError(null);
      if (maxSizeMB && f.size > maxSizeMB * 1024 * 1024) {
        setError(`File exceeds ${maxSizeMB}MB limit`);
        return;
      }
      setFile(f);
      setUploading(true);
      setProgress(0);

      // Simulate upload progress
      let p = 0;
      const interval = setInterval(() => {
        p += Math.random() * 30;
        if (p >= 100) {
          p = 100;
          clearInterval(interval);
          setUploading(false);
          onUpload?.(f);
        }
        setProgress(Math.min(p, 100));
      }, 200);
    },
    [maxSizeMB, onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const remove = () => {
    setFile(null);
    setProgress(0);
    setUploading(false);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{ width: "100%" }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 4, display: "block" }}>
        {label}
      </label>

      {!file ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "#4f46e5" : "#d1d5db"}`,
            borderRadius: 8,
            padding: "32px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "#eef2ff" : "#f9fafb",
            transition: "all 0.2s",
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
            Drag & drop a file here, or <span style={{ color: "#4f46e5", fontWeight: 500 }}>browse</span>
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>
            Max {maxSizeMB}MB{accept ? ` • ${accept}` : ""}
          </p>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 12,
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#1f2937" }}>{file.name}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{formatSize(file.size)}</div>
              </div>
            </div>
            <button
              onClick={remove}
              type="button"
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 16,
                color: "#ef4444",
                padding: 4,
              }}
              title="Remove file"
            >
              ✕
            </button>
          </div>
          {uploading && (
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: "#e5e7eb",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background: "#4f46e5",
                    borderRadius: 2,
                    transition: "width 0.2s",
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                {progress.toFixed(0)}% uploaded
              </div>
            </div>
          )}
          {!uploading && progress >= 100 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#10b981", fontWeight: 500 }}>
              ✓ Upload complete
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 4, fontSize: 12, color: "#ef4444" }}>{error}</div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: "none" }}
      />
    </div>
  );
}
