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
- **Output per goal:** `plannedWeeklyMinutes` — the **weekly plan target** shown in the UI as “X / week”. It does **not** shrink mid-week just because `nowMs` has moved.
- **Schema `WeeklyGoal.targetMinutes`:** when it is the **only** time hint (no explicit weekly or per-day min/max), it does **not** set a floor or ceiling — the goal **equal-shares** Pass 2 like an unconstrained row. For a fixed weekly slice, set **`minMinutesPerWeek` / `maxMinutesPerWeek`** (optionally equal) explicitly.

## Day-sheet credit (before Pass 3)

- Busy events with `sourceId` prefix `daysheet-goal:<goalId>:` count as **logged** time.
- If the same work is also represented as a `source: "actual"` goal override pin, **only unpinned log minutes** reduce placement demand: `unpinnedLogged = max(0, logged − pinnedActual)` is subtracted from `effectiveMinutes` (placement demand).
- **Weekly plan target** (`plannedWeeklyMinutes`) is **unchanged** by this step; only **placement demand** drops so we do not schedule work already logged.

## Pass 3: placement

- Consumes `effectiveMinutes` (placement demand) into calendar blocks inside remaining gaps.
- When `nowMs` is set, **auto** placement uses only the **future** portion of gaps; past intervals are not used for new auto blocks.
- **One auto block per goal per day** (by design): reduces context switching. Additional demand spills to other days in extra passes when availability allows.
- Drag overrides and `source: "actual"` pins are honoured per existing pin rules (including relaxed overlap for actuals vs calendar busy, but not vs sleep).

## Metrics (`WeekMetrics`)

### Per-goal

| Field | Meaning |
|--------|---------|
| `targetMinutes` | `plannedWeeklyMinutes` (Pass 1+2 result; full-week budget). |
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

## Catch-up (web layer)

Baseline allocation used to compute automated catch-up floors typically runs **without** `nowMs`, so floors stay comparable to a full-week plan; the main interactive run may pass `nowMs` for placement.

## Related UI

- Perfect Week budget chips should use `weekCapacityMinutes` (or equivalent) for the same denominator as Pass 1+2.
- Pace badges (`computeGoalRollups`) compare **actual** minutes to `targetMinutes` with **pro-rated** “to date” logic mid-week (see `apps/web/src/lib/review-rollup.ts`). On the **Plan** page, actuals are **`metrics.perGoal[].scheduledMinutes`** (same as the `X / Y` line). **Review** pages use only day-sheet slots and goal marks when `allocatorAchievedByGoal` is omitted.
