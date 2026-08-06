/**
 * G10 — Account Health Score: pure domain logic.
 *
 * Computes a composite health score (0-100) from individual signal scores
 * weighted by tenant-configurable weights, with time-decay applied to each
 * signal based on its age and the configured decay_days.
 */

export interface SignalInput {
  /** Signal name matching a config entry */
  name: string;
  /** Raw score for this signal (0-100) */
  value: number;
  /** When the signal was last observed */
  recordedAt: Date;
}

export interface SignalConfig {
  signalName: string;
  weight: number;
  decayDays: number;
  enabled: boolean;
}

/**
 * Apply exponential decay to a signal value based on how old it is.
 *
 * Uses a half-life model: the signal loses half its value every `decayDays`.
 * At t=0 → full value; at t=decayDays → 50%; at t=2*decayDays → 25%.
 *
 * @param value - The raw signal score (0-100)
 * @param ageInDays - How many days since the signal was recorded
 * @param decayDays - The half-life in days (signal halves every decayDays)
 * @returns Decayed value (0-100 range, may be fractional)
 */
export function decaySignal(value: number, ageInDays: number, decayDays: number): number {
  if (value <= 0) return 0;
  if (ageInDays <= 0) return value;
  if (decayDays <= 0) return 0;

  // Exponential half-life decay: value * 0.5^(age/halfLife)
  const decayFactor = Math.pow(0.5, ageInDays / decayDays);
  return value * decayFactor;
}

/**
 * Compute the composite health score from signal inputs and their configurations.
 *
 * Algorithm:
 * 1. For each enabled config, find the matching signal input
 * 2. Apply time-decay to the signal value
 * 3. Compute weighted average: sum(decayed_value * weight) / sum(weights)
 * 4. Clamp result to integer 0-100
 *
 * Missing signals are gracefully skipped (they contribute 0 to the numerator
 * but their weight is still excluded from the denominator).
 *
 * @param signals - Array of signal observations
 * @param configs - Array of tenant signal configurations
 * @param now - Reference time for decay calculation (defaults to current time)
 * @returns Integer score 0-100
 */
export function computeHealthScore(
  signals: SignalInput[],
  configs: SignalConfig[],
  now: Date = new Date(),
): number {
  const enabledConfigs = configs.filter((c) => c.enabled);

  if (enabledConfigs.length === 0) return 0;

  const totalWeight = enabledConfigs.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;

  // Build a map of signal name → input for O(1) lookup
  const signalMap = new Map<string, SignalInput>();
  for (const s of signals) {
    signalMap.set(s.name, s);
  }

  let weightedSum = 0;
  let activeWeight = 0;

  for (const config of enabledConfigs) {
    const signal = signalMap.get(config.signalName);
    if (!signal) continue; // signal not provided — skip

    const ageMs = now.getTime() - signal.recordedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    const decayed = decaySignal(signal.value, ageDays, config.decayDays);
    weightedSum += decayed * config.weight;
    activeWeight += config.weight;
  }

  if (activeWeight === 0) return 0;

  const raw = weightedSum / activeWeight;
  return Math.round(Math.min(100, Math.max(0, raw)));
}
