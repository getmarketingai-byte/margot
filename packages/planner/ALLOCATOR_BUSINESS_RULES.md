# Perfect Week allocator — business rules

Canonical implementation: [`src/weekly.ts`](src/weekly.ts). This document is the product contract; keep it in sync when changing allocation behaviour.

## Time horizons

| Concept | Meaning |
|--------|---------|
| **Full ISO week** | Monday 00:00 → next Monday 00:00 in the plan’s timezone (`weekStartMs` … `weekEndMs`). |
| **`nowMs`** | Optional “current instant”. Auto-placed blocks must not end in the purely past; gaps are clipped when measuring **from-now** capacity. |

## Pass 1+2: weekly plan targets (distribution)

- **Input budget:** `weekCapacityMinutes` — sum of **all** free-gap minutes in the week **after** non-negotiable consistency segments (and any segment reservation that consumed gaps), **without** clipping to `nowMs`.
- **Pass 1:** Reserves each goal’s weekly floor (`minMinutesPerWeek`, subject to weekly cap).
- **Pass 2:** Splits the **remainder** of `weekCapacityMinutes` across eligible goals (`allocationSharePercent` weighting + equal share for others). Packing mode (`even` vs `finish-early`) affects **calendar layout only**, not these minute totals.
- **Catch-up overlay (`catchUpFloors`):** Applied **after** Pass 2 and **weekly group caps**, **per listed goal only** — adjusts that goal’s `plannedWeeklyMinutes` and `effectiveMinutes` together on the quantum grid (`QUANTUM` from [`weekly-grid.ts`](src/weekly-grid.ts)), bounded by weekly min/max. Other goals retain their Pass‑2 remainder split (no historical Pass‑1 floor inflation side effects).
- **Output per goal:** `plannedWeeklyMinutes` — the **weekly plan target** shown in the UI as “X / week”. Catch-up overlays can raise or lower targets for affected goals mid-week (positive = catch‑up chip + demand). `nowMs` still does **not** rescale Pass 1+2 themselves.
- **Schema `WeeklyGoal.targetMinutes`:** when it is the **only** time hint (no explicit weekly or per-day min/max), it does **not** set a floor or ceiling — the goal **equal-shares** Pass 2 like an unconstrained row. For a fixed weekly slice, set **`minMinutesPerWeek` / `maxMinutesPerWeek`** (optionally equal) explicitly.

## Day-sheet credit (before Pass 3)

- Busy events with `sourceId` prefix `daysheet-goal:<goalId>:` count as **logged** time.
- If the same work is also represented as a `source: "actual"` goal override pin, **only unpinned log minutes** reduce placement demand: `unpinnedLogged = max(0, logged − pinnedActual)` is subtracted from `effectiveMinutes` (placement demand).
- **Weekly plan target** (`plannedWeeklyMinutes`) is **unchanged** by this step; only **placement demand** drops so we do not schedule work already logged.

## Pass 3: placement

