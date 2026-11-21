# Token Radar — Raphael's entry (model v4)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Alcyone-9/token-radar-01-v4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Alcyone-9/token-radar-01-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that have not launched a token yet — and only those. Every protocol
in the sealed snapshot is accounted for, in three sets that are told apart before anything
is priced:

- **198 launch candidates** — record no token, and are no traded token's product. These the
  board ranks by implied value, each with a holdout-calibrated range, a peer-evidence
  grade, cohort launch odds, an expected value, and a farm plan netted to a verdict. The
  40-protocol watchlist is the floor, never the ceiling.
- **416 already tokened** — set aside at the market's own values; never ranked. They are
  also the comparable set the model is fitted on.
- **144 products of traded tokens** — record no token, yet no launch of theirs is coming:
  wrapped, staked or bridged products (WBTC, Binance staked ETH, USDT0…), exchange
  products, and versioned pools of other protocols, identified by the house's own
  watchlist test (excluded category, a wrapped/staked word in the name, a version marker,
  an exchange prefix) applied to the whole snapshot. Each is listed with its reason, its
  launch odds (≈ 0) and its parent token where the snapshot's own names identify it
  (6 of 144 — WBTC → BTC, Binance staked ETH → ETH, …; the other parents are not protocols
  in this snapshot, so none is invented). A radar that ranks them is ranking the wrong
  thing.

198 + 416 + 144 = 758: the whole snapshot, nothing dropped silently.

## What changed in v4

Version 3 fitted one multiple per category — which prices a $5M lending market and a
$5B one at the same multiple. The snapshot's own peers say size is systematic: across
the 128 tokened peers that carry both a market cap and a TVL, the log multiple falls
with log TVL at a slope of ≈ −0.45 (correlation −0.42). Version 4 fits the size curve
as well as the category:

- Each category keeps its own log-intercept, but all intercepts sit on **one global
  size curve** — `multiple = exp(intercept_category) × TVL^(slope)` — fitted jointly
  over the peer pool, winsorized and clamped exactly as in v3.
- The slope is not free to chase noise: it is ridge-shrunk (λ), and both the shrinkage
  k and the ridge λ are chosen by the same two-way holdout as v3, now over a
  k × λ grid (k ∈ {2, 4, 6, 10, 16, 24, 40}, λ ∈ {0, 8, 32}). The winner is
  **k = 16, λ = 8**.
- The pooled median held-out |log error| falls from v3's **1.5947 to 1.1971** — the
  typical launch now lands ×3.3 from its fitted value instead of ×4.9. The full grid,
  both error directions and the range band are published in the Model test panel, as
  before.

Everything else carries over unchanged: the 198 / 416 / 144 separation, the cohort
launch odds and expected values, the farm verdicts, and the holdout-calibrated ranges.
The fit still rests on the same 128 of 416 tokened peers — v4 widened the model, not
the evidence, and says so.

## What changed in v3

Version 2 priced candidates from winsorized category medians shrunk by a fixed constant —
a reasonable statistic that was never fitted and never tested out of sample, carried no
launch odds, and left its farm plans without a verdict. Version 3 keeps the separation and
the factor structure, and rebuilds the pricing core:

### The multiples are fitted, and the fit is tested held-out — twice

`multiple(category)` is fitted in log space to the snapshot's own tokened peers (the 128
of the 416 that carry both a market cap and a TVL): the category's mean log ratio, pulled
toward the global fitted log-ratio with strength k — the category's own weight is
n/(n+k). Peer ratios are winsorized at the field's 95th percentile (×12.16) first, and
every fit is clamped to [0.02, 5].

The pull strength k is not asserted; it is **chosen by a two-way holdout**. The peer pool
is split in two deterministic halves (by a hash of the slug — no clock, no chance), the
model is fitted on one half and scored on the other, then the halves swap. On this
snapshot the pooled median |log error| by k:

| k | 2 | 4 | 6 | 10 | 16 | 24 | 40 |
|---|---|---|---|---|---|---|---|
| median \|log error\| | **1.5947** | 1.5962 | 1.6360 | 1.6672 | 1.6295 | 1.6036 | 1.6276 |

k = 2 wins; fit-on-A → test-on-B errs 1.5816, fit-on-B → test-on-A 1.6377. A median
held-out error of 1.5947 means a single launch typically lands ×4.9 from its category's
multiple — wide, and published on the dashboard rather than hidden, because it is the
truth about how far category pricing can see.

The **range** under each value is calibrated from the same holdout, at the level a range
should describe — the estimate itself: each category's multiple fitted on one half is
compared with its fit on the other half (18 category pairs), and the 75th percentile of
those split-half log differences (1.1337, a ×3.11 band; 77.8% of split-half fits land
inside it) widens every fitted multiple into its low/high.

Thin evidence is priced explicitly. 47 of the 198 rows sit in categories with exactly one
tokened peer: at k = 2 that peer carries 33% of the multiple and the global fit carries
the rest, and the detail view says so. 18 rows sit in categories with no tokened peer at
all: priced from the global fit alone, graded D. Confidence grades stay A (8+ peers),
B (4+), C (1+), D (none).

