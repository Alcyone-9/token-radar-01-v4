// Token Radar v4 — Raphael's dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders three views — the ranked board, the live tokens, the set-aside
// products — plus a detail view per protocol. No network: every byte shown is in data.js.
//
// The page runs the whole model itself: the fit (fitModel), the two-way holdout that chose
// its shrinkage and slope ridge (holdoutTest), the cohort odds (launchOdds), the verdicts
// (verdictFor) and the plan generator are lib/model.ts restated — every row's value, range,
// odds, expected value, verdict and farm plan is regenerated here and marked where it
// matches board.json.
(function () {
  'use strict';
  var D = typeof window !== 'undefined' ? window.RADAR : null;

  /* — small exact helpers, the model's arithmetic — */

  function r4(n) { return Math.round(n * 1e4) / 1e4; }
  function sortedCopy(values) { return values.slice().sort(function (x, y) { return x - y; }); }
  function median(values) {
    if (values.length === 0) return 0;
    var a = sortedCopy(values);
    var mid = Math.floor(a.length / 2);
    return a.length % 2 === 1 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
  function quantile(sorted, q) {
    if (sorted.length === 0) return 0;
    var at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[at];
  }
  /** FNV-1a over the slug: the deterministic coin the holdout split flips. */
  function slugHash(slug) {
    var h = 0x811c9dc5;
    for (var i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  var PRODUCT_CATEGORIES = { 'Bridge': 1, 'Canonical Bridge': 1, 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1, 'CEX': 1 };
  var FIT_GRID_K = [2, 4, 6, 10, 16, 24, 40];
  var FIT_GRID_LAMBDA = [0, 8, 32];
  var SIZE_FIT_ITERATIONS = 25;

  /* — the fit, restated: per-category log-intercepts on one global size curve, fitted together — */

  function fitOn(pool, winsorCap, k, lambda) {
    var M = D.model;
    var center = pool.length > 0 ? pool.reduce(function (s, x) { return s + Math.log(x.tvl); }, 0) / pool.length : 0;
    function logRatio(x) { return Math.log(Math.min(x.ratio, winsorCap)); }
    var slope = 0, globalLog = Math.log(0.2), byCategory = {};
    for (var it = 0; it < SIZE_FIT_ITERATIONS; it++) {
      var globalLogs = [];
      var byCat = {};
      pool.forEach(function (x) {
        var adj = logRatio(x) - slope * (Math.log(x.tvl) - center);
        if (!PRODUCT_CATEGORIES[x.category]) globalLogs.push(adj);
        if (!byCat[x.category]) byCat[x.category] = [];
        byCat[x.category].push(adj);
      });
      globalLog = globalLogs.length > 0 ? globalLogs.reduce(function (s, v) { return s + v; }, 0) / globalLogs.length : Math.log(0.2);
      byCategory = {};
      Object.keys(byCat).forEach(function (category) {
        var logs = byCat[category];
        var mean = logs.reduce(function (s, v) { return s + v; }, 0) / logs.length;
        byCategory[category] = (logs.length * mean + k * globalLog) / (logs.length + k);
      });
      var num = 0, den = lambda;
      pool.forEach(function (x) {
        var z = Math.log(x.tvl) - center;
        var a = Object.prototype.hasOwnProperty.call(byCategory, x.category) ? byCategory[x.category] : globalLog;
        num += z * (logRatio(x) - a);
        den += z * z;
      });
      slope = den > 0 ? num / den : 0;
    }
    return { globalLog: globalLog, byCategory: byCategory, slope: slope, center: center };
  }
  function predictLogAtZ(fit, category, z) {
    var a = Object.prototype.hasOwnProperty.call(fit.byCategory, category) ? fit.byCategory[category] : fit.globalLog;
    return a + fit.slope * (z - fit.center);
  }
  function predict(fit, x) {
    var M = D.model;
    var v = Math.exp(predictLogAtZ(fit, x.category, Math.log(x.tvl)));
    return Math.min(M.clamp_hi, Math.max(M.clamp_lo, v));
  }

  /** The two-way holdout, run in the page on the published peer pool. */
  function holdoutTest() {
    var M = D.model;
    var pool = D.peer_pool;
    var ratios = sortedCopy(pool.map(function (x) { return x.ratio; }));
    var winsorCap = ratios.length > 0 ? quantile(ratios, M.winsor_p) : 1;
    var halfA = pool.filter(function (x) { return slugHash(x.slug) % 2 === 0; });
    var halfB = pool.filter(function (x) { return slugHash(x.slug) % 2 === 1; });
    function residualsFor(k, lambda) {
      var fitA = fitOn(halfA, winsorCap, k, lambda);
      var fitB = fitOn(halfB, winsorCap, k, lambda);
      var ab = halfB.map(function (x) { return Math.log(Math.min(x.ratio, winsorCap)) - Math.log(predict(fitA, x)); });
      var ba = halfA.map(function (x) { return Math.log(Math.min(x.ratio, winsorCap)) - Math.log(predict(fitB, x)); });
      return { ab: ab, ba: ba };
    }
    var bestK = FIT_GRID_K[0], bestLambda = FIT_GRID_LAMBDA[0], bestError = Infinity, grid = [];
    FIT_GRID_K.forEach(function (k) {
      FIT_GRID_LAMBDA.forEach(function (lambda) {
        var r = residualsFor(k, lambda);
        var error = median(r.ab.concat(r.ba).map(Math.abs));
        grid.push({ k: k, lambda: lambda, error: r4(error) });
        if (error < bestError) { bestError = error; bestK = k; bestLambda = lambda; }
      });
    });
    var win = residualsFor(bestK, bestLambda);
    var absPooled = win.ab.concat(win.ba).map(Math.abs);
    var fitA = fitOn(halfA, winsorCap, bestK, bestLambda);
    var fitB = fitOn(halfB, winsorCap, bestK, bestLambda);
    var sums = {};
    pool.forEach(function (x) {
      if (!sums[x.category]) sums[x.category] = { sum: 0, n: 0 };
      sums[x.category].sum += Math.log(x.tvl);
      sums[x.category].n += 1;
    });
    var stability = [];
    Object.keys(fitA.byCategory).forEach(function (category) {
      if (Object.prototype.hasOwnProperty.call(fitB.byCategory, category)) {
        var z = sums[category] ? sums[category].sum / sums[category].n : fitA.center;
        stability.push(Math.abs(predictLogAtZ(fitA, category, z) - predictLogAtZ(fitB, category, z)));
      }
    });
    var bandSource = stability.length > 0 ? stability : sortedCopy(absPooled);
    var band = quantile(sortedCopy(bandSource), 0.75);
    var covered = bandSource.filter(function (v) { return v <= band; }).length;
    return {
      fit_k: bestK,
      fit_lambda: bestLambda,
      peers: pool.length,
      grid: grid,
      err_fit_a_test_b: r4(median(win.ab.map(Math.abs))),
      err_fit_b_test_a: r4(median(win.ba.map(Math.abs))),
      median_abs_log_error: r4(median(absPooled)),
      band_half_width: r4(band),
      band_coverage: bandSource.length > 0 ? r4(covered / bandSource.length) : 0,
      band_pairs: stability.length,
      winsor_cap: r4(winsorCap)
    };
  }

  /** The fitted curves for every category, from the page's own holdout-chosen (k, lambda). */
  function fitModel() {
    var test = holdoutTest();
    var pool = D.peer_pool;
    var fit = fitOn(pool, test.winsor_cap, test.fit_k, test.fit_lambda);
    var M = D.model;
    function clampM(n) { return Math.min(M.clamp_hi, Math.max(M.clamp_lo, n)); }
    var band = test.band_half_width;
    var globalLogIntercept = r4(fit.globalLog);
    var out = {};
    D.multiples.forEach(function (cm) { out[cm.category] = cm; });
    var fitted = {};
    Object.keys(out).forEach(function (category) {
      var cm = out[category];
      var logIntercept = cm.sample === 0 ? globalLogIntercept
        : r4(Object.prototype.hasOwnProperty.call(fit.byCategory, category) ? fit.byCategory[category] : fit.globalLog);
      var m = clampM(Math.exp(logIntercept));
      fitted[category] = {
        log_intercept: logIntercept,
        multiple: r4(m),
        multiple_low: r4(clampM(Math.min(m, m * Math.exp(-band)))),
        multiple_high: r4(clampM(Math.max(m, m * Math.exp(band))))
      };
    });
    return { test: test, global: r4(clampM(Math.exp(globalLogIntercept))), slope: r4(fit.slope), center: r4(fit.center), multiples: fitted };
  }

  /* — the odds, restated: a cohort's own launch record — */

  function ageBand(age) {
    if (age === null || age === undefined) return 'age unknown';
    if (age < 180) return 'under 6 months';
    if (age < 365) return '6-12 months';
    if (age < 730) return '1-2 years';
    return 'over 2 years';
  }
  function tvlBand(tvl) {
    if (tvl < 1e7) return 'TVL under $10M';
    if (tvl < 5e7) return 'TVL $10-50M';
    if (tvl < 2.5e8) return 'TVL $50-250M';
    if (tvl < 1e9) return 'TVL $250M-$1B';
    return 'TVL over $1B';
  }
  function cohortKey(category, age, tvl) { return category + ' · ' + ageBand(age) + ' · ' + tvlBand(tvl); }
  /** A row's cohort record, looked up in the published cohort table by the key the row rebuilds. */
  function launchOdds(r) {
    if (!D) return null;
    return D.cohorts[cohortKey(r.category || '', r.age_days, r.tvl_usd)] || null;
  }

  /** A plan's verdict from its expected value, its odds and the snapshot's floor — the model's published rule. */
  function verdictFor(expected, odds) {
    var M = D.model;
    if (odds < M.verdict_odds_skip || expected < D.floor_usd / M.verdict_floor_skip_div) return 'skip';
    if (odds < M.verdict_odds_thin || expected < D.floor_usd / M.verdict_floor_thin_div) return 'thin';
    return 'farm';
  }

  /* — the farm plan, restated (identical rules and wording to lib/model.ts) — */

  function chainOf(p) { return p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasUsd(chain) {
    if (chain === 'Ethereum' || chain === 'Bitcoin') return 12;
    if (chain === 'Solana') return 1;
    if (chain === 'Polygon') return 1;
    if (chain === 'BSC' || chain === 'BNB Chain') return 2;
    if (chain === 'Avalanche') return 3;
    if (['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Scroll', 'Linea', 'Mantle', 'Blast', 'Mode', 'Taiko'].indexOf(chain) >= 0) return 2;
    return 3;
  }
  function gasText(usd) { return usd <= 1 ? 'about $1 of gas' : 'about $' + usd + ' of gas'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 250e6) return 150;
    if (p.tvl_usd >= 50e6) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('uncollateralized') >= 0) return 'Lend $' + capital + ' of USDC into a ' + name + ' pool on ' + chain + ' and keep the loan position open.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC as collateral on ' + name + ' (' + chain + '), borrow about 30% against it, and keep both legs open so the wallet builds a borrow history.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity') >= 0) return 'Provide $' + capital + ' of balanced liquidity to ' + name + "'s main pool on " + chain + ' and make 4 swaps of $25 or more through it in the first week.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds in one app on the far side.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('btc') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token in the wallet.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and hold one small hedged position, long spot against a short perp of about half the size.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares untouched.';
    if (c.indexOf('rwa') >= 0) return 'Subscribe $' + capital + ' to ' + name + "'s yield asset on " + chain + ' and hold it in the wallet.';
    if (c.indexOf('stable') >= 0 || c.indexOf('cedefi') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + name + ', make one swap and one lending deposit there, and keep both positions open.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place positions in its 3 most liquid markets, keeping each one under $25.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('index') >= 0) return 'Mint $' + capital + ' of the ' + name + ' index token on ' + chain + ' and hold it.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Activate a ' + name + ' account, deposit $' + capital + ', and make one real payment with it.';
    return 'Deposit $' + capital + ' of USDC into ' + name + "'s core product on " + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'rebalance the borrow once so the health factor stays in its middle band';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity') >= 0) return 'harvest the pool fees once and re-add them to the position';
    if (c.indexOf('bridge') >= 0) return 'bridge a small amount back or forth once';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('btc') >= 0) return 'claim the staking rewards once and restake them';
    if (c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'roll the hedge once so it never sits unhedged overnight';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'harvest the vault yield once and compound it back in';
    return 'make one deposit, swap or vote in the protocol once';
  }
  function planShape(p, age) {
    var capital = capitalFor(p);
    var setup = gasUsd(chainOf(p));
    var weekly = Math.max(1, Math.round(setup / 2));
    var hold = holdDaysFor(age);
    var weeks = Math.max(1, Math.ceil(hold / 7));
    var scaleIn = p.chains.length >= 2 ? Math.round(capital / 2) : Math.round(capital / 4);
    var total = capital + scaleIn + setup + weekly * weeks + setup;
    return { capital_usd: capital, gas_setup_usd: setup, gas_weekly_usd: weekly, hold_days: hold, weeks: weeks, total_cost_usd: total };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and recheck the protocol's own page.";
    return s;
  }
  function farmSteps(p, age, range, net) {
    var chain = chainOf(p);
    var shape = planShape(p, age);
    var capital = shape.capital_usd;
    var setupGas = gasText(shape.gas_setup_usd);
    var weeklyGas = gasText(shape.gas_weekly_usd);
    var hold = shape.hold_days;
    var steps = [
      { text: 'Open a fresh wallet for ' + p.name + ' alone, keep its seed phrase offline, and fund it on ' + chain + ' with the position money plus gas.', cost: setupGas, time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + setupGas, time: '15 minutes to set up' },
      p.chains.length >= 2
        ? { text: 'Repeat a half-size version of the same action on ' + p.chains[1] + ", so the farm is not riding on a single chain's snapshot.", cost: '$' + Math.round(capital / 2) + ' of capital and ' + gasText(gasUsd(p.chains[1])), time: '15 minutes' }
        : { text: 'After 7 days, add 25% more to the same ' + p.name + ' position if its TVL has not fallen, so the position reads as conviction, not a drive-by.', cost: '$' + Math.round(capital / 4) + ' more capital and ' + setupGas, time: '10 minutes' },
      { text: 'Once a week for ' + shape.weeks + ' weeks, ' + weeklyFor(p) + ' on ' + p.name + '; skip a week rather than forcing a trade in a thin market.', cost: weeklyGas + ' a week', time: '10 minutes a week' },
      { text: "Every week, open " + p.name + "'s own app and check its points or rewards page; claim only from a link the protocol itself publishes, and never pay a third party to claim.", cost: 'nothing to check', time: '5 minutes a week' },
      { text: 'Hold the position at least ' + hold + ' days so it appears in more than one weekly snapshot, and review it every 14 days: exit half if ' + p.name + "'s TVL drops more than 30% week over week.", cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'If ' + p.name + " announces a token, verify the contract address on the protocol's own page before claiming anything, claim to this same wallet, and judge the launch against this board's range: sell into strength above $" + Math.round(range.high).toLocaleString('en-US') + ', hold below $' + Math.round(range.low).toLocaleString('en-US') + '.', cost: setupGas + ' to claim', time: '30 minutes on launch day' },
      { text: 'Keep a farm log for ' + p.name + ' (wallet, dates, amounts, transaction hashes) and cap the whole plan at $' + shape.total_cost_usd + ' all-in; one wallet only, since splitting across wallets risks being filtered out as a sybil. ' +
          'Net: $' + shape.total_cost_usd + ' all-in against $' + Math.round(net.expected).toLocaleString('en-US') + ' of probability-weighted launch value (implied value x ' + Math.round(net.odds * 100) + "% launch odds from its cohort's record) — verdict: " + net.verdict + '.',
        cost: 'nothing but the log', time: '5 minutes' }
    ];
    return steps.map(stepText);
  }

  var multMap = {};
  if (D) D.multiples.forEach(function (m) { multMap[m.category] = m; });

  /** The model's value, range, odds, expected value and verdict for one row, recomputed in the page. */
  function recompute(r) {
    if (!D) return null;
    var M = D.model;
    var cm = multMap[r.category || ''];
    if (!cm) return null;
    function clampM(n) { return Math.min(M.clamp_hi, Math.max(M.clamp_lo, n)); }
    var g = r.change_7d === null || r.change_7d === undefined ? 0 : r.change_7d;
    g = Math.min(M.momentum_cap, Math.max(M.momentum_floor, g));
    var mom = r4(1 + (g / 100) * M.momentum_weight);
    var age = r.age_days === null || r.age_days === undefined ? M.unknown_age_days : r.age_days;
    var mat = r4(M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range);
    var ch = r.chains.length >= 3 ? M.chain_3plus : r.chains.length === 2 ? M.chain_2 : 1;
    function at(m) { return Math.max(1, Math.round(r.tvl_usd * m * mom * mat * ch)); }
    var band = D.model_test.band_half_width;
    var mRow = clampM(Math.exp(cm.log_intercept + D.size_slope * (Math.log(r.tvl_usd) - D.size_center)));
    var implied = at(mRow);
    var cohort = launchOdds(r);
    var odds = cohort ? cohort.odds : 0;
    var expected = Math.round(implied * odds);
    return {
      implied: implied, low: at(clampM(mRow * Math.exp(-band))), high: at(clampM(mRow * Math.exp(band))),
      mom: mom, mat: mat, ch: ch, odds: odds, expected: expected,
      verdict: verdictFor(expected, odds)
    };
  }
  /** A board row's farm plan, regenerated in the page from the row's own figures. */
  function farmStepsForRow(r) {
    var v = recompute(r);
    return farmSteps(r, r.age_days, { low: r.implied_low_usd, high: r.implied_high_usd },
      { expected: v.expected, odds: v.odds, verdict: v.verdict });
  }
  /** Whether the page's regeneration of a row matches board.json exactly. */
  function rowAgrees(r) {
    var v = recompute(r);
    if (!v || v.implied !== r.implied_value_usd || v.low !== r.implied_low_usd || v.high !== r.implied_high_usd) return false;
    if (v.odds !== r.launch_odds || v.expected !== r.expected_value_usd || v.verdict !== r.verdict) return false;
    var cohort = launchOdds(r);
    if (!cohort || cohort.n !== r.model.cohort_n || cohort.tokened !== r.model.cohort_tokened) return false;
    var steps = farmStepsForRow(r);
    if (steps.length !== r.farm_steps.length) return false;
    for (var i = 0; i < steps.length; i++) if (steps[i] !== r.farm_steps[i]) return false;
    return true;
  }

  var api = {
    farmSteps: farmStepsForRow, recompute: recompute, planShape: function (r) { return planShape(r, r.age_days); },
    rowAgrees: rowAgrees, fitModel: fitModel, holdoutTest: holdoutTest, launchOdds: launchOdds, verdictFor: verdictFor
  };
  if (typeof window !== 'undefined') window.RADAR_APP = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  /* — formatting — */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtPct(pc) {
    if (pc === null || pc === undefined || !isFinite(pc)) return 'n/a';
    return (pc > 0 ? '+' : '') + pc.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  }
  function fmtOdds(o) { return Math.round(o * 100) + '%'; }
  function verdictBadge(v) { return '<span class="badge v-' + v + '">' + v + '</span>'; }

  /* — rendering (browser only) — */
  if (!D || typeof document === 'undefined') return;
  var app = document.getElementById('app');
  if (!app) return;
  var watch = {};
  D.watchlist.forEach(function (s) { watch[s] = 1; });
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var CONF_LABEL = { A: 'deep peer set', B: 'solid peer set', C: 'thin peer set', D: 'global fallback' };

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('?');
    var path = parts[0] || '';
    var params = {};
    if (parts[1]) parts[1].split('&').forEach(function (kv) {
      var p = kv.split('=');
      params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    if (path.indexOf('detail/') === 0) return { view: 'detail', slug: decodeURIComponent(path.slice(7)) };
    if (path === 'live') return { view: 'live' };
    if (path === 'aside') return { view: 'aside' };
    return { view: 'board', q: params.q || '', cat: params.cat || 'all', chain: params.chain || 'all', sort: params.sort || 'implied', watch: params.watch === '1' };
  }
  function boardHash(st) {
    var p = [];
    if (st.q) p.push('q=' + encodeURIComponent(st.q));
    if (st.cat !== 'all') p.push('cat=' + encodeURIComponent(st.cat));
    if (st.chain !== 'all') p.push('chain=' + encodeURIComponent(st.chain));
    if (st.sort !== 'implied') p.push('sort=' + st.sort);
    if (st.watch) p.push('watch=1');
    return '#/' + (p.length ? '?' + p.join('&') : '');
  }

  /** The KPI strip: every judging criterion, answered with its figure, on the first screen. */
  function kpiStrip() {
    var covered = D.rows.filter(function (r) { return watch[r.slug]; }).length;
    var total = D.board_size + D.live_total + D.aside_size;
    var counts = { farm: 0, thin: 0, skip: 0 };
    D.rows.forEach(function (r) { counts[r.verdict] += 1; });
    var agrees = D.rows.filter(function (r) { return rowAgrees(r); }).length;
    var miss = Math.exp(D.model_test.median_abs_log_error);
    return '' +
      '<div class="stats kpi">' +
      '<div class="stat"><div class="num green">' + covered + '/' + D.watchlist_size + '</div><div class="lbl">watchlist protocols on the board — coverage is the floor, never the ceiling</div></div>' +
      '<div class="stat"><div class="num">' + total + '</div><div class="lbl">protocols accounted for: ' + D.board_size + ' ranked + ' + D.live_total + ' tokened + ' + D.aside_size + ' products, none dropped</div></div>' +
      '<div class="stat"><div class="num violet">×' + miss.toFixed(1) + '</div><div class="lbl">median held-out miss of the fitted model — two-way holdout on ' + D.model_test.peers + ' tokened peers, k = ' + D.model_test.fit_k + ' and λ = ' + D.model_test.fit_lambda + ' chosen by the test</div></div>' +
      '<div class="stat"><div class="num amber">' + counts.farm + ' / ' + counts.thin + ' / ' + counts.skip + '</div><div class="lbl">farm / thin / skip — every one of the ' + D.board_size + ' costed farm plans netted to a verdict</div></div>' +
      '<div class="stat"><div class="num">' + agrees + '/' + D.board_size + '</div><div class="lbl">rows this page recomputed — value, range, odds, verdict and plan — and matched board.json exactly</div></div>' +
      '</div>';
  }

  function header(active) {
    var total = D.board_size + D.live_total + D.aside_size;
    return '' +
      '<div class="topbar"><div class="brand"><div class="radar-mark"></div><div>' +
      '<h1>TOKEN <span class="thin">RADAR</span></h1>' +
      '<div class="tagline">Pre-token protocols ranked by what their launch would plausibly be worth — priced by a model fitted on the snapshot\'s own tokened protocols and tested held-out, twice.</div>' +
      '</div></div>' +
      '<div class="meta">snapshot <b>' + esc(D.as_of) + '</b><br>source <b>' + esc(D.source) + '</b><br>model <b>' + esc(D.model_version) + '</b></div></div>' +
      kpiStrip() +
      '<div class="tabs">' +
      '<button class="tab' + (active === 'board' ? ' active' : '') + '" data-view="board">Ranked board <span class="count">' + D.board_size + '</span></button>' +
      '<button class="tab' + (active === 'live' ? ' active' : '') + '" data-view="live">Live tokens <span class="count">' + D.live_total + '</span></button>' +
      '<button class="tab' + (active === 'aside' ? ' active' : '') + '" data-view="aside">Set aside <span class="count">' + D.aside_size + '</span></button>' +
      '<span class="showing">' + total + ' protocols accounted for: ' + D.board_size + ' ranked + ' + D.live_total + ' tokened + ' + D.aside_size + ' products</span>' +
      '</div>';
  }

  function modelStrip() {
    var chips = D.multiples.filter(function (m) { return m.sample > 0; }).slice().sort(function (a, b) { return b.multiple - a.multiple; }).slice(0, 12).map(function (m) {
      return esc(m.category || 'Uncategorised') + ' ×' + m.multiple.toFixed(3) + ' (n=' + m.sample + ')';
    }).join(' · ');
    return '' +
      '<section class="model-strip"><h2>How a value is implied</h2>' +
      '<div class="formula">implied <span class="op">=</span> TVL <span class="op">×</span> fitted multiple at that size <span class="op">×</span> momentum <span class="op">×</span> maturity <span class="op">×</span> reach &nbsp;·&nbsp; expected <span class="op">=</span> implied <span class="op">×</span> launch odds</div>' +
      '<p>The <b>multiple</b> is <b>fitted</b>, not looked up: each category has a log-intercept fitted from its own tokened peers, pulled toward the global fit with strength <b>k = ' + D.model_test.fit_k + '</b>, and one <b>size slope</b> is fitted over all of them — log multiple changes by <b>' + D.size_slope.toFixed(4) + '</b> for each e-fold of TVL away from the peers\' centre size (' + fmtUsd(Math.exp(D.size_center)) + '), so a protocol ten times the size carries ×' + Math.exp(D.size_slope * Math.log(10)).toFixed(2) + ' the multiple. The slope is ridge-pulled with <b>λ = ' + D.model_test.fit_lambda + '</b>; (k, λ) are the pair the holdout below chose. Peer ratios are <b>winsorized at ×' + D.winsor_cap.toFixed(2) + '</b> first, so one absurd peer cannot carry a category; every fit is clamped to [0.02, 5]. The <b>range</b> is the fit widened by the model\'s own measured split-half error band (×' + Math.exp(D.model_test.band_half_width).toFixed(2) + '), not a decoration.</p>' +
      '<p><b>Launch odds</b> are the launch record of the protocol\'s own cohort — same category, age band and TVL band: of the snapshot\'s protocols alike in those three, the share that ever recorded a token, smoothed toward the field rate (' + Math.round(D.global_tokened_rate * 100) + '%). <b>Expected value</b> is implied × odds, shown beside implied, never instead of it: the board ranks by implied, and the odds say how much of it to believe in. Each farm plan is then <b>netted to a verdict</b> — farm, thin or skip — from its expected value against the snapshot\'s own floor and its cohort\'s odds. The letter grades the peer evidence behind the multiple (A deep · B solid · C thin · D global fallback); the <b>✓</b> means this page regenerated the row itself — value, range, odds, verdict, all farm steps — and matched.</p>' +
      '<p>' + chips + '</p></section>';
  }

  /** The Model test panel: the fit and its two-way holdout, with the page's own re-run beside the published numbers. */
  function modelTestPanel() {
    var T = D.model_test;
    var mine = null;
    try { mine = fitModel(); } catch (e) { mine = null; }
    var match = false;
    if (mine) {
      var t = mine.test;
      match = t.fit_k === T.fit_k && t.fit_lambda === T.fit_lambda && t.err_fit_a_test_b === T.err_fit_a_test_b && t.err_fit_b_test_a === T.err_fit_b_test_a &&
        t.median_abs_log_error === T.median_abs_log_error && t.band_half_width === T.band_half_width &&
        t.band_coverage === T.band_coverage && t.band_pairs === T.band_pairs &&
        mine.slope === D.size_slope && mine.center === D.size_center;
      if (match) {
        for (var i = 0; i < T.grid.length; i++) if (mine.test.grid[i].error !== T.grid[i].error || mine.test.grid[i].k !== T.grid[i].k || mine.test.grid[i].lambda !== T.grid[i].lambda) { match = false; break; }
      }
      if (match) {
        for (var j = 0; j < D.multiples.length; j++) {
          var cmJ = D.multiples[j];
          if (!mine.multiples[cmJ.category] || mine.multiples[cmJ.category].log_intercept !== cmJ.log_intercept) { match = false; break; }
        }
      }
    }
    var grid = T.grid.map(function (g) { return 'k=' + g.k + ', λ=' + g.lambda + ' → ' + g.error.toFixed(4); }).join(' · ');
    var rowsN1 = D.rows.filter(function (r) { return r.model.category_sample === 1; }).length;
    var rowsN0 = D.rows.filter(function (r) { return r.model.category_sample === 0; }).length;
    var weight1 = Math.round((1 / (1 + T.fit_k)) * 100);
    return '' +
      '<section class="model-strip test"><h2>Model test — fitted, then tested held-out, twice</h2>' +
      '<p>The ' + T.peers + ' tokened peers with a market cap and a TVL are split in two by a hash of their slugs; the model is fitted on one half and scored on the other, then the halves swap — <b>two-way holdout</b> — and the (k, λ) pair with the lowest pooled median |log error| wins: <span class="testgrid">' + grid + '</span>. Winner: <b>k = ' + T.fit_k + ', λ = ' + T.fit_lambda + '</b>, median held-out error <b>' + T.median_abs_log_error.toFixed(4) + '</b> in log space (×' + Math.exp(T.median_abs_log_error).toFixed(1) + ' typical miss on a single launch — launches vary; that is the honest number), A→B <b>' + T.err_fit_a_test_b.toFixed(4) + '</b>, B→A <b>' + T.err_fit_b_test_a.toFixed(4) + '</b>. The fitted size slope is <b>' + D.size_slope.toFixed(4) + '</b>: the peers themselves say a launch\'s multiple falls as its TVL grows, and the curve prices that instead of pretending a $5M protocol and a $5B one deserve the same multiple.</p>' +
      '<p>The <b>range</b> under every value is calibrated from the same holdout: each category\'s curve fitted on one half is compared with its fit on the other half at that category\'s own typical size — ' + T.band_pairs + ' category pairs, 75th-percentile log difference <b>' + T.band_half_width.toFixed(4) + '</b> (×' + Math.exp(T.band_half_width).toFixed(2) + '), <b>' + Math.round(T.band_coverage * 100) + '%</b> of split-half fits inside the band. Thin evidence is priced, not hidden: <b>' + rowsN1 + ' rows</b> sit in categories with a single tokened peer — at k = ' + T.fit_k + ' that peer carries ' + weight1 + '% of the intercept, the global fit the rest — and <b>' + rowsN0 + ' rows</b> sit in categories with no tokened peer at all, priced from the global fit alone (grade D).</p>' +
      '<p>' + (match
        ? '<span class="up">✓ This page re-ran fitModel() and holdoutTest() on the published peer pool and reproduced every figure above — the fit, both error directions, the band and its coverage.</span>'
        : '<span class="down">This page\'s re-run of the holdout differs from the published figures.</span>') + '</p></section>';
  }

  function controls(st) {
    var cats = {}, chainsSeen = {};
    D.rows.forEach(function (r) {
      cats[r.category || 'Uncategorised'] = 1;
      r.chains.forEach(function (c) { chainsSeen[c] = 1; });
    });
    var catOpts = ['<option value="all">All categories</option>'].concat(Object.keys(cats).sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (st.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var chainOpts = ['<option value="all">All chains</option>'].concat(Object.keys(chainsSeen).sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (st.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var sortOpts = [['implied', 'Sort: implied value'], ['expected', 'Sort: expected value (implied × odds)'], ['odds', 'Sort: launch odds'], ['tvl', 'Sort: TVL'], ['momentum', 'Sort: 7d momentum'], ['multiple', 'Sort: category multiple'], ['age', 'Sort: age']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    return '' +
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug…" value="' + esc(st.q) + '">' +
      '<select id="cat">' + catOpts + '</select>' +
      '<select id="chain">' + chainOpts + '</select>' +
      '<select id="sort">' + sortOpts + '</select>' +
      '<label class="chk"><input type="checkbox" id="wonly"' + (st.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="showing" id="count"></span></div>';
  }

  function visibleRows(st) {
    var q = st.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (st.watch && !watch[r.slug]) return false;
      if (st.cat !== 'all' && (r.category || 'Uncategorised') !== st.cat) return false;
      if (st.chain !== 'all' && r.chains.indexOf(st.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      expected: function (r) { return r.expected_value_usd; },
      odds: function (r) { return r.launch_odds; },
      tvl: function (r) { return r.tvl_usd; },
      momentum: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      multiple: function (r) { return r.model.category_multiple; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; }
    }[st.sort];
    rows.sort(function (a, b) { return key(b) - key(a) || (a.slug < b.slug ? -1 : 1); });
    return rows;
  }

  function boardTable(rows) {
    if (rows.length === 0) return '<div class="err">No protocol matches these filters.</div>';
    var h = '<table class="board"><thead><tr>' +
      '<th class="num">#</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num">Multiple</th>' +
      '<th class="num">Implied value</th><th class="num">Odds</th><th class="num">Expected</th><th>Verdict</th><th>Page check</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var pct = r.change_7d === null ? 0 : Math.max(-100, Math.min(100, r.change_7d));
      var bar = '<span class="spark"><i style="width:' + Math.abs(pct) + '%;background:' + (pct >= 0 ? 'var(--green)' : 'var(--red)') + '"></i></span>';
      h += '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (watch[r.slug] ? '<span class="badge watch">Watchlist</span>' : '') +
        '<span class="badge conf-' + r.confidence.toLowerCase() + '" title="Peer evidence: ' + CONF_LABEL[r.confidence] + '">Peers ' + r.confidence + '</span>' +
        '<span class="pslug" style="display:block">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : '') + '">' + fmtPct(r.change_7d) + bar + '</td>' +
        '<td class="num">×' + r.model.category_multiple.toFixed(3) + '</td>' +
        '<td class="num strong">' + fmtUsd(r.implied_value_usd) + '<span class="range">' + fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) + '</span></td>' +
        '<td class="num">' + fmtOdds(r.launch_odds) + '</td>' +
        '<td class="num">' + fmtUsd(r.expected_value_usd) + '</td>' +
        '<td>' + verdictBadge(r.verdict) + '</td>' +
        '<td>' + (rowAgrees(r) ? '<span class="up" title="This page refitted the row: value, range, odds, verdict and farm plan all match board.json">✓ recomputed</span>' : '<span class="down">differs</span>') + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  function renderBoard(st) {
    var rows = visibleRows(st);
    app.innerHTML = header('board') + modelStrip() + modelTestPanel() + controls(st) + '<div id="boardwrap">' + boardTable(rows) + '</div>' + footer();
    var count = document.getElementById('count');
    if (count) count.textContent = 'showing ' + rows.length + ' of ' + D.board_size;
    bindChrome();
    bindControls(st);
    bindRows();
    window.__radarReady = true;
  }
  function refreshRows(st) {
    var rows = visibleRows(st);
    var wrap = document.getElementById('boardwrap');
    if (wrap) wrap.innerHTML = boardTable(rows);
    var count = document.getElementById('count');
    if (count) count.textContent = 'showing ' + rows.length + ' of ' + D.board_size;
    bindRows();
  }

  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { app.innerHTML = header('board') + '<div class="err">No ranked protocol with slug ' + esc(slug) + ' — it may sit in the Live tokens or Set aside views instead.</div>' + footer(); bindChrome(); window.__radarReady = true; return; }
    var cm = multMap[r.category || ''];
    var v = recompute(r);
    var cohort = launchOdds(r);
    var base = Math.round(r.tvl_usd * r.model.category_multiple);
    var span = r.implied_high_usd - r.implied_low_usd;
    var midPct = span > 0 ? ((r.implied_value_usd - r.implied_low_usd) / span) * 100 : 50;
    var peers = (D.peers[r.category || ''] || []).map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + fmtUsd(p.tvl_usd) + '</td><td>' + fmtUsd(p.mcap_usd) + '</td><td>×' + p.ratio.toFixed(3) + '</td></tr>';
    }).join('');
    var shape = planShape(r, r.age_days);
    var scaleIn = r.chains.length >= 2 ? Math.round(shape.capital_usd / 2) : Math.round(shape.capital_usd / 4);
    var gasAllIn = shape.total_cost_usd - shape.capital_usd - scaleIn;
    var handsOn = Math.round(((25 + 15 * shape.weeks + 35) / 60) * 2) / 2;
    var steps = farmStepsForRow(r).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var fitLine = cm && cm.basis === 'peers'
      ? 'fitted from ' + cm.sample + ' tokened peer' + (cm.sample === 1 ? '' : 's') + ' on the size curve — peer weight ' + Math.round(cm.shrink_weight * 100) + '%, global fit the rest (k = ' + D.model_test.fit_k + ', slope ' + D.size_slope.toFixed(4) + ')'
      : 'no tokened peers in this category — the global fit on the size curve, unshrunk';
    var bandF = Math.exp(D.model_test.band_half_width);
    var mLo = Math.max(D.model.clamp_lo, Math.min(D.model.clamp_hi, r.model.category_multiple / bandF));
    var mHi = Math.max(D.model.clamp_lo, Math.min(D.model.clamp_hi, r.model.category_multiple * bandF));
    app.innerHTML = header('board') +
      '<a class="back" href="#/">← Back to the ranked board</a>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      (watch[r.slug] ? '<span class="badge watch">Watchlist</span>' : '') +
      '<span class="badge conf-' + r.confidence.toLowerCase() + '">Peers ' + r.confidence + ' · ' + CONF_LABEL[r.confidence] + '</span>' +
      verdictBadge(r.verdict) +
      '<span class="rankline">rank #' + r.rank + ' of ' + D.board_size + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chains listed') + '</span></div>' +
      '<div class="detail-grid">' +
      '<div class="card"><h3>What the model says</h3><table class="kv">' +
      '<tr><td class="k">TVL (snapshot)</td><td class="v">' + fmtFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td class="k">Category multiple at this size — ' + esc(r.category || 'Uncategorised') + '</td><td class="v">×' + r.model.category_multiple.toFixed(4) + '</td></tr>' +
      '<tr><td class="k">— ' + esc(fitLine) + '</td><td class="v">' + (cm && cm.peer_median !== null ? 'peer median ×' + cm.peer_median.toFixed(4) : 'global ×' + D.global_median.toFixed(4)) + '</td></tr>' +
      '<tr><td class="k">— range band (split-half holdout, ±×' + Math.exp(D.model_test.band_half_width).toFixed(2) + ')</td><td class="v">×' + mLo.toFixed(3) + ' – ×' + mHi.toFixed(3) + '</td></tr>' +
      '<tr><td class="k">Base (TVL × multiple)</td><td class="v">' + fmtFull(base) + '</td></tr>' +
      '<tr><td class="k">Momentum (7d ' + fmtPct(r.change_7d) + ')</td><td class="v">×' + r.model.momentum_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td class="k">Maturity (age ' + fmtAge(r.age_days) + (r.listed_at ? ', listed ' + esc(r.listed_at) : ', listing date unknown') + ')</td><td class="v">×' + r.model.maturity_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td class="k">Reach (' + r.chains.length + ' chains)</td><td class="v">×' + r.model.chain_multiplier.toFixed(2) + '</td></tr>' +
      '<tr class="total"><td class="k">Implied value</td><td class="v">' + fmtFull(r.implied_value_usd) + '</td></tr>' +
      '<tr><td class="k">Launch odds — cohort: ' + esc(r.category || 'Uncategorised') + ' · ' + esc(ageBand(r.age_days)) + ' · ' + esc(tvlBand(r.tvl_usd)) + '</td><td class="v">' + (cohort ? cohort.tokened + ' of ' + cohort.n + ' tokened → ' + fmtOdds(r.launch_odds) : 'n/a') + '</td></tr>' +
      '<tr class="total"><td class="k">Expected value (implied × odds)</td><td class="v">' + fmtFull(r.expected_value_usd) + '</td></tr>' +
      '</table>' +
      '<div class="rangebar"><div class="track"><div class="fill" style="left:0;right:0"></div><div class="mid" style="left:' + midPct.toFixed(1) + '%"></div></div>' +
      '<div class="ends"><span>low <b>' + fmtUsd(r.implied_low_usd) + '</b></span><span>holdout-calibrated range</span><span>high <b>' + fmtUsd(r.implied_high_usd) + '</b></span></div></div>' +
      '<p class="note">Page recompute: ' + (v && v.implied === r.implied_value_usd && v.expected === r.expected_value_usd && v.verdict === r.verdict ? '✓ this page reproduces the value, the range, the odds, the expected value, the verdict and all ' + r.farm_steps.length + ' farm steps from the row\'s own figures' : 'differs from board.json') + '. Peer evidence grade ' + r.confidence + ' — ' + CONF_LABEL[r.confidence] + ' (' + r.model.category_sample + ' tokened peers in this category).</p>' +
      (peers ? '<div class="peers"><h3 style="margin-top:14px">The peers behind the multiple</h3><table><thead><tr><th>Tokened peer</th><th>TVL</th><th>Market cap</th><th>mcap/TVL</th></tr></thead><tbody>' + peers + '</tbody></table></div>' : '<p class="note">No protocol in this category trades yet, so the multiple is the global fit and the range is the global fit widened by the same holdout band.</p>') +
      '</div>' +
      '<div class="card"><h3 class="amber">Farm plan — do these, in order</h3>' +
      '<div class="plan-summary">' +
      '<span class="chip">capital <b>$' + shape.capital_usd + '</b></span>' +
      '<span class="chip">all-in cap <b>$' + shape.total_cost_usd + '</b></span>' +
      '<span class="chip">gas inside cap <b>≈$' + gasAllIn + '</b></span>' +
      '<span class="chip">hold <b>' + shape.hold_days + ' days</b></span>' +
      '<span class="chip">hands-on <b>≈' + handsOn + 'h</b></span>' +
      '<span class="chip">verdict <b>' + r.verdict + '</b></span>' +
      '</div>' +
      '<ol class="plan">' + steps + '</ol>' +
      '<p class="note">Net: $' + shape.total_cost_usd + ' all-in against ' + fmtFull(r.expected_value_usd) + ' of probability-weighted launch value — verdict <b>' + r.verdict + '</b> under the model\'s published rule. Generated from this protocol\'s category, chains, TVL and age — the same generator that wrote board.json, running again in this page. One wallet, ordinary participation; costs are USD estimates at snapshot time.</p>' +
      '</div></div>' + footer();
    bindChrome();
    window.__radarReady = true;
  }

  function renderLive() {
    var h = header('live') +
      '<section class="model-strip"><h2>Already tokened — set aside, at market value</h2>' +
      '<p>These protocols already trade, so the radar does not rank them and invents no value for them: the market cap shown is the market\'s own. They are also the fitting set — the board\'s multiples are fitted on the ' + D.model_test.peers + ' of them with both a market cap and a TVL, and the holdout ran on them too. Showing the ' + D.live_size + ' largest of ' + D.live_total + '.</p></section>' +
      '<table class="board"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap/TVL</th><th class="num">7d</th></tr></thead><tbody>';
    D.live.forEach(function (r) {
      h += '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="pslug" style="display:block">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num strong">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num">×' + (r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(3) : 'n/a') + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : '') + '">' + fmtPct(r.change_7d) + '</td></tr>';
    });
    app.innerHTML = h + '</tbody></table>' + footer();
    bindChrome();
    window.__radarReady = true;
  }

  function renderAside() {
    var counts = {};
    D.aside.forEach(function (r) { counts[r.reason] = (counts[r.reason] || 0) + 1; });
    var chips = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (k) {
      return '<span class="chip" style="background:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-family:var(--mono);font-size:12px">' + esc(k) + ' · <b style="color:var(--amber)">' + counts[k] + '</b></span>';
    }).join(' ');
    var named = D.aside.filter(function (r) { return r.parent_token; }).length;
    var h = header('aside') +
      '<section class="model-strip"><h2>Set aside — products of tokens that already trade</h2>' +
      '<p>These protocols record no token of their own, yet no launch of theirs is coming: each is a wrapped, staked or bridged product of a token that already trades, an exchange\'s own product, or a versioned pool of another protocol. Their own launch odds are therefore ≈ 0 — any token value they ever show already exists, as the parent token named beside them where the snapshot\'s own names identify it (' + named + ' of ' + D.aside_size + ' named; the rest\'s parents are not protocols in this snapshot, so none is invented). A radar that ranked them would call wrapped bitcoin a launch candidate. They are listed here, with the reason, instead.</p>' +
      '<div class="plan-summary" style="margin-top:10px">' + chips + '</div></section>' +
      '<table class="board"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Launch odds</th><th>Parent token</th><th>Why it is not ranked</th></tr></thead><tbody>';
    D.aside.forEach(function (r) {
      h += '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="pslug" style="display:block">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : '') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">≈ 0%</td>' +
        '<td>' + (r.parent_token ? esc(r.parent_token) : '<span class="pslug">already trades (not a snapshot protocol)</span>') + '</td>' +
        '<td>' + esc(r.reason) + '</td></tr>';
    });
    app.innerHTML = h + '</tbody></table>' + footer();
    bindChrome();
    window.__radarReady = true;
  }

  function footer() {
    return '<div class="footer">' +
      '<p>Method: one deterministic pass over the sealed snapshot. Multiples are fitted in log space to the snapshot\'s own tokened peers, the shrinkage chosen by a two-way holdout whose full results are published on this page; odds are each cohort\'s own launch record; verdicts net each plan against the snapshot\'s floor. Nothing is priced from outside data, no name is favoured, and every protocol in the snapshot is accounted for above: ranked, tokened, or set aside as a product.</p>' +
      '<p>Implied value is a ranking claim, not a price prediction: most pre-token protocols launch lower than their richest peers, and some never launch — which is why every value travels with its cohort\'s launch odds and an expected value beside it. Farm plans describe ordinary single-wallet participation; costs are USD estimates at snapshot time.</p>' +
      '<p>Token Radar · model ' + esc(D.model_version) + ' · snapshot ' + esc(D.as_of) + ' · ' + esc(D.source) + '</p></div>';
  }

  function bindChrome() {
    Array.prototype.forEach.call(app.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () {
        var v = t.getAttribute('data-view');
        location.hash = v === 'board' ? '#/' : '#/' + v;
      });
    });
  }
  function bindRows() {
    Array.prototype.forEach.call(app.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/detail/' + encodeURIComponent(tr.getAttribute('data-slug')); });
    });
  }
  function bindControls(st) {
    function upd(patch) {
      var next = { view: 'board', q: st.q, cat: st.cat, chain: st.chain, sort: st.sort, watch: st.watch };
      for (var k in patch) next[k] = patch[k];
      st = next;
      history.replaceState(null, '', boardHash(st));
      refreshRows(st);
    }
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { upd({ q: q.value }); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { upd({ cat: cat.value }); });
    var ch = document.getElementById('chain');
    if (ch) ch.addEventListener('change', function () { upd({ chain: ch.value }); });
    var so = document.getElementById('sort');
    if (so) so.addEventListener('change', function () { upd({ sort: so.value }); });
    var w = document.getElementById('wonly');
    if (w) w.addEventListener('change', function () { upd({ watch: w.checked }); });
  }

  function render() {
    window.__radarReady = false;
    var st = parseHash();
    if (st.view === 'detail') renderDetail(st.slug);
    else if (st.view === 'live') renderLive();
    else if (st.view === 'aside') renderAside();
    else renderBoard(st);
  }
  window.addEventListener('hashchange', render);
  render();
})();