- Consumes `effectiveMinutes` (placement demand) into calendar blocks inside remaining gaps.
- When `nowMs` is set, **auto** placement uses only the **future** portion of gaps; past intervals are not used for new auto blocks.
- **One auto block per goal per day** (by design): reduces context switching. **`frequencyPerWeek`** is capped by how many **allowed** weekdays still have a **future** placement window (`nowMs`-aware): effective touch ceiling is `min(frequencyPerWeek, daysRemainingWithWindow)` — e.g. 4× across the week becomes at most **3** if only Fri–Sun remain schedulable. Additional demand spills in **extra passes** when availability allows. Each pass walks the goal's allowed weekdays (see below) at most once and can place at most **one** new block for that goal on each allowed day—so a **fragmented** day (many small pockets) or tight invert / nice-weather windows may require **many** passes. The spill loop uses a **scaled `maxPasses`** (derived from quantised remaining demand × `allowedDays.length`, with floor and absolute cap) so we do not stop early while gaps and headroom still exist; passes that schedule nothing still exit immediately.
- **Stable greedy ties:** %-share vs equal-share interleaving resolves equal-quantum demand ties with **fixed** order (`nice-weather constraint`, then tighter `maxMinutesPerDay`, then **`goal.id` lexical**). Gap choice breaks equal scores by **earliest `gap.startMs`**, then **`gap.endMs`**. Ideal-clock alignment breaks ties with the **lower ideal-time index**.
- **Nice-weather bias (`niceWeatherWindows` non-empty):** goals with **`scheduleInNiceWeather`** iterate days **descending** by future minutes in `niceWeather ∩ free gaps`, so placements anchor on forecast-nice days. **Unconstrained** goals iterate **ascending** by the same overlap, filling days with little or no nice slack before occupying shared sunny pockets—so constrained goals stay inside their outdoor windows whenever another day can take the spill. At the **same commitment / floor / gym tier**, `scheduleInNiceWeather` rows are ordered **ahead of** unconstrained peers (including demand-based round‑robin sort so they do not lose the week to generic greedy passes).
- Drag overrides and `source: "actual"` pins are honoured per existing pin rules (including relaxed overlap for actuals vs calendar busy, but not vs sleep).

## Modelled sleep vs scheduler-owned busy

- **Rule:** Events this product **schedules or proposes** (allocator blocks, synthetic routines, and other planner output on the week model) **must not displace modelled sleep** from its ideal target window or force gap / split / shrink placement—**except** for **drive** legs, which may still constrain sleep the same way as real calendar travel.
- **Drive (allowed to move sleep):** Titles treated as travel-like for this purpose match [`isTravelLikeConflictTitle`](src/sleep.ts) (`[Drive]` prefix, or `->` for drive-direct). Caller-specific shaping (e.g. outbound wake pull, `[Drive] Home` + buffer) lives in [`apps/web/src/lib/week-blocks.ts`](../../apps/web/src/lib/week-blocks.ts) before `placeSleepBlock`.
- **Integration:** [`apps/web/src/lib/week-blocks.ts`](../../apps/web/src/lib/week-blocks.ts) `computeSleepBlocks` omits `source: "internal"` busy from the `sleepBusy` stream unless the title matches a travel/drive leg for `travel.driveEventTag` (same shapes as synthetic `[Drive]` blocks). [`placeSleepBlock`](src/sleep.ts) still receives calendar busy (Google / ICS / Microsoft) unchanged, so a real same-title event on a provider calendar can still displace modelled sleep.

## Goal groups (aggregate constraints)

- **Definitions:** [`GoalGroup`](../schema/src/goals.ts) rows live on [`WeeklyPlan.goalGroups`](../schema/src/goals.ts); goals reference them via [`WeeklyGoal.groupIds`](../schema/src/goals.ts). Scheduling knobs are the same **picked** fields as on goals (`allocationSharePercent`, weekly/day min/max, cadence, placement windows, etc.); group rows use aggregate semantics (sum across member goals), not commitment tiers or framework mirrors.
- **Weekly caps (after Pass 1+2 targets, before Pass 3 demand trimming):** For each group, member **`plannedWeeklyMinutes`** are compared to the same ceiling interpretation as a single goal built from the group’s constraint fields (`stubWeeklyGoalFromGoalGroup` + `normaliseGoalTime`), using full-week capacity **`T`** = `weekCapacityMinutes` (same denominator as Pass 2 `%` of week). When the aggregate exceeds the cap, minutes come down proportionally from goals that have slack above their Pass 1 floors; if there is no slack, a **`goalGroupGaps` `weeklyCap`** row records the shortfall.
- **Weekly floors:** A group **`minMinutesPerWeek`** below the sum of member weekly targets surfaces **`weeklyFloor`** in `goalGroupGaps` (planning signal only — targets are not grown automatically).
- **Pass 3 daily intersection:** Per goal, existing `maxMinutesPerDay` / `minMinutesPerDay` headroom intersects with **each** member group’s aggregate usage that day (pins + auto blocks + `daysheet-goal:` logs for every member). The **tightest** remaining headroom applies, matching how goal-level caps already interact with logging.
- **Metrics:** `WeekMetrics.goalGroupMinutes` totals achieved weekly minutes per group (same basis as `perGoal.scheduledMinutes`). `goalGroupGaps` also receives **`dailyCap`** entries when post-hoc aggregate usage on a day exceeds a group’s normalised daily maximum.

