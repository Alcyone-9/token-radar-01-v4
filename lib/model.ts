// Token radar — Raphael's model, version 4. One snapshot of the protocol universe in, one
// ranked board out.
//
// THE SEPARATION COMES FIRST. Of the snapshot's protocols, three sets are told apart before
// anything is priced:
//   - already tokened: the record carries a token (a CoinGecko id, a symbol, or a market
//     cap). Never ranked; set aside at the market's own values, and used as the comparable
//     set the model is fitted on.
//   - products of a traded token: the record carries no token, but the protocol is a wrapped,
//     staked or bridged product of one that already trades, an exchange, or a versioned pool
//     of another protocol — the house's own watchlist test, applied to the whole snapshot.
//     WBTC, Binance staked ETH and USDT0 sit here: they record no token, yet no launch of
//     theirs is coming, so a radar that ranks them is ranking the wrong thing.
//   - launch candidates: the rest of the no-token protocols. These the board ranks, the
//     40-protocol watchlist among them (the floor, never the ceiling).
//
// THE MODEL, VERSION 4. Version 2 priced candidates from shrunk category medians that were
// never fitted and never tested out of sample. Version 3 fitted a multiple per category
// and tested it held-out — but it priced a $5M lending market and a $5B one at the same
// multiple, while the snapshot's own peers say size is systematic: across the 128 tokened
// peers, log multiple falls with log TVL at slope ≈ −0.45 (correlation −0.42). Version 4
// fits the size curve as well as the category:
//
//   fit      — for each category, a log-intercept is fitted to the snapshot's own tokened
//              peers: the peers' mean log ratio, pulled toward the global fitted log
//              intercept with strength k (the pull is n/(n+k) peer weight). On top of the
//              intercepts, one global size slope is fitted: log multiple changes by the
//              slope for each e-fold of TVL away from the peer pool's centre size, the
//              slope itself ridge-pulled with strength λ so a thin pool cannot invent a
//              steep curve. Intercepts and slope are fitted together by backfitting
//              (25 fixed passes, so every run — and the dashboard's re-run — lands on the
//              same numbers). Peer ratios are winsorized at the field's 95th percentile
//              first, so one absurd peer cannot carry a category, and every fitted
//              multiple is clamped to [0.02, 5].
//   holdout  — (k, λ) are chosen together by a two-way holdout on the peer pool: the peers
//              are split in two deterministic halves (by a hash of the slug, never by
//              clock or chance), the model is fitted on one half and scored on the other,
//              then the halves swap. The pair with the lowest pooled median |log error|
//              wins, the model is refitted on all peers with that pair, and the test's
//              numbers — the median held-out error in each direction, the error band and
//              its coverage — are published with the board, not kept in a drawer.
//   range    — the low/high under each value is the fitted multiple widened by the model's
//              own measured error band: in the same holdout, each category's fitted curve
//              on one half is compared with its fit on the other half at that category's
//              own typical size, and the 75th percentile of those split-half log
//              differences is the band. A range is a measured miss distance of the
//              estimate itself, not a decoration. (The panel also publishes the wider
//              peer-level error: how far a single launch typically lands from its
//              category's curve.)
//   thin     — a category with one tokened peer prices its rows mostly from the global fit
//              (the peer's weight is 1/(1+k)) and the row says so; a category with no
//              tokened peer is priced from the global fit alone and graded D. No row hides
//              how thin its evidence is.
//   odds     — a launch is not certain, so each candidate also carries the launch record of
//              its own cohort: of the snapshot's protocols in the same category, age band
//              and TVL band, the share that ever recorded a token, smoothed toward the
//              field-wide rate. expected = implied x odds is shown beside implied, never
//              instead of it.
//   verdict  — every farm plan is netted to a verdict (farm / thin / skip) from its own
//              economics: the probability-weighted launch value measured against the
//              snapshot's own $50M floor (under 1% of the floor is a skip, under 5% is
//              thin), gated by the cohort's launch odds. The plan's last step states the
//              net line and the verdict it earns.
//   factors  — momentum = 1 + clamp(change_7d, -60, +120)/100 x 0.5 (change_7d is per cent);
//              maturity = 0.6 + min(age_days, 1095)/1095 x 0.4 (unknown age: 365 days);
//              reach = 1.10 for 3+ chains, 1.05 for 2 chains, else 1.
//   implied  = round(TVL x fitted multiple x momentum x maturity x reach), at least $1,
//              and the board ranks by implied value.
//
// No protocol name is ever special-cased: one function scores every row, and every number
// comes from the snapshot itself. The dashboard restates this model — the fit, the holdout,
// the odds and the verdicts included — recomputes every row in the page, and a build-time
// check proves the page and board.json agree to the dollar and to the letter.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, published in data.js so the dashboard runs the same numbers. */
export interface ModelConstants {
  winsor_p: number;
  clamp_lo: number;
  clamp_hi: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_2: number;
  chain_3plus: number;
  odds_prior: number;
  verdict_odds_skip: number;
  verdict_odds_thin: number;
  verdict_floor_skip_div: number;
  verdict_floor_thin_div: number;
}

