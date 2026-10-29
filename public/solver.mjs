export const QUOTE_SCALE = 100;
export const MIN_QUOTE_TICKS = 11;
export const DEFAULT_RECOMMENDATION_POLICY = Object.freeze({
  minimumPriority: 60,
  stepTicks: 1,
  maximumSearchPriority: 95,
});

function nextGridTicks(rate) {
  if (!Number.isFinite(rate) || rate < 0) throw Error('invalid_rate');
  let ticks = Math.floor(rate * QUOTE_SCALE) + 1;
  if (!Number.isSafeInteger(ticks)) throw Error('unsupported_rate');
  while (ticks / QUOTE_SCALE <= rate) ticks++;
  while (ticks > 0 && (ticks - 1) / QUOTE_SCALE > rate) ticks--;
  return ticks;
}

export function nextQuoteTicks(rate) {
  return Math.max(MIN_QUOTE_TICKS, nextGridTicks(rate));
}

export function buildDistribution(transactions) {
  const buckets = new Map();
  for (const tx of transactions) {
    if (!Number.isFinite(tx.rate) || tx.rate < 0 || !Number.isSafeInteger(tx.weight) || tx.weight <= 0) throw Error('invalid_transaction');
    buckets.set(tx.rate, (buckets.get(tx.rate) || 0) + tx.weight);
  }
  let cumulativeWeight = 0;
  const groups = [...buckets].sort((a, b) => a[0] - b[0]).map(([rate, weight]) => {
    const before = cumulativeWeight;
    cumulativeWeight += weight;
    return { rate, weight, before, after: cumulativeWeight };
  });
  if (!groups.length || !Number.isSafeInteger(cumulativeWeight)) return null;
  const totalWeight = cumulativeWeight;
  const ticks = [...new Set([MIN_QUOTE_TICKS, ...groups.map(g => nextQuoteTicks(g.rate))])].sort((a, b) => a - b);
  let groupIndex = 0, belowWeight = 0;
  const quotes = ticks.map(ticks => {
    const feeRate = ticks / QUOTE_SCALE;
    while (groupIndex < groups.length && groups[groupIndex].rate < feeRate) belowWeight += groups[groupIndex++].weight;
    return { ticks, feeRate, belowWeight, priority: 100 * belowWeight / totalWeight };
  });
  return { groups, quotes, totalWeight, transactionCount: transactions.length };
}

export function minimumForPriority(distribution, target) {
  if (!distribution || !Number.isFinite(target) || target < 0 || target > 100) return null;
  return distribution.quotes.find(q => q.belowWeight * 100 >= target * distribution.totalWeight) || null;
}

export function recommendRate(distribution, overrides = {}) {
  if (!distribution) return null;
  const policy = { ...DEFAULT_RECOMMENDATION_POLICY, ...overrides };
  if (!Number.isFinite(policy.maximumSearchPriority) || policy.maximumSearchPriority <= 0 || policy.maximumSearchPriority > 100
    || !Number.isFinite(policy.minimumPriority) || policy.minimumPriority < 0 || policy.minimumPriority > policy.maximumSearchPriority
    || !Number.isSafeInteger(policy.stepTicks) || policy.stepTicks < 1 || policy.stepTicks >= MIN_QUOTE_TICKS) throw Error('invalid_recommendation_policy');
  const baseline = minimumForPriority(distribution, policy.minimumPriority);
  if (!baseline) return null;
  const searchLimit = minimumForPriority(distribution, policy.maximumSearchPriority);
  // Eligibility applies to the END quote. Include the step that first reaches
  // the priority requirement instead of searching only after the baseline.
  const curve = marginalCurve(distribution, policy.stepTicks, baseline.ticks - policy.stepTicks, searchLimit.ticks - policy.stepTicks);
  const recommended = curve.peak ? curve.peak.end : baseline;
  return {
    policy, baseline, searchLimit, recommended, marginal: curve,
    reason: curve.peak ? 'marginal_peak' : 'no_gain',
  };
}

