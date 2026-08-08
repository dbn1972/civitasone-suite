/**
 * HRMS Pack #35 — Face Verification: cosine similarity + pipeline logic.
 *
 * Source: modules/face-verification/engine.ts
 */
import { describe, it, expect } from "vitest";
import { cosineSimilarity, verifyFace, type FaceConfig } from "../src/modules/face-verification/engine.js";

describe("cosineSimilarity — embedding comparison", () => {
  it("identical vectors return 1.0", () => {
    const v = [0.5, 0.3, 0.8, 0.1];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("orthogonal vectors return 0.5 (normalized from cosine 0)", () => {
    // Unit vectors along different axes
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    // Cosine = 0, normalized = (0+1)/2 = 0.5
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.5, 5);
  });

  it("opposite vectors return 0 (normalized from cosine -1)", () => {
    const v1 = [1, 0, 0];
    const v2 = [-1, 0, 0];
    // Cosine = -1, normalized = (-1+1)/2 = 0
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
  });

  it("similar vectors have high similarity", () => {
    const v1 = [0.9, 0.1, 0.3, 0.5];
    const v2 = [0.85, 0.15, 0.28, 0.52];
    expect(cosineSimilarity(v1, v2)).toBeGreaterThan(0.95);
  });

  it("zero vector returns 0 (prevents NaN)", () => {
    const zero = [0, 0, 0];
    const v = [1, 2, 3];
    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(cosineSimilarity(v, zero)).toBe(0);
  });

  it("works with Float32Array", () => {
    const v1 = new Float32Array([0.5, 0.3, 0.8]);
    const v2 = new Float32Array([0.5, 0.3, 0.8]);
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 4);
  });

  it("returns value between 0 and 1", () => {
    const v1 = [Math.random(), Math.random(), Math.random()];
    const v2 = [Math.random(), Math.random(), Math.random()];
    const sim = cosineSimilarity(v1, v2);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

describe("verifyFace — pipeline logic", () => {
  const bypassConfig: FaceConfig = {
    onnxEnabled: false,
    onnxThreshold: 0.75,
    rekognitionEnabled: false,
    rekognitionThreshold: 0.70,
    requireFaceMatch: false,
    allowManualOverride: true,
  };

  const strictConfig: FaceConfig = {
    onnxEnabled: true,
    onnxThreshold: 0.75,
    rekognitionEnabled: true,
    rekognitionThreshold: 0.70,
    requireFaceMatch: true,
    allowManualOverride: false,
  };

  it("bypasses verification when requireFaceMatch=false", async () => {
    const result = await verifyFace("selfie.jpg", "profile.jpg", null, bypassConfig);
    expect(result.isMatch).toBe(true);
    expect(result.method).toBe("bypassed");
    expect(result.finalScore).toBe(1);
  });

  it("falls through to failure when both ONNX and Rekognition unavailable", async () => {
    const config: FaceConfig = {
      onnxEnabled: false,
      onnxThreshold: 0.75,
      rekognitionEnabled: false,
      rekognitionThreshold: 0.70,
      requireFaceMatch: true,
      allowManualOverride: false,
    };
    const result = await verifyFace("selfie.jpg", "profile.jpg", null, config);
    expect(result.isMatch).toBe(false);
    expect(result.failureReason).toContain("No face verification method available");
  });

  it("has correct structure in result", async () => {
    const result = await verifyFace("selfie.jpg", "profile.jpg", [0.1, 0.2, 0.3], strictConfig);
    expect(result).toHaveProperty("isMatch");
    expect(result).toHaveProperty("method");
    expect(result).toHaveProperty("onnxScore");
    expect(result).toHaveProperty("rekognitionScore");
    expect(result).toHaveProperty("finalScore");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("processingMs");
    expect(typeof result.processingMs).toBe("number");
  });
});