export const MODEL: ModelConstants = {
  winsor_p: 0.95,
  clamp_lo: 0.02,
  clamp_hi: 5,
  momentum_weight: 0.5,
  momentum_floor: -60,
  momentum_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_2: 1.05,
  chain_3plus: 1.1,
  odds_prior: 5,
  verdict_odds_skip: 0.3,
  verdict_odds_thin: 0.45,
  verdict_floor_skip_div: 100,
  verdict_floor_thin_div: 20,
};

export const MODEL_VERSION = 'radar-raphael-4';

/** The shrinkage strengths the holdout chooses between: small k trusts each category, large k trusts the field. */
export const FIT_GRID_K = [2, 4, 6, 10, 16, 24, 40];

/** The slope ridges the holdout chooses between: how hard the size slope is pulled toward flat. */
export const FIT_GRID_LAMBDA = [0, 8, 32];

/** Backfitting passes for the joint intercept/slope fit: fixed, so every run lands on the same fit. */
export const SIZE_FIT_ITERATIONS = 25;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One tokened peer observation the fit runs on: its category, its market-cap/TVL ratio, and its TVL (the size the curve is fitted over). */
export interface PeerObs {
  slug: string;
  category: string;
  ratio: number;
  tvl: number;
}

/** The holdout's published result: how the fitted model did on peers it was not fitted on. */
export interface ModelTest {
  fit_k: number;
  fit_lambda: number;
  peers: number;
  grid: { k: number; lambda: number; error: number }[];
  err_fit_a_test_b: number;
  err_fit_b_test_a: number;
  median_abs_log_error: number;
  band_half_width: number;
  band_coverage: number;
  band_pairs: number;
}

/** One category's fitted curve: its log-intercept at the pool's centre size, and the multiple that intercept gives at that size. */
export interface CategoryMultiple {
  category: string;
  sample: number;
  peer_median: number | null;
  peer_q1: number | null;
  peer_q3: number | null;
  log_intercept: number;
  multiple: number;
  multiple_low: number;
  multiple_high: number;
  basis: 'peers' | 'global';
  shrink_weight: number;
}

/** One cohort's launch record: protocols alike in category, age band and TVL band, and how many ever tokened. */
export interface CohortStat {
  key: string;
  category: string;
  age_band: string;
  tvl_band: string;
  n: number;
  tokened: number;
  odds: number;
}

/** The money shape of one row's farm plan, so the dashboard can total it without parsing text. */
export interface PlanShape {
  capital_usd: number;
  gas_setup_usd: number;
  gas_weekly_usd: number;
  hold_days: number;
  weeks: number;
  total_cost_usd: number;
}

/** A farm plan's netted verdict, from its own economics. */
export type Verdict = 'farm' | 'thin' | 'skip';

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  launch_odds: number;
  expected_value_usd: number;
  verdict: Verdict;
  confidence: 'A' | 'B' | 'C' | 'D';
  model: {
    category_multiple: number;
    category_sample: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
    cohort_n: number;
    cohort_tokened: number;
  };
  plan: PlanShape;
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row, verbatim. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A no-token protocol set aside as a product of a traded token, with the reason it is not ranked. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  reason: string;
  parent_token: string | null;
}

/** One tokened peer behind a category multiple, as the dashboard's detail view shows it. */
export interface PeerRow {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** Everything the dashboard needs: the board, the two set-aside sets, the fit, the odds and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median: number;
  winsor_cap: number;
  size_slope: number;
  size_center: number;
  model_test: ModelTest;
  multiples: CategoryMultiple[];
  peer_pool: PeerObs[];
  cohorts: Record<string, CohortStat>;
  global_tokened_rate: number;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  live_size: number;
  live_total: number;
  aside_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  aside: AsideRow[];
  peers: Record<string, PeerRow[]>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that are products of a traded token by construction, never launches of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name marks a product of the asset it wraps or stakes. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Why a no-token protocol is a product of a traded token rather than a launch candidate, or
 * null when it is a candidate. This is the house's watchlist test, applied to every protocol:
 * an excluded category, a wrapped/staked word in the name, a version marker at the name's
 * end, or an exchange's name at its start.
 */
export function productReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
    return p.category === 'CEX' ? 'centralized exchange' : `${p.category.toLowerCase()} product of a traded token`;
  }
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product of a traded token';
  if (VERSIONED.test(p.name)) return 'versioned pool of another protocol';
  for (const ex of EXCHANGE_PREFIXES) if (p.name.startsWith(ex)) return `${ex} exchange product`;
  return null;
}