export function recommendCumulative(distribution, overrides = {}) {
  if (!distribution) return null;
  const { minimumPriority = DEFAULT_RECOMMENDATION_POLICY.minimumPriority,
    maximumSearchPriority = DEFAULT_RECOMMENDATION_POLICY.maximumSearchPriority } = overrides;
  if (!Number.isFinite(maximumSearchPriority) || maximumSearchPriority <= 0 || maximumSearchPriority > 100
    || !Number.isFinite(minimumPriority) || minimumPriority < 0 || minimumPriority > maximumSearchPriority) throw Error('invalid_cumulative_policy');
  const baseline = minimumForPriority(distribution, minimumPriority);
  const searchLimit = minimumForPriority(distribution, maximumSearchPriority);
  const candidates = [];
  let peak = null;
  for (const quote of distribution.quotes) {
    if (quote.ticks <= baseline.ticks) continue;
    if (quote.ticks > searchLimit.ticks) break;
    const extraTicks = quote.ticks - baseline.ticks;
    const gainedWeight = quote.belowWeight - baseline.belowWeight;
    const gain = 100 * gainedWeight / distribution.totalWeight;
    const extraFee = extraTicks / QUOTE_SCALE;
    const point = { ...quote, extraTicks, extraFee, gainedWeight, gain, efficiency: gain / extraFee };
    candidates.push(point);
    // Compare exact integer ratios. Equal averages keep the cheaper quote.
    // Zero-gain fee gaps remain in extraTicks, even though only jumps are scanned.
    if (gainedWeight > 0 && (!peak || BigInt(gainedWeight) * BigInt(peak.extraTicks)
      > BigInt(peak.gainedWeight) * BigInt(extraTicks))) peak = point;
  }
  return {
    policy: { minimumPriority, maximumSearchPriority }, baseline, searchLimit,
    candidates, peak, recommended: peak || baseline,
    reason: peak ? 'cumulative_peak' : 'no_gain',
  };
}

export function priorityAt(distribution, feeRate) {
  let below = 0;
  for (const group of distribution.groups) {
    if (group.rate >= feeRate) break;
    below += group.weight;
  }
  return 100 * below / distribution.totalWeight;
}

export function marginalCurve(distribution, stepTicks = 1, minimumTicks = MIN_QUOTE_TICKS - stepTicks, maximumTicks = null) {
  if (!distribution) return null;
  if (!Number.isSafeInteger(stepTicks) || stepTicks <= 0 || !Number.isSafeInteger(minimumTicks) || minimumTicks < 1 || minimumTicks + stepTicks < MIN_QUOTE_TICKS) throw Error('invalid_marginal_grid');
  if (maximumTicks !== null && (!Number.isSafeInteger(maximumTicks) || maximumTicks < minimumTicks)) throw Error('invalid_marginal_limit');
  // A group contributes when start <= rate < start + step. Sweep the integer
  // quote grid at its entry/exit events instead of scanning millions of ticks.
  const events = new Map([[minimumTicks, 0]]);
  const add = (tick, weight) => events.set(tick, (events.get(tick) || 0) + weight);
  const upperExclusive = maximumTicks === null ? null : maximumTicks + 1;
  let endTicks = upperExclusive ?? minimumTicks + 1;
  for (const group of distribution.groups) {
    if (group.rate < minimumTicks / QUOTE_SCALE) continue;
    const rawExit = nextGridTicks(group.rate);
    const entry = Math.max(minimumTicks, rawExit - stepTicks);
    const exit = upperExclusive === null ? rawExit : Math.min(rawExit, upperExclusive);
    if (entry >= exit) continue;
    add(entry, group.weight); add(exit, -group.weight);
    if (upperExclusive === null) endTicks = Math.max(endTicks, exit + 1);
  }
  if (!Number.isSafeInteger(endTicks + stepTicks)) throw Error('unsupported_marginal_range');
  add(endTicks, 0);
  const boundaries = [...events.keys()].sort((a, b) => a - b);
  const segments = [];
  let weight = 0, peakWeight = 0, peakStart = null;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i], end = boundaries[i + 1];
    weight += events.get(start);
    segments.push({ startTicks: start, endTicks: end, gainedWeight: weight, efficiency: (100 * weight / distribution.totalWeight) / (stepTicks / QUOTE_SCALE) });
    if (weight > peakWeight) { peakWeight = weight; peakStart = start; }
  }
  let peak = null;
  if (peakStart !== null) {
    const startRate = peakStart / QUOTE_SCALE, endRate = (peakStart + stepTicks) / QUOTE_SCALE;
    const gain = 100 * peakWeight / distribution.totalWeight;
    peak = {
      start: { ticks: peakStart, feeRate: startRate, priority: priorityAt(distribution, startRate) },
      end: { ticks: peakStart + stepTicks, feeRate: endRate, priority: priorityAt(distribution, endRate) },
      gain, efficiency: gain / (stepTicks / QUOTE_SCALE), gainedWeight: peakWeight,
    };
  }
  return { step: stepTicks / QUOTE_SCALE, segments, peak, startTicks: minimumTicks, endTicks };
}