### Every candidate carries its cohort's launch odds, and an expected value

A launch is not certain, so each row also carries the launch record of its own cohort:
of the snapshot's protocols in the same category, age band and TVL band, the share that
ever recorded a token — smoothed toward the field-wide rate (416/758 = 54.9%) with a
prior of five phantom protocols, because the cells are thin (321 cohorts, median size 1)
and a cohort of two must not claim certainty either way. On this snapshot the odds run
0.25–0.79, median 0.46. **expected = implied × odds** is printed beside implied on every
row, with the cohort's own counts (tokened of n) in the detail view.

The board still ranks by implied value — that is the board's contract, and the internal
test says the odds do not overturn it: ranking by expected instead would keep 38 of the
implied top 40 in the top 40, and only one protocol (implied #11) would enter the top 10.
So implied keeps the rank, expected is a first-class column and a dashboard sort order,
and the verdicts below spend the odds where they bite.

### Every farm plan is netted to a verdict

Each plan's last step now closes with its net line — all-in cost against
probability-weighted launch value — and a verdict from the model's published rule:
**skip** when the cohort odds fall under 30% or the expected value under 1% of the
snapshot's own $50M floor; **thin** when odds fall under 45% or expected value under 5%
of the floor; **farm** otherwise. On this snapshot: 60 farm, 97 thin, 41 skip. The
verdict is a chip on the board, a line in the detail view, and the closing words of the
plan itself.

`implied = TVL × fitted multiple × momentum × maturity × reach`, with momentum
`1 + clamp(change_7d, −60, +120)/100 × 0.5`, maturity `0.6 + min(age, 1095)/1095 × 0.4`
(unknown age counts 365 days), reach ×1.10 / ×1.05 / ×1 for 3+ / 2 / 1 chains. No
protocol name is ever special-cased: one function scores every row, and every number
comes from the snapshot itself.

## Farm plans

Eight generated steps per protocol, from its own category, chains, TVL and age: a
dedicated wallet, the category's core action with a capital tier and a working target, a
second-chain footprint (or a conviction add-on), a weekly qualifying action, points
hygiene (claim only from the protocol's own links), a hold window with a TVL exit rule, a
post-launch step that judges the launch against the board's own range (sell into strength
above the high, hold below the low), and a farm log with an all-in budget cap — closing
with the plan's net line and verdict. Every step carries its cost and its time.

## The dashboard

`dashboard/` is a static page (no framework, no network) fed by the `data.js` the program
writes beside it. Three views — the ranked board, the live tokens, the set-aside products
with their reasons — plus search, category and chain filters, a watchlist-only toggle,
seven sort orders (implied, expected, odds, TVL, momentum, multiple, age), and a full-page
detail view per protocol. Routes are hash URLs, so every view is reproducible.

A **KPI strip** on the first screen answers each judging criterion with its figure:
watchlist coverage 40/40, all 758 protocols accounted for, the model's median held-out
miss, the verdict split of the 198 costed plans, and the page-check count. A **Model test
panel** publishes the full holdout — the k grid, both error directions, the range band
and its coverage, and the thin-evidence counts.

The page runs the whole model itself: the fit, the holdout, the odds, the verdicts and
the farm-plan generator are restated in `app.js` (fitModel(), holdoutTest(),
launchOdds(), verdictFor()), every row is regenerated in the page from the published
peer pool, cohort table and the row's own figures, and each row is marked ✓ where the
regeneration matches `board.json`. A build-time check over the practice snapshot proves
the agreement for all 198 rows — values, ranges, odds, expected values, verdicts, plan
shapes and every step, letter for letter — and the page's own holdout re-run reproduces
the published test figures exactly.

The screenshots are real renders of this page (headless Chrome over the built output):
the board with its KPI strip and Model test panel, the top-ranked protocol's detail view,
and the Lending category filtered by momentum. They are palette-quantized to 160 colours
at full 1440px resolution (PSNR 40–42 dB against the raw renders; palette quantization
keeps text edges hard, unlike JPEG) — the dossier is a tie-break, so it travels light:
552,780 bytes against v2's 1,187,117. That is heavier than v3's 458,152 — the v4 board
renders denser panels — and the trade was made deliberately: model accuracy first,
tie-break bytes second.

## Run

```
node main.ts --input <snapshot.json|directory>   # writes /output (or $MAKEFUN_OUTPUT_DIR)
```

Node 22+, standard library only. Two runs over the same snapshot are byte-identical:
the model reads no clock and no randomness (the holdout split is a hash of the slug).

## Layout

- `main.ts` — entry point: snapshot in, board + data + dashboard + screenshots + dossier out.
- `lib/model.ts` — the separation, the fit and its holdout, the cohort odds, the verdicts,
  the board builder, the farm-plan generator, the gate self-check.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored as provided
  (byte-identical to the current kit's).
- `dashboard/` — the page. `screenshots/` — the board, a detail view, a filtered view.
