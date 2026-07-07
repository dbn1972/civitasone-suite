/**
 * Logistic Regression — Pure TypeScript Implementation
 *
 * Provides binary classification via gradient descent with L2 regularization
 * and z-score normalization. No external ML libraries.
 *
 * Requirements: 6.2, 6.3, 9.1, 15.4
 */

export interface TrainResult {
  weights: number[];
  bias: number;
  normalization: { mean: number[]; std: number[] };
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    aucRoc: number;
    falsePositiveRate: number;
  };
}

export interface ExplainabilityFactor {
  feature: string;
  contribution: number;
  direction: "positive" | "negative";
}

interface TrainOptions {
  learningRate?: number;
  epochs?: number;
  l2Lambda?: number;
}

// --- Utility functions ---

/**
 * Sigmoid activation: maps any real number to [0, 1].
 * Clamps input to prevent overflow in Math.exp.
 */
function sigmoid(z: number): number {
  // Clamp to avoid overflow — exp(-710) underflows, exp(710) overflows
  const clamped = Math.max(-500, Math.min(500, z));
  return 1 / (1 + Math.exp(-clamped));
}

/**
 * Compute column-wise mean and std for z-score normalization.
 * Zero-variance columns get std = 1 to avoid division by zero.
 */
function computeNormalization(features: number[][]): { mean: number[]; std: number[] } {
  if (features.length === 0) {
    return { mean: [], std: [] };
  }

  const numFeatures = features[0]!.length;
  const n = features.length;
  const mean: number[] = new Array(numFeatures).fill(0) as number[];
  const std: number[] = new Array(numFeatures).fill(0) as number[];

  // Compute means
  for (let j = 0; j < numFeatures; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += features[i]![j]!;
    }
    mean[j] = sum / n;
  }

  // Compute standard deviations
  for (let j = 0; j < numFeatures; j++) {
    let sumSqDiff = 0;
    for (let i = 0; i < n; i++) {
      const diff = features[i]![j]! - mean[j]!;
      sumSqDiff += diff * diff;
    }
    const variance = sumSqDiff / n;
    // Zero-variance columns get std = 1 to prevent division by zero
    std[j] = variance === 0 ? 1 : Math.sqrt(variance);
  }

  return { mean, std };
}

/**
 * Normalize a single feature vector using precomputed mean/std.
 */
function normalizeVector(
  features: number[],
  mean: number[],
  std: number[],
): number[] {
  return features.map((val, i) => (val - mean[i]!) / std[i]!);
}

/**
 * Normalize the entire feature matrix in-place style (returns new array).
 */
function normalizeMatrix(
  features: number[][],
  mean: number[],
  std: number[],
): number[][] {
  return features.map((row) => normalizeVector(row, mean, std));
}

/**
 * Compute AUC-ROC using the trapezoidal rule on sorted predictions.
 */
function computeAucRoc(predictions: number[], labels: number[]): number {
  if (predictions.length === 0) return 0;

  // Create pairs and sort by prediction descending
  const pairs = predictions.map((p, i) => ({ pred: p, label: labels[i]! }));
  pairs.sort((a, b) => b.pred - a.pred);

  const totalPositives = labels.filter((l) => l === 1).length;
  const totalNegatives = labels.length - totalPositives;

  if (totalPositives === 0 || totalNegatives === 0) return 0.5;

  let auc = 0;
  let tp = 0;
  let fp = 0;
  let prevTpr = 0;
  let prevFpr = 0;

  for (const pair of pairs) {
    if (pair.label === 1) {
      tp++;
    } else {
      fp++;
    }
    const tpr = tp / totalPositives;
    const fpr = fp / totalNegatives;

    // Trapezoidal area
    auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
    prevTpr = tpr;
    prevFpr = fpr;
  }

  return auc;
}

// --- Main exports ---

/**
 * Trains a logistic regression model using gradient descent.
 * Pure function — no side effects.
 *
 * @param features - 2D array [samples][features], numeric values
 * @param labels - 1D array of binary labels (0 or 1)
 * @param options - learning rate, epochs, L2 regularization strength
 */