## Metrics (`WeekMetrics`)

### Per-goal

| Field | Meaning |
|--------|---------|
| `targetMinutes` | `plannedWeeklyMinutes` after Pass 1+2, group caps, and any **catch-up overlay** (`catchUpFloors`), before logs / `nowMs` trimming of placement demand only. |
| `scheduledMinutes` | **Achieved:** merged **union** of wall-time intervals from `daysheet-goal:` busy events and **all** allocator blocks for that goal (including actual pins). Overlaps count once so the same slot is not credited as both logged and proposed. |
| `unplacedMinutes` | `max(0, placementDemandAfterLogs − sum(all goal block minutes for that id))`. |

### Utilisation

| Field | Meaning |
|--------|---------|
| `weekCapacityMinutes` | Pre–Pass 3 full-week free gap total (Pass 1+2 denominator). |
| `weekCapacityFromNowMinutes` | Same, clipped at `nowMs` **before** Pass 3. |
| `availableMinutes` | Full-week free gaps **after** Pass 3. |
| `availableFromNowMinutes` | After Pass 3, clipped at `nowMs`. |
| `scheduledMinutes` | Sum of non-segment goal **block** minutes (PPF / mix calculations). |

## Personal energy (battery) mode

- **When off** (`UserSettings.personalSystem.energyBatterySchedulingEnabled === false`, default): Pass 3 gap scoring is unchanged from the historic allocator.
- **When on**: an extra additive score is applied in `pickGapForGoal` (on top of existing `energyMode` + framework suggestion signals):
  - **Day load:** `computeDayCalendarDrainScores` from busy intervals vs a ~14h reference day.
  - **Goal shape:** `effectiveEnergyBatteryProfile(goal)` — explicit `energyChargeImpact` / `energyDrainImpact` on `WeeklyGoal`, else `focusAffinity`, else inferred tags (`attentionMode`, `energyMode`, `energyPolarity`, `workLayer`).
  - **Transitions:** penalises adjacent high-drain blocks; bonuses high-charge goals after high-drain neighbours and when the day is already calendar-heavy (guided scale knobs in `personalSystem.guided`).
  - **Advanced rules:** optional weighted rule cards (`personalSystem.advancedRules`) further nudge placement when their conditions match.
- **`WeekMetrics.personalEnergyPlan`:** populated only when battery mode is on — returns the seven day drain estimates used for the run and UI **tuning hints** (non-binding suggestions).

## Catch-up / pace baseline (web layer)

Automated rollup catch-up derives positive minute recommendations from [`computeGoalRollups`](../../apps/web/src/lib/review-rollup.ts) vs **Pass‑1/2-only** weekly targets (`baselineWeeklyMinuteTargets` in [`weekly.ts`](src/weekly.ts)) — **no nested full `allocateWeek`** — so pace denominators stay stable. The interactive run passes those values as `catchUpFloors` (plus manual weekly-review adjustments when `catchUpMode` is `"manual"`). Positive entries raise that goal’s **chip + placement demand**; negative entries trim (weekly min/max still apply).

## Related UI

- Perfect Week budget chips should use `weekCapacityMinutes` (or equivalent) for the same denominator as Pass 1+2.
- Pace badges (`computeGoalRollups`) compare **actual** minutes to `targetMinutes` with **pro-rated** “to date” logic mid-week (see `apps/web/src/lib/review-rollup.ts`). On the **Plan** page, actuals are **`metrics.perGoal[].scheduledMinutes`** (same as the `X / Y` line). **Review** pages use only day-sheet slots and goal marks when `allocatorAchievedByGoal` is omitted.