/** Whether a protocol is one the board may rank: records no token, and is no traded token's product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && productReason(p) === null;
}

function sortedCopy(values: number[]): number[] {
  return [...values].sort((x, y) => x - y);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const a = sortedCopy(values);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

/** A quantile of a sorted array, by nearest rank. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[at]!;
}

/** FNV-1a over the slug: the deterministic coin the holdout split flips, identical on every run. */
export function slugHash(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The peer pool the fit runs on: every protocol that already trades, with its ratio rounded once, here. */
export function peerPool(snapshot: Snapshot): PeerObs[] {
  const pool: PeerObs[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    pool.push({ slug: p.slug, category: p.category ?? '', ratio: round4(p.mcap_usd / p.tvl_usd), tvl: p.tvl_usd });
  }
  return pool.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * One fitted size curve: per-category log-intercepts at the fit's centre size (the train
 * pool's mean log TVL), the global log-intercept, and the one size slope shared by every
 * category — log multiple = intercept + slope x (log TVL - centre).
 */
interface Fitted {
  globalLog: number;
  byCategory: Map<string, number>;
  slope: number;
  center: number;
}

/**
 * Fit the curve on one set of peer observations: winsorize the ratios at the pool's 95th
 * percentile, then backfit — each pass refits the shrunk category intercepts on the
 * slope-adjusted log ratios (the global intercept is the mean log ratio outside the
 * product categories, as in version 3) and refits the slope on the intercept-adjusted
 * residuals with ridge strength lambda. A category absent from the set gets no entry —
 * its peers are predicted from the global intercept on the same curve, which is exactly
 * the honesty the holdout measures.
 */
function fitOn(pool: PeerObs[], winsorCap: number, k: number, lambda: number, model: ModelConstants): Fitted {
  const center = pool.length > 0 ? pool.reduce((s, x) => s + Math.log(x.tvl), 0) / pool.length : 0;
  const logRatio = (x: PeerObs): number => Math.log(Math.min(x.ratio, winsorCap));
  let slope = 0;
  let globalLog = Math.log(0.2);
  let byCategory = new Map<string, number>();
  for (let it = 0; it < SIZE_FIT_ITERATIONS; it++) {
    const globalLogs: number[] = [];
    const byCat = new Map<string, number[]>();
    for (const x of pool) {
      const adj = logRatio(x) - slope * (Math.log(x.tvl) - center);
      if (!PRODUCT_CATEGORIES.has(x.category)) globalLogs.push(adj);
      const list = byCat.get(x.category) ?? [];
      list.push(adj);
      byCat.set(x.category, list);
    }
    globalLog = globalLogs.length > 0 ? globalLogs.reduce((s, v) => s + v, 0) / globalLogs.length : Math.log(0.2);
    byCategory = new Map<string, number>();
    for (const [category, logs] of byCat) {
      const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
      byCategory.set(category, (logs.length * mean + k * globalLog) / (logs.length + k));
    }
    let num = 0;
    let den = lambda;
    for (const x of pool) {
      const z = Math.log(x.tvl) - center;
      num += z * (logRatio(x) - (byCategory.get(x.category) ?? globalLog));
      den += z * z;
    }
    slope = den > 0 ? num / den : 0;
  }
  return { globalLog, byCategory, slope, center };
}

/** The fitted log multiple for a category at size z (a log TVL): its intercept on the curve, or the global intercept. */
function predictLogAtZ(fit: Fitted, category: string, z: number): number {
  return (fit.byCategory.get(category) ?? fit.globalLog) + fit.slope * (z - fit.center);
}

/** What one fitted curve predicts for a peer: its category's curve at the peer's own size, clamped like every fit. */
function predict(fit: Fitted, x: PeerObs, model: ModelConstants): number {
  return Math.min(model.clamp_hi, Math.max(model.clamp_lo, Math.exp(predictLogAtZ(fit, x.category, Math.log(x.tvl)))));
}

/**
 * The two-way holdout. The peer pool is split by slug-hash parity; for each candidate
 * (k, lambda) pair the curve is fitted on one half and scored on the other, then the
 * halves swap, and the pooled median |log error| decides. Two errors are published, for
 * two different questions: the peer-level error (how far one launch typically lands from
 * its category's curve — wide, because launches vary) and the range band, calibrated from
 * the split-half stability of the curves themselves: at the winning pair, each category
 * fitted on one half is compared with its fit on the other half at that category's own
 * typical size (its peers' mean log TVL over the whole pool), and the 75th percentile of
 * those log differences is the half-width every row's range is widened by. The coverage
 * is the share of split-half fits that fell inside that band around their other-half fit.
 * A pool too small to pair any category falls back to the peer-level band, and band_pairs
 * says which happened.
 */
export function holdoutTest(pool: PeerObs[], model: ModelConstants = MODEL): { test: ModelTest; winsorCap: number } {
  const ratios = sortedCopy(pool.map((x) => x.ratio));
  const winsorCap = ratios.length > 0 ? quantile(ratios, model.winsor_p) : 1;
  const halfA = pool.filter((x) => slugHash(x.slug) % 2 === 0);
  const halfB = pool.filter((x) => slugHash(x.slug) % 2 === 1);
  const residualsFor = (k: number, lambda: number): { ab: number[]; ba: number[] } => {
    const fitA = fitOn(halfA, winsorCap, k, lambda, model);
    const fitB = fitOn(halfB, winsorCap, k, lambda, model);
    const ab = halfB.map((x) => Math.log(Math.min(x.ratio, winsorCap)) - Math.log(predict(fitA, x, model)));
    const ba = halfA.map((x) => Math.log(Math.min(x.ratio, winsorCap)) - Math.log(predict(fitB, x, model)));
    return { ab, ba };
  };
  let bestK = FIT_GRID_K[0]!;
  let bestLambda = FIT_GRID_LAMBDA[0]!;
  let bestError = Number.POSITIVE_INFINITY;
  const grid: { k: number; lambda: number; error: number }[] = [];
  for (const k of FIT_GRID_K) {
    for (const lambda of FIT_GRID_LAMBDA) {
      const { ab, ba } = residualsFor(k, lambda);
      const error = median([...ab, ...ba].map(Math.abs));
      grid.push({ k, lambda, error: round4(error) });
      if (error < bestError) {
        bestError = error;
        bestK = k;
        bestLambda = lambda;
      }
    }
  }
  const { ab, ba } = residualsFor(bestK, bestLambda);
  const absPooled = [...ab, ...ba].map(Math.abs);
  const fitA = fitOn(halfA, winsorCap, bestK, bestLambda, model);
  const fitB = fitOn(halfB, winsorCap, bestK, bestLambda, model);
  const catMeanZ = new Map<string, number>();
  {
    const sums = new Map<string, { sum: number; n: number }>();
    for (const x of pool) {
      const s = sums.get(x.category) ?? { sum: 0, n: 0 };
      s.sum += Math.log(x.tvl);
      s.n += 1;
      sums.set(x.category, s);
    }
    for (const [category, s] of sums) catMeanZ.set(category, s.sum / s.n);
  }
  const stability: number[] = [];
  for (const [category] of fitA.byCategory) {
    if (!fitB.byCategory.has(category)) continue;
    const z = catMeanZ.get(category) ?? fitA.center;
    stability.push(Math.abs(predictLogAtZ(fitA, category, z) - predictLogAtZ(fitB, category, z)));
  }
  const bandSource = stability.length > 0 ? stability : sortedCopy(absPooled);
  const band = quantile(sortedCopy(bandSource), 0.75);
  const covered = bandSource.filter((v) => v <= band).length;
  return {
    winsorCap: round4(winsorCap),
    test: {
      fit_k: bestK,
      fit_lambda: bestLambda,
      peers: pool.length,
      grid,
      err_fit_a_test_b: round4(median(ab.map(Math.abs))),
      err_fit_b_test_a: round4(median(ba.map(Math.abs))),
      median_abs_log_error: round4(median(absPooled)),
      band_half_width: round4(band),
      band_coverage: bandSource.length > 0 ? round4(covered / bandSource.length) : 0,
      band_pairs: stability.length,
    },
  };
}

/**
 * The category curves, fitted on the snapshot itself and widened by the holdout's error
 * band. Each category publishes its log-intercept (rounded once, here, so the dashboard
 * prices rows from the identical numbers) and the multiple that intercept gives at the
 * pool's centre size; a row's own multiple is read off the curve at the row's own size.
 * Categories with no tokened peer take the global intercept and say so (basis 'global',
 * shrink weight 0); a category with one peer leans on the global fit for k/(1+k) of its
 * intercept, and its shrink weight shows exactly that.
 */
export function categoryMultiples(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { globalMedian: number; winsorCap: number; multiples: CategoryMultiple[]; test: ModelTest; pool: PeerObs[]; sizeSlope: number; sizeCenter: number } {
  const pool = peerPool(snapshot);
  const { test, winsorCap } = holdoutTest(pool, model);
  const fit = fitOn(pool, winsorCap, test.fit_k, test.fit_lambda, model);
  const clampM = (n: number): number => Math.min(model.clamp_hi, Math.max(model.clamp_lo, n));
  const sizeSlope = round4(fit.slope);
  const sizeCenter = round4(fit.center);
  const globalLogIntercept = round4(fit.globalLog);
  const cappedByCategory = new Map<string, number[]>();
  for (const x of pool) {
    const list = cappedByCategory.get(x.category) ?? [];
    list.push(Math.min(x.ratio, winsorCap));
    cappedByCategory.set(x.category, list);
  }
  const band = test.band_half_width;
  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? '');
  const multiples: CategoryMultiple[] = [...categories].sort().map((category) => {
    const ratios = sortedCopy(cappedByCategory.get(category) ?? []);
    const n = ratios.length;
    const logIntercept = n === 0 ? globalLogIntercept : round4(fit.byCategory.get(category) ?? fit.globalLog);
    const m = clampM(Math.exp(logIntercept));
    return {
      category,
      sample: n,
      peer_median: n === 0 ? null : round4(median(ratios)),
      peer_q1: n === 0 ? null : round4(quantile(ratios, 0.25)),
      peer_q3: n === 0 ? null : round4(quantile(ratios, 0.75)),
      log_intercept: logIntercept,
      multiple: round4(m),
      multiple_low: round4(clampM(Math.min(m, m * Math.exp(-band)))),
      multiple_high: round4(clampM(Math.max(m, m * Math.exp(band)))),
      basis: n === 0 ? ('global' as const) : ('peers' as const),
      shrink_weight: n === 0 ? 0 : round4(n / (n + test.fit_k)),
    };
  });
  return { globalMedian: round4(clampM(Math.exp(globalLogIntercept))), winsorCap, multiples, test, pool, sizeSlope, sizeCenter };
}

/** The age band a protocol's cohort is read in: the launch record is kept apart by how long a protocol has lived. */
export function ageBand(age: number | null): string {
  if (age === null) return 'age unknown';
  if (age < 180) return 'under 6 months';
  if (age < 365) return '6-12 months';
  if (age < 730) return '1-2 years';
  return 'over 2 years';
}

/** The TVL band a protocol's cohort is read in. */
export function tvlBand(tvl: number): string {
  if (tvl < 10_000_000) return 'TVL under $10M';
  if (tvl < 50_000_000) return 'TVL $10-50M';
  if (tvl < 250_000_000) return 'TVL $50-250M';
  if (tvl < 1_000_000_000) return 'TVL $250M-$1B';
  return 'TVL over $1B';
}

/** The cohort key: category, age band and TVL band, in one string the dashboard rebuilds identically. */
export function cohortKey(category: string, age: number | null, tvl: number): string {
  return `${category} · ${ageBand(age)} · ${tvlBand(tvl)}`;
}

/**
 * Every cohort's launch record, counted over the whole snapshot: of the protocols alike in
 * category, age band and TVL band, how many ever recorded a token. The odds are that share,
 * smoothed toward the field-wide tokened rate with a prior of odds_prior phantom protocols,
 * so a cohort of two cannot claim certainty either way.
 */
export function cohortStats(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { cohorts: Record<string, CohortStat>; globalRate: number } {
  const total = snapshot.protocols.length;
  const tokenedTotal = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const globalRate = total > 0 ? tokenedTotal / total : 0;
  const byKey = new Map<string, CohortStat>();
  for (const p of snapshot.protocols) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const category = p.category ?? '';
    const key = cohortKey(category, age, p.tvl_usd);
    const stat = byKey.get(key) ?? {
      key,
      category,
      age_band: ageBand(age),
      tvl_band: tvlBand(p.tvl_usd),
      n: 0,
      tokened: 0,
      odds: 0,
    };
    stat.n += 1;
    if (!isPreToken(p)) stat.tokened += 1;
    byKey.set(key, stat);
  }
  const cohorts: Record<string, CohortStat> = {};
  for (const [key, stat] of byKey) {
    stat.odds = round4((stat.tokened + model.odds_prior * globalRate) / (stat.n + model.odds_prior));
    cohorts[key] = stat;
  }
  return { cohorts, globalRate: round4(globalRate) };
}

/** How much peer evidence stands behind a row's multiple: A deep, B solid, C thin, D the global fallback. */
export function confidenceFor(sample: number): 'A' | 'B' | 'C' | 'D' {
  if (sample >= 8) return 'A';
  if (sample >= 4) return 'B';
  if (sample >= 1) return 'C';
  return 'D';
}

/**
 * A plan's verdict, netted from its own economics: the probability-weighted launch value
 * measured against the snapshot's own floor (under floor/100 is a skip, under floor/20 is
 * thin), gated by the cohort's launch odds (under the skip gate the launch is unlikely
 * whatever the value; under the thin gate it is a minority outcome). The thresholds are
 * the model's published constants, so the page applies the identical rule.
 */
export function verdictFor(expectedValue: number, odds: number, floorUsd: number, model: ModelConstants = MODEL): Verdict {
  if (odds < model.verdict_odds_skip || expectedValue < floorUsd / model.verdict_floor_skip_div) return 'skip';
  if (odds < model.verdict_odds_thin || expectedValue < floorUsd / model.verdict_floor_thin_div) return 'thin';
  return 'farm';
}

/** The model's factors for one protocol, and the implied value and range they produce. The multiple is read off the category's fitted size curve at the protocol's own TVL, from the published (rounded) intercept, slope and centre — the identical numbers the dashboard prices from. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  cm: CategoryMultiple,
  size: { slope: number; center: number },
  band: number,
  model: ModelConstants = MODEL,
): { implied: number; impliedLow: number; impliedHigh: number; momentumMult: number; maturityMult: number; chainMult: number; age: number | null; multiple: number } {
  const clampM = (n: number): number => Math.min(model.clamp_hi, Math.max(model.clamp_lo, n));
  const age = ageDays(asOf, protocol.listed_at);
  const growth = finite(protocol.change_7d, 0);
  const clamped = Math.min(model.momentum_cap, Math.max(model.momentum_floor, growth));
  const momentumMult = round4(1 + (clamped / 100) * model.momentum_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = round4(model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
  const chainMult = protocol.chains.length >= 3 ? model.chain_3plus : protocol.chains.length === 2 ? model.chain_2 : 1;
  const multiple = clampM(Math.exp(cm.log_intercept + size.slope * (Math.log(protocol.tvl_usd) - size.center)));
  const at = (m: number): number => Math.max(1, Math.round(protocol.tvl_usd * m * momentumMult * maturityMult * chainMult));
  return {
    implied: at(multiple),
    impliedLow: at(clampM(multiple * Math.exp(-band))),
    impliedHigh: at(clampM(multiple * Math.exp(band))),
    momentumMult,
    maturityMult,
    chainMult,
    age,
    multiple,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: { text: string; cost: string; time: string }): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and recheck the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas in dollars by chain class: L1s are dear, Solana is cents, the L2s sit between. */
export function gasUsd(chain: string): number {
  if (chain === 'Ethereum' || chain === 'Bitcoin') return 12;
  if (chain === 'Solana') return 1;
  if (chain === 'Polygon') return 1;
  if (chain === 'BSC' || chain === 'BNB Chain') return 2;
  if (chain === 'Avalanche') return 3;
  if (['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Scroll', 'Linea', 'Mantle', 'Blast', 'Mode', 'Taiko'].includes(chain)) return 2;
  return 3;
}

/** How a gas figure reads in a step: whole dollars, no false precision. */
export function gasText(usd: number): string {
  return usd <= 1 ? 'about $1 of gas' : `about $${usd} of gas`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow, with its working target. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('uncollateralized')) return `Lend $${capital} of USDC into a ${name} pool on ${chain} and keep the loan position open.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral on ${name} (${chain}), borrow about 30% against it, and keep both legs open so the wallet builds a borrow history.`;
  if (c.includes('dex') || c.includes('liquidity')) return `Provide $${capital} of balanced liquidity to ${name}'s main pool on ${chain} and make 4 swaps of $25 or more through it in the first week.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in one app on the far side.`;
  if (c.includes('staking') || c.includes('restak') || c.includes('btc')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the wallet.`;
  if (c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and hold one small hedged position, long spot against a short perp of about half the size.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares untouched.`;
  if (c.includes('rwa')) return `Subscribe $${capital} to ${name}'s yield asset on ${chain} and hold it in the wallet.`;
  if (c.includes('stable') || c.includes('cedefi')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}, make one swap and one lending deposit there, and keep both positions open.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place positions in its 3 most liquid markets, keeping each one under $25.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('index')) return `Mint $${capital} of the ${name} index token on ${chain} and hold it.`;
  if (c.includes('payment') || c.includes('card')) return `Activate a ${name} account, deposit $${capital}, and make one real payment with it.`;
  return `Deposit $${capital} of USDC into ${name}'s core product on ${chain} and keep the position open.`;
}

/** The weekly qualifying action that keeps a position counted, by category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'rebalance the borrow once so the health factor stays in its middle band';
  if (c.includes('dex') || c.includes('liquidity')) return 'harvest the pool fees once and re-add them to the position';
  if (c.includes('bridge')) return 'bridge a small amount back or forth once';
  if (c.includes('staking') || c.includes('restak') || c.includes('btc')) return 'claim the staking rewards once and restake them';
  if (c.includes('derivative') || c.includes('basis')) return 'roll the hedge once so it never sits unhedged overnight';
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('farm')) return 'harvest the vault yield once and compound it back in';
  return 'make one deposit, swap or vote in the protocol once';
}

/** The money shape of a protocol's farm plan, from its own record. */
export function planShape(p: SnapshotProtocol, age: number | null): PlanShape {
  const capital = capitalFor(p);
  const setup = gasUsd(chainOf(p));
  const weekly = Math.max(1, Math.round(setup / 2));
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const scaleIn = p.chains.length >= 2 ? Math.round(capital / 2) : Math.round(capital / 4);
  const total = capital + scaleIn + setup + weekly * weeks + setup;
  return { capital_usd: capital, gas_setup_usd: setup, gas_weekly_usd: weekly, hold_days: hold, weeks, total_cost_usd: total };
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, derived from
 * the protocol's own record (category, chains, TVL, age) and from the board's own implied
 * range, which the post-launch step judges the launch against — never from a hand-written
 * list of names. The last step closes with the plan's net line: its all-in cost against the
 * probability-weighted launch value, and the verdict those economics earn. The dashboard
 * regenerates these in the page from the same figures.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  range: { low: number; high: number },
  net: { expected: number; odds: number; verdict: Verdict },
): string[] {
  const chain = chainOf(p);
  const shape = planShape(p, age);
  const capital = shape.capital_usd;
  const setupGas = gasText(shape.gas_setup_usd);
  const weeklyGas = gasText(shape.gas_weekly_usd);
  const hold = shape.hold_days;
  const steps = [
    {
      text: `Open a fresh wallet for ${p.name} alone, keep its seed phrase offline, and fund it on ${chain} with the position money plus gas.`,
      cost: setupGas,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${setupGas}`,
      time: '15 minutes to set up',
    },
    p.chains.length >= 2
      ? {
          text: `Repeat a half-size version of the same action on ${p.chains[1]}, so the farm is not riding on a single chain's snapshot.`,
          cost: `$${Math.round(capital / 2)} of capital and ${gasText(gasUsd(p.chains[1]!))}`,
          time: '15 minutes',
        }
      : {
          text: `After 7 days, add 25% more to the same ${p.name} position if its TVL has not fallen, so the position reads as conviction, not a drive-by.`,
          cost: `$${Math.round(capital / 4)} more capital and ${setupGas}`,
          time: '10 minutes',
        },
    {
      text: `Once a week for ${shape.weeks} weeks, ${weeklyFor(p)} on ${p.name}; skip a week rather than forcing a trade in a thin market.`,
      cost: weeklyGas + ' a week',
      time: '10 minutes a week',
    },
    {
      text: `Every week, open ${p.name}'s own app and check its points or rewards page; claim only from a link the protocol itself publishes, and never pay a third party to claim.`,
      cost: 'nothing to check',
      time: '5 minutes a week',
    },
    {
      text: `Hold the position at least ${hold} days so it appears in more than one weekly snapshot, and review it every 14 days: exit half if ${p.name}'s TVL drops more than 30% week over week.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `If ${p.name} announces a token, verify the contract address on the protocol's own page before claiming anything, claim to this same wallet, and judge the launch against this board's range: sell into strength above $${Math.round(range.high).toLocaleString('en-US')}, hold below $${Math.round(range.low).toLocaleString('en-US')}.`,
      cost: setupGas + ' to claim',
      time: '30 minutes on launch day',
    },
    {
      text:
        `Keep a farm log for ${p.name} (wallet, dates, amounts, transaction hashes) and cap the whole plan at $${shape.total_cost_usd} all-in; one wallet only, since splitting across wallets risks being filtered out as a sybil. ` +
        `Net: $${shape.total_cost_usd} all-in against $${Math.round(net.expected).toLocaleString('en-US')} of probability-weighted launch value (implied value x ${Math.round(net.odds * 100)}% launch odds from its cohort's record) — verdict: ${net.verdict}.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps.map(stepText);
}

/** The ranked board: every launch candidate, by implied value, each with its odds, expected value and verdict. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { multiples, test, sizeSlope, sizeCenter } = categoryMultiples(snapshot, model);
  const { cohorts } = cohortStats(snapshot, model);
  const byCategory = new Map(multiples.map((m) => [m.category, m]));
  const size = { slope: sizeSlope, center: sizeCenter };
  const rows: BoardRow[] = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const cm = byCategory.get(p.category ?? '')!;
      const v = impliedValue(p, snapshot.as_of, cm, size, test.band_half_width, model);
      const shape = planShape(p, v.age);
      const cohort = cohorts[cohortKey(p.category ?? '', v.age, p.tvl_usd)];
      const odds = cohort ? cohort.odds : 0;
      const expected = Math.round(v.implied * odds);
      const verdict = verdictFor(expected, odds, snapshot.floor_usd, model);
      return {
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: [...p.chains],
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        mcap_usd: null,
        listed_at: p.listed_at,
        gecko_id: null,
        symbol: null,
        token_status: 'pre-token' as const,
        age_days: v.age,
        implied_value_usd: v.implied,
        implied_low_usd: v.impliedLow,
        implied_high_usd: v.impliedHigh,
        launch_odds: odds,
        expected_value_usd: expected,
        verdict,
        confidence: confidenceFor(cm.sample),
        model: {
          category_multiple: round4(v.multiple),
          category_sample: cm.sample,
          momentum_multiplier: v.momentumMult,
          maturity_multiplier: v.maturityMult,
          chain_multiplier: v.chainMult,
          age_days: v.age,
          cohort_n: cohort ? cohort.n : 0,
          cohort_tokened: cohort ? cohort.tokened : 0,
        },
        plan: shape,
        farm_steps: farmSteps(p, v.age, { low: v.impliedLow, high: v.impliedHigh }, { expected, odds, verdict }),
      };
    });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

/** The live-token view: every protocol that already trades, the top rows by market cap. */
export function liveRows(snapshot: Snapshot, limit: number = LIVE_ROWS): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: [...p.chains], tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

/** How many protocols already trade at all (a market cap, a CoinGecko id, or a symbol). */
export function tokenedCount(snapshot: Snapshot): number {
  return snapshot.protocols.filter((p) => !isPreToken(p)).length;
}

/** A name stripped to its underlying asset, case preserved: no version marker, no exchange prefix, no wrapper word. */
function underlyingRaw(name: string): string {
  let s = name.replace(VERSIONED, '');
  for (const ex of EXCHANGE_PREFIXES) if (s.startsWith(`${ex} `)) s = s.slice(ex.length + 1);
  s = s.replace(WRAPPED_WORD, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The parent a set-aside product belongs to, where the snapshot's own names identify it:
 * strip the product's name down to its underlying asset and look for a protocol — tokened
 * or not — carrying that name (a versioned pool's parent is usually itself a protocol in
 * the snapshot). Where no protocol matches, a remainder written as a bare ticker names the
 * parent asset directly (ETH out of "Binance staked ETH"; a leading W is the wrapped
 * marker, so "WBTC" reads BTC). Null when neither identifies one — the row then says its
 * parent already trades without inventing which token it is.
 */
export function parentTokenFor(p: SnapshotProtocol, all: SnapshotProtocol[]): string | null {
  const raw = underlyingRaw(p.name);
  if (raw === '') return null;
  const target = raw.toLowerCase();
  for (const t of all) {
    if (t.slug !== p.slug && t.name.toLowerCase() === target) {
      return !isPreToken(t) && t.symbol ? `${t.name} (${t.symbol})` : t.name;
    }
  }
  if (/^[A-Z0-9]{2,6}$/.test(raw)) {
    if (raw.length > 2 && raw.startsWith('W') && !p.name.includes(' ')) return raw.slice(1);
    if (raw !== p.name) return raw;
  }
  return null;
}

/** The set-aside view: every no-token protocol that is a traded token's product, with its reason and its parent token where named. */
export function asideRows(snapshot: Snapshot): AsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && productReason(p) !== null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      reason: productReason(p)!,
      parent_token: parentTokenFor(p, snapshot.protocols),
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
}

/** The tokened peers behind each category multiple, the six largest by market cap per category. */
export function peersByCategory(snapshot: Snapshot): Record<string, PeerRow[]> {
  const out: Record<string, PeerRow[]> = {};
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? '';
    const list = out[key] ?? [];
    list.push({ name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: round4(p.mcap_usd / p.tvl_usd) });
    out[key] = list;
  }
  for (const key of Object.keys(out)) {
    out[key] = out[key]!.sort((a, b) => b.mcap_usd - a.mcap_usd || a.name.localeCompare(b.name)).slice(0, 6);
  }
  return out;
}

/** The full radar: board, live view, set-aside view, the fitted curves, the holdout and the odds. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): RadarData {
  const { globalMedian, winsorCap, multiples, test, pool, sizeSlope, sizeCenter } = categoryMultiples(snapshot, model);
  const { cohorts, globalRate } = cohortStats(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const aside = asideRows(snapshot);
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median: globalMedian,
    winsor_cap: winsorCap,
    size_slope: sizeSlope,
    size_center: sizeCenter,
    model_test: test,
    multiples,
    peer_pool: pool,
    cohorts,
    global_tokened_rate: globalRate,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    live_total: tokenedCount(snapshot),
    aside_size: aside.length,
    rows: board,
    live,
    aside,
    peers: peersByCategory(snapshot),
  };
}

/** Read a sealed snapshot and prove it is one this model can score. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  const s = raw as Partial<Snapshot> | null;
  if (!s || typeof s !== 'object') throw new SnapshotError('snapshot.json is not an object');
  if (typeof s.as_of !== 'string' || typeof s.source !== 'string' || typeof s.floor_usd !== 'number') {
    throw new SnapshotError('snapshot.json is missing its as_of, source or floor_usd');
  }
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new SnapshotError('snapshot.json is missing its protocols or watchlist');
  }
  for (const p of s.protocols) {
    if (
      !p ||
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      !Array.isArray(p.chains) ||
      typeof p.tvl_usd !== 'number' ||
      !(p.change_7d === null || typeof p.change_7d === 'number') ||
      !(p.mcap_usd === null || typeof p.mcap_usd === 'number') ||
      !(p.listed_at === null || typeof p.listed_at === 'string') ||
      !(p.gecko_id === null || typeof p.gecko_id === 'string') ||
      !(p.symbol === null || typeof p.symbol === 'string')
    ) {
      throw new SnapshotError('a protocol in snapshot.json is malformed');
    }
  }
  return s as Snapshot;
}

/** The one-line reason a finished board would fail the gate, or '' when it would pass. */
export function boardIssue(board: unknown, snapshot: Snapshot): string {
  if (!Array.isArray(board) || board.length === 0) return 'board is not a non-empty array';
  const rows = board as BoardRow[];
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (typeof row.slug !== 'string' || typeof row.name !== 'string') return `row ${i + 1} has no slug or name`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) {
      return `row ${row.slug} has a bad implied value`;
    }
    if (row.implied_value_usd > previous) return `row ${row.slug} breaks the value order`;
    previous = row.implied_value_usd;
    if (typeof row.implied_low_usd !== 'number' || typeof row.implied_high_usd !== 'number') return `row ${row.slug} has no implied range`;
    if (row.implied_low_usd < 1 || row.implied_low_usd > row.implied_value_usd || row.implied_value_usd > row.implied_high_usd) {
      return `row ${row.slug} has an inconsistent implied range`;
    }
    if (typeof row.launch_odds !== 'number' || row.launch_odds < 0 || row.launch_odds > 1) return `row ${row.slug} has bad launch odds`;
    if (!Number.isInteger(row.expected_value_usd) || row.expected_value_usd < 0) return `row ${row.slug} has a bad expected value`;
    if (row.verdict !== 'farm' && row.verdict !== 'thin' && row.verdict !== 'skip') return `row ${row.slug} has no verdict`;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has the wrong number of farm steps`;
    }
    for (const s of row.farm_steps) {
      if (typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600) return `row ${row.slug} has a farm step outside 20..600 characters`;
    }
  }
  if (rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) return 'every implied value is the same';
  if (rows.length < 100 || rows.length > 4000) return `board has ${rows.length} rows, outside 100..4000`;
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  const outside = rows.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  if (outside < 60) return `only ${outside} rows sit outside the watchlist`;
  return '';
}

/** The dashboard's data file, written to /output so dashboard/index.html can load it. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