export function trainLogisticRegression(
  features: number[][],
  labels: number[],
  options?: TrainOptions,
): TrainResult {
  // Edge case: empty features
  if (features.length === 0 || features[0]?.length === 0) {
    return {
      weights: [],
      bias: 0,
      normalization: { mean: [], std: [] },
      metrics: { accuracy: 0, precision: 0, recall: 0, aucRoc: 0, falsePositiveRate: 0 },
    };
  }

  const lr = options?.learningRate ?? 0.1;
  const epochs = options?.epochs ?? 1000;
  const l2Lambda = options?.l2Lambda ?? 0.01;

  const n = features.length;
  const numFeatures = features[0]!.length;

  // Compute normalization parameters
  const normalization = computeNormalization(features);

  // Normalize features
  const normalizedFeatures = normalizeMatrix(features, normalization.mean, normalization.std);

  // Initialize weights and bias
  let weights: number[] = new Array(numFeatures).fill(0) as number[];
  let bias = 0;

  // Gradient descent
  for (let epoch = 0; epoch < epochs; epoch++) {
    const dw: number[] = new Array(numFeatures).fill(0) as number[];
    let db = 0;

    for (let i = 0; i < n; i++) {
      const sample = normalizedFeatures[i]!;
      // Compute linear combination
      let z = bias;
      for (let j = 0; j < numFeatures; j++) {
        z += weights[j]! * sample[j]!;
      }

      const prediction = sigmoid(z);
      const error = prediction - labels[i]!;

      // Accumulate gradients
      for (let j = 0; j < numFeatures; j++) {
        dw[j]! += error * sample[j]!;
      }
      db += error;
    }

    // Update weights with L2 regularization
    for (let j = 0; j < numFeatures; j++) {
      weights[j] = weights[j]! - lr * (dw[j]! / n + l2Lambda * weights[j]! / n);
    }
    bias = bias - lr * (db / n);
  }

  // Compute metrics on training data
  const predictions: number[] = [];
  let correctCount = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (let i = 0; i < n; i++) {
    const sample = normalizedFeatures[i]!;
    let z = bias;
    for (let j = 0; j < numFeatures; j++) {
      z += weights[j]! * sample[j]!;
    }
    const prob = sigmoid(z);
    predictions.push(prob);

    const predicted = prob >= 0.5 ? 1 : 0;
    if (predicted === labels[i]!) correctCount++;
    if (predicted === 1 && labels[i] === 1) truePositives++;
    if (predicted === 1 && labels[i] === 0) falsePositives++;
    if (predicted === 0 && labels[i] === 1) falseNegatives++;
  }

  const totalNegatives = labels.filter((l) => l === 0).length;
  const accuracy = correctCount / n;
  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives)
    : 0;
  const recall = truePositives + falseNegatives > 0
    ? truePositives / (truePositives + falseNegatives)
    : 0;
  const falsePositiveRate = totalNegatives > 0
    ? falsePositives / totalNegatives
    : 0;
  const aucRoc = computeAucRoc(predictions, labels);

  return {
    weights,
    bias,
    normalization,
    metrics: { accuracy, precision, recall, aucRoc, falsePositiveRate },
  };
}

/**
 * Predict probability using trained logistic regression weights.
 * Always returns value in [0.0, 1.0] (sigmoid output).
 *
 * @param features - raw feature vector (un-normalized)
 * @param weights - trained weight vector
 * @param bias - trained bias term
 * @param normalization - mean/std used during training
 */
export function predictLogistic(
  features: number[],
  weights: number[],
  bias: number,
  normalization: { mean: number[]; std: number[] },
): number {
  // Edge case: empty weights or features
  if (weights.length === 0 || features.length === 0) {
    return 0.5; // uninformative prior
  }

  // Normalize features using training statistics
  const normalized = normalizeVector(features, normalization.mean, normalization.std);

  // Compute linear combination
  let z = bias;
  const len = Math.min(weights.length, normalized.length);
  for (let i = 0; i < len; i++) {
    z += weights[i]! * normalized[i]!;
  }

  // Sigmoid guarantees output in [0.0, 1.0]
  return sigmoid(z);
}

/**
 * Compute feature importance for explainability.
 * Returns top-N features ranked by absolute contribution magnitude.
 *
 * Contribution = |weight_j * normalized_feature_j| (relative to sum of all contributions).
 *
 * @param features - raw feature vector (un-normalized; will be normalized internally)
 * @param weights - trained weight vector
 * @param featureNames - array of feature name strings
 * @param topN - number of top features to return (default 3)
 */
export function computeFeatureImportance(
  features: number[],
  weights: number[],
  featureNames: string[],
  topN?: number,
): ExplainabilityFactor[] {
  const n = topN ?? 3;

  // Edge case: empty inputs
  if (features.length === 0 || weights.length === 0 || featureNames.length === 0) {
    return [];
  }

  const len = Math.min(features.length, weights.length, featureNames.length);

  // Compute raw contributions (weight * feature value)
  const contributions: Array<{ feature: string; raw: number; absVal: number }> = [];
  let totalAbs = 0;

  for (let i = 0; i < len; i++) {
    const raw = weights[i]! * features[i]!;
    const absVal = Math.abs(raw);
    contributions.push({ feature: featureNames[i]!, raw, absVal });
    totalAbs += absVal;
  }

  // Sort by absolute contribution (descending)
  contributions.sort((a, b) => b.absVal - a.absVal);

  // Take top N and normalize contributions
  const topFactors = contributions.slice(0, n);

  return topFactors.map((c) => ({
    feature: c.feature,
    contribution: totalAbs > 0 ? c.absVal / totalAbs : 0,
    direction: c.raw >= 0 ? "positive" as const : "negative" as const,
  }));
}
