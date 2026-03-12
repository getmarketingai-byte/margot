/**
 * TimeMap blocks + Gym automation.
 * Fills remaining daily time with four configurable TimeMap blocks and schedules Gym using
 * preferred windows and duration fallbacks.
 */

// TimeMap title constants (order matters: 1 -> 4).
const TIMEMAP_1_TITLE = "[1-Promote/Creative]";
const TIMEMAP_2_TITLE = "[2-Execute]";
const TIMEMAP_3_TITLE = "[3-Ops/Future]";
const TIMEMAP_4_TITLE = "[4-Play]";
const TIMEMAP_ERRANDS_TITLE = "[Errands]";
const TIMEMAP_SCOUTHALL_TITLE = "[@scouthall]";

// Full-day target durations.
const TIMEMAP_1_HOURS = 4;
const TIMEMAP_2_HOURS = 4;
const TIMEMAP_3_HOURS = 4;
const TIMEMAP_4_HOURS = 2;

// 7h floor profile for linear scaling in the 7h..14h range.
const TIMEMAP_MIN_1_HOURS = 2;
const TIMEMAP_MIN_2_HOURS = 2;
const TIMEMAP_MIN_3_HOURS = 2;
const TIMEMAP_MIN_4_HOURS = 1;

// Multi-segment guard: avoid tiny context-switch blocks.
const TIMEMAP_MIN_BLOCK_MINUTES = 30;
const TIMEMAP_ERRANDS_WINDOW_MINUTES = 60;
const TIMEMAP_SCOUTHALL_BUFFER_MINUTES = 60;
const TIMEMAP_SCOUTHALL_LOCATION_MATCH = "waverleyvalley scout group";

/**
 * Returns the 4 TimeMap titles in execution order.
 * @returns {string[]}
 */
function _timeMapBlockTitles() {
  return [TIMEMAP_1_TITLE, TIMEMAP_2_TITLE, TIMEMAP_3_TITLE, TIMEMAP_4_TITLE];
}

/**
 * Returns a YYYY-M-D key for a Date in local script timezone.
 */
function _timeMapDateKey(d) {
  return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
}

/**
 * True when event location text matches Scout Hall location target.
 */
function _timeMapIsScoutHallLocation(locationText) {
  if (!locationText) return false;
  var normalize = function (s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  };
  var loc = normalize(locationText);
  var target = normalize(TIMEMAP_SCOUTHALL_LOCATION_MATCH);
  return loc.indexOf(target) !== -1;
}

/**
 * Returns true if this calendar should be ignored for TimeMap busy collection.
 */
function _timeMapIsCalendarExcluded(cal, extraExcludedById) {
  var id = cal.getId();
  var name = cal.getName();
  if (extraExcludedById && extraExcludedById[id]) return true;
  // Explicitly include Travel/Sleep as busy inputs even if their names are in CALENDARS_TO_EXCLUDE.
  if (typeof TRAVEL_CALENDAR_ID !== "undefined" && id === TRAVEL_CALENDAR_ID) return false;
  if (typeof SLEEP_CALENDAR_ID !== "undefined" && id === SLEEP_CALENDAR_ID) return false;
  for (var i = 0; i < CALENDARS_TO_EXCLUDE.length; i++) {
    var ex = CALENDARS_TO_EXCLUDE[i];
    if (ex === id || ex === name) return true;
  }
  return false;
}

/**
 * Collects busy intervals for a single day.
 * Includes all non-all-day, non-multi-day busy events from non-excluded calendars.
 * Returns sorted intervals clipped to [dayStartMs, dayEndMs).
 */
function _timeMapCollectBusyIntervals(dayStartMs, dayEndMs, extraExcludedById) {
  var allCalendars = CalendarApp.getAllCalendars();
  var out = [];
  var multiDayThresholdMs = 24 * 60 * 60 * 1000;
  for (var i = 0; i < allCalendars.length; i++) {
    var cal = allCalendars[i];
    if (_timeMapIsCalendarExcluded(cal, extraExcludedById)) continue;
    var events = cal.getEvents(new Date(dayStartMs), new Date(dayEndMs));
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      if (ev.isAllDayEvent()) continue;
      var evStartMs = ev.getStartTime().getTime();
      var evEndMs = ev.getEndTime().getTime();
      if (evEndMs - evStartMs >= multiDayThresholdMs) continue;
      if (typeof _sleepEventIsBusy === "function" && !_sleepEventIsBusy(ev)) continue;
      var s = Math.max(dayStartMs, evStartMs);
      var e = Math.min(dayEndMs, evEndMs);
      if (e > s) out.push({ startMs: s, endMs: e });
    }
  }
  out.sort(function (a, b) { return a.startMs - b.startMs; });
  return out;
}

/**
 * Merges overlapping/adjacent intervals.
 */
function _timeMapMergeIntervals(intervals) {
  if (!intervals || intervals.length === 0) return [];
  var sorted = intervals.slice().sort(function (a, b) { return a.startMs - b.startMs; });
  var merged = [{ startMs: sorted[0].startMs, endMs: sorted[0].endMs }];
  for (var i = 1; i < sorted.length; i++) {
    var cur = sorted[i];
    var last = merged[merged.length - 1];
    if (cur.startMs <= last.endMs) {
      if (cur.endMs > last.endMs) last.endMs = cur.endMs;
    } else {
      merged.push({ startMs: cur.startMs, endMs: cur.endMs });
    }
  }
  return merged;
}

/**
 * Builds free gaps from merged busy intervals inside [dayStartMs, dayEndMs).
 */
function _timeMapFreeGaps(dayStartMs, dayEndMs, mergedBusy) {
  var gaps = [];
  var cursor = dayStartMs;
  for (var i = 0; i < mergedBusy.length; i++) {
    var b = mergedBusy[i];
    if (b.startMs > cursor) gaps.push({ startMs: cursor, endMs: b.startMs });
    if (b.endMs > cursor) cursor = b.endMs;
  }
  if (cursor < dayEndMs) gaps.push({ startMs: cursor, endMs: dayEndMs });
  return gaps;
}

/**
 * Finds the first slot of durationMs in gaps, constrained to a window.
 */
function _timeMapFindSlotInWindow(gaps, windowStartMs, windowEndMs, durationMs) {
  for (var i = 0; i < gaps.length; i++) {
    var s = Math.max(gaps[i].startMs, windowStartMs);
    var e = Math.min(gaps[i].endMs, windowEndMs);
    if (e - s >= durationMs) {
      return { startMs: s, endMs: s + durationMs };
    }
  }
  return null;
}

/**
 * Picks one Gym slot for the day according to window and duration preferences.
 */
function _timeMapPlaceGym(dayStartMs, dayEndMs, freeGaps) {
  var msPerMinute = 60 * 1000;
  var windows = [
    {
      startMs: new Date(dayStartMs).setHours(11, 0, 0, 0),
      endMs: new Date(dayStartMs).setHours(13, 0, 0, 0)
    },
    {
      startMs: dayStartMs,
      endMs: new Date(dayStartMs).setHours(9, 0, 0, 0)
    },
    {
      startMs: dayStartMs,
      endMs: dayEndMs
    }
  ];
  var options = [
    { minutes: 90, useLocation: false },
    { minutes: 45 + 2 * GYM_DRIVE_MINUTES, useLocation: true },
    { minutes: 30 + 2 * GYM_DRIVE_MINUTES, useLocation: true }
  ];
  for (var w = 0; w < windows.length; w++) {
    for (var o = 0; o < options.length; o++) {
      var durationMs = options[o].minutes * msPerMinute;
      var slot = _timeMapFindSlotInWindow(freeGaps, windows[w].startMs, windows[w].endMs, durationMs);
      if (slot) {
        return {
          startMs: slot.startMs,
          endMs: slot.endMs,
          minutes: options[o].minutes,
          useLocation: options[o].useLocation
        };
      }
    }
  }
  return null;
}

/**
 * Splits total minutes into 4 scaled buckets between 7h profile and 14h profile.
 */
function _timeMapScaledDurations(totalMinutes) {
  var full = [TIMEMAP_1_HOURS * 60, TIMEMAP_2_HOURS * 60, TIMEMAP_3_HOURS * 60, TIMEMAP_4_HOURS * 60];
  var mins = [TIMEMAP_MIN_1_HOURS * 60, TIMEMAP_MIN_2_HOURS * 60, TIMEMAP_MIN_3_HOURS * 60, TIMEMAP_MIN_4_HOURS * 60];
  var ratio = (totalMinutes - 7 * 60) / (7 * 60);
  if (ratio < 0) ratio = 0;
  if (ratio > 1) ratio = 1;

  var raw = [];
  var out = [];
  var used = 0;
  for (var i = 0; i < 4; i++) {
    var v = mins[i] + ratio * (full[i] - mins[i]);
    raw.push(v);
    out.push(Math.floor(v));
    used += out[i];
  }
  var remaining = Math.max(0, totalMinutes - used);
  while (remaining > 0) {
    var bestIdx = 0;
    var bestFrac = -1;
    for (var j = 0; j < 4; j++) {
      var frac = raw[j] - Math.floor(raw[j]);
      if (frac > bestFrac) {
        bestFrac = frac;
        bestIdx = j;
      }
    }
    out[bestIdx]++;
    raw[bestIdx] = Math.floor(raw[bestIdx]);
    remaining--;
  }
  return out;
}

/**
 * Builds block events when there are multiple gaps and we want gaps as separators.
 */
function _timeMapBuildMultiGapBlocks(gaps) {
  var titles = _timeMapBlockTitles();
  var minMs = TIMEMAP_MIN_BLOCK_MINUTES * 60 * 1000;
  var usable = gaps
    .filter(function (g) { return (g.endMs - g.startMs) >= minMs; })
    .sort(function (a, b) { return a.startMs - b.startMs; });
  if (usable.length === 0) return [];

  var totalMinutes = 0;
  for (var i = 0; i < usable.length; i++) {
    totalMinutes += Math.floor((usable[i].endMs - usable[i].startMs) / 60000);
  }
  if (totalMinutes < TIMEMAP_MIN_BLOCK_MINUTES) return [];

  var durationsMin;
  if (totalMinutes >= 14 * 60) {
    durationsMin = [TIMEMAP_1_HOURS * 60, TIMEMAP_2_HOURS * 60, TIMEMAP_3_HOURS * 60, TIMEMAP_4_HOURS * 60];
  } else if (totalMinutes >= 7 * 60) {
    durationsMin = _timeMapScaledDurations(totalMinutes);
  } else if (totalMinutes >= 2 * 60) {
    durationsMin = [TIMEMAP_MIN_1_HOURS * 60, TIMEMAP_MIN_2_HOURS * 60, TIMEMAP_MIN_3_HOURS * 60, TIMEMAP_MIN_4_HOURS * 60];
  } else {
    // Tiny multi-gap day: flow what is available with 30m minimum chunks when feasible.
    durationsMin = [0, 0, 0, 0];
    var remaining = totalMinutes;
    for (var d = 0; d < 4; d++) {
      if (remaining < TIMEMAP_MIN_BLOCK_MINUTES) break;
      var slotsLeft = 4 - d;
      var reserveForRest = (slotsLeft - 1) * TIMEMAP_MIN_BLOCK_MINUTES;
      var take = (d < 3 && remaining > reserveForRest + TIMEMAP_MIN_BLOCK_MINUTES)
        ? TIMEMAP_MIN_BLOCK_MINUTES
        : remaining;
      durationsMin[d] = take;
      remaining -= take;
      if (remaining <= 0) break;
    }
  }

  var out = [];
  var blockIdx = 0;
  while (blockIdx < 4 && durationsMin[blockIdx] <= 0) blockIdx++;
  if (blockIdx >= 4) return [];

  var remainingMsForBlock = durationsMin[blockIdx] * 60 * 1000;
  for (var g = 0; g < usable.length && blockIdx < 4; g++) {
    var gapCursor = usable[g].startMs;
    var gapEnd = usable[g].endMs;
    while (gapCursor < gapEnd && blockIdx < 4) {
      var gapRemainingMs = gapEnd - gapCursor;
      var placeMs = Math.min(remainingMsForBlock, gapRemainingMs);
      if (placeMs < minMs) break;
      out.push({
        title: titles[blockIdx],
        startMs: gapCursor,
        endMs: gapCursor + placeMs
      });
      gapCursor += placeMs;
      remainingMsForBlock -= placeMs;
      if (remainingMsForBlock <= 0) {
        blockIdx++;
        while (blockIdx < 4 && durationsMin[blockIdx] <= 0) blockIdx++;
        if (blockIdx < 4) remainingMsForBlock = durationsMin[blockIdx] * 60 * 1000;
      }
    }
  }
  return out;
}

/**
 * Builds blocks for a single contiguous available window.
 */
function _timeMapBuildSingleGapBlocks(startMs, endMs) {
  var titles = _timeMapBlockTitles();
  var totalMinutes = Math.floor((endMs - startMs) / 60000);
  var out = [];
  if (totalMinutes < TIMEMAP_MIN_BLOCK_MINUTES) return out;

  // < 2h: all blocks fill available time.
  if (totalMinutes < 120) {
    for (var t = 0; t < 4; t++) out.push({ title: titles[t], startMs: startMs, endMs: endMs });
    return out;
  }

  // 2h..7h: overlap from end of available window.
  if (totalMinutes < 7 * 60) {
    var b4s = Math.max(startMs, endMs - 60 * 60000);
    var b3s = Math.max(startMs, endMs - 120 * 60000);
    var b2e = b3s;
    var b2s = Math.max(startMs, b2e - 120 * 60000);
    var b1e = b2s;
    var b1s = Math.max(startMs, b1e - 120 * 60000);
    out.push({ title: titles[0], startMs: b1s, endMs: b1e });
    out.push({ title: titles[1], startMs: b2s, endMs: b2e });
    out.push({ title: titles[2], startMs: b3s, endMs: endMs });
    out.push({ title: titles[3], startMs: b4s, endMs: endMs });
    return out;
  }

  var durations;
  if (totalMinutes >= 14 * 60) {
    durations = [TIMEMAP_1_HOURS * 60, TIMEMAP_2_HOURS * 60, TIMEMAP_3_HOURS * 60, TIMEMAP_4_HOURS * 60];
  } else {
    durations = _timeMapScaledDurations(totalMinutes);
  }
  var cursor = startMs;
  for (var i = 0; i < 4; i++) {
    var next = (i === 3) ? endMs : Math.min(endMs, cursor + durations[i] * 60000);
    if (next > cursor) out.push({ title: titles[i], startMs: cursor, endMs: next });
    cursor = next;
  }
  return out;
}

/**
 * Computes daily blocks from free gaps.
 */
function _timeMapComputeDailyBlocks(freeGaps) {
  if (!freeGaps || freeGaps.length === 0) return [];
  if (freeGaps.length > 1) return _timeMapBuildMultiGapBlocks(freeGaps);
  return _timeMapBuildSingleGapBlocks(freeGaps[0].startMs, freeGaps[0].endMs);
}

/**
 * Patches event location using Calendar Advanced Service.
 */
function _timeMapSetEventLocation(calendar, event, locationText) {
  try {
    var eventId = event.getId().slice(0, event.getId().length - 11);
    Calendar.Events.patch({ location: locationText || "" }, calendar.getId(), eventId);
  } catch (e) {
    console.warn("_timeMapSetEventLocation failed: " + e.message);
  }
}

/**
 * Builds [Errands] overlays from Travel [Drive] events.
 * - 1h before "[Drive] To:"
 * - 1h after "[Drive] Home"
 */
function _timeMapBuildErrandsOverlays(rangeStart, rangeEnd) {
  var out = [];
  var travelCal = CalendarApp.getCalendarById(TRAVEL_CALENDAR_ID);
  if (!travelCal) return out;

  var driveEvents = travelCal.getEvents(rangeStart, rangeEnd, { search: TRAVEL_DRIVE_EVENT_TAG });
  var windowMs = TIMEMAP_ERRANDS_WINDOW_MINUTES * 60 * 1000;
  for (var i = 0; i < driveEvents.length; i++) {
    var ev = driveEvents[i];
    if (ev.isAllDayEvent()) continue;
    var title = (ev.getTitle() || "").trim();
    var sMs = ev.getStartTime().getTime();
    var eMs = ev.getEndTime().getTime();
    if (title.indexOf(TRAVEL_DRIVE_EVENT_TAG + " To:") === 0) {
      var beforeStart = sMs - windowMs;
      if (sMs > beforeStart) {
        out.push({
          title: TIMEMAP_ERRANDS_TITLE,
          startMs: beforeStart,
          endMs: sMs,
          key: "ERRANDS_" + beforeStart + "_" + sMs
        });
      }
    } else if (title === TRAVEL_DRIVE_EVENT_TAG + " Home") {
      var afterEnd = eMs + windowMs;
      if (afterEnd > eMs) {
        out.push({
          title: TIMEMAP_ERRANDS_TITLE,
          startMs: eMs,
          endMs: afterEnd,
          key: "ERRANDS_" + eMs + "_" + afterEnd
        });
      }
    }
  }
  return out;
}

/**
 * Builds [@scouthall] overlays from events with matching location.
 * Adds 1h before start and 1h after end.
 */
function _timeMapBuildScoutHallOverlays(rangeStart, rangeEnd) {
  var out = [];
  var allCalendars = CalendarApp.getAllCalendars();
  var bufferMs = TIMEMAP_SCOUTHALL_BUFFER_MINUTES * 60 * 1000;
  for (var i = 0; i < allCalendars.length; i++) {
    var cal = allCalendars[i];
    var calId = cal.getId();
    if (calId === TIMEMAP_CALENDAR_ID) continue;
    var events = cal.getEvents(rangeStart, rangeEnd);
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      if (ev.isAllDayEvent()) continue;
      if (!_timeMapIsScoutHallLocation(ev.getLocation())) continue;
      var sMs = ev.getStartTime().getTime() - bufferMs;
      var eMs = ev.getEndTime().getTime() + bufferMs;
      if (eMs <= sMs) continue;
      out.push({
        title: TIMEMAP_SCOUTHALL_TITLE,
        startMs: sMs,
        endMs: eMs,
        key: "SCOUTHALL_" + sMs + "_" + eMs
      });
    }
  }
  return out;
}

/**
 * Main entry: schedules Gym and TimeMap blocks.
 * @param {number} [dayOffset=0]
 * @param {number} [dayCount]
 * @param {{maxRuntimeMs?: number}} [runOptions]
 */
function addEvents_TimeMapBlocks(dayOffset, dayCount, runOptions) {
  var timemapCal = CalendarApp.getCalendarById(TIMEMAP_CALENDAR_ID);
  if (!timemapCal) {
    console.warn("TimeMap calendar not found. Set TIMEMAP_CALENDAR_ID in Code.gs.");
    return;
  }

  var gymCal = null;
  if (GYM_EVENT_CALENDAR_ID && GYM_EVENT_CALENDAR_ID.indexOf("REPLACE_WITH_") !== 0) {
    gymCal = CalendarApp.getCalendarById(GYM_EVENT_CALENDAR_ID);
    if (!gymCal) console.warn("Gym calendar not found. Set GYM_EVENT_CALENDAR_ID in Code.gs.");
  } else {
    console.warn("GYM_EVENT_CALENDAR_ID is placeholder; Gym scheduling is skipped.");
  }

  var now = new Date();
  var todayStart = new Date(now.getTime());
  todayStart.setHours(0, 0, 0, 0);
  var offset = (dayOffset != null && dayOffset >= 0) ? dayOffset : 0;
  var count = (dayCount != null && dayCount > 0) ? dayCount : SCHEDULING_WINDOW;
  var endDayExclusive = Math.min(offset + count, SCHEDULING_WINDOW);
  var maxRuntimeMs = runOptions && runOptions.maxRuntimeMs ? runOptions.maxRuntimeMs : null;
  var runStartMs = Date.now();

  var desiredByTitle = {};
  var titles = _timeMapBlockTitles();
  for (var t = 0; t < titles.length; t++) desiredByTitle[titles[t]] = [];
  var desiredGym = [];

  var lastProcessedDay = offset - 1;
  for (var i = offset; i < endDayExclusive; i++) {
    if (maxRuntimeMs != null && (Date.now() - runStartMs) >= maxRuntimeMs) break;
    lastProcessedDay = i;

    var dayStart = new Date(todayStart.getTime() + i * 24 * 60 * 60 * 1000);
    var dayEnd = new Date(dayStart.getTime());
    dayEnd.setDate(dayEnd.getDate() + 1);
    var dayStartMs = dayStart.getTime();
    var dayEndMs = dayEnd.getTime();
    var dayKey = _timeMapDateKey(dayStart);

    var excluded = {};
    excluded[TIMEMAP_CALENDAR_ID] = true;
    if (gymCal) excluded[GYM_EVENT_CALENDAR_ID] = true;
    var busy = _timeMapCollectBusyIntervals(dayStartMs, dayEndMs, excluded);
    var mergedBusy = _timeMapMergeIntervals(busy);
    var freeGaps = _timeMapFreeGaps(dayStartMs, dayEndMs, mergedBusy);

    var gymSlot = gymCal ? _timeMapPlaceGym(dayStartMs, dayEndMs, freeGaps) : null;
    if (gymSlot) {
      desiredGym.push({
        key: dayKey + "_Gym",
        title: GYM_TITLE,
        startMs: gymSlot.startMs,
        endMs: gymSlot.endMs,
        location: gymSlot.useLocation ? GYM_LOCATION_SUBSTRING : ""
      });
      busy.push({ startMs: gymSlot.startMs, endMs: gymSlot.endMs });
      mergedBusy = _timeMapMergeIntervals(busy);
      freeGaps = _timeMapFreeGaps(dayStartMs, dayEndMs, mergedBusy);
    }

    var blocks = _timeMapComputeDailyBlocks(freeGaps);
    for (var b = 0; b < blocks.length; b++) {
      var bl = blocks[b];
      if (bl.endMs - bl.startMs < TIMEMAP_MIN_BLOCK_MINUTES * 60 * 1000) continue;
      desiredByTitle[bl.title].push({
        title: bl.title,
        startMs: bl.startMs,
        endMs: bl.endMs,
        key: String(bl.startMs) + "_" + bl.title
      });
    }
  }

  if (lastProcessedDay < offset) {
    console.warn("addEvents_TimeMapBlocks: no days processed this run.");
    return;
  }
  if (maxRuntimeMs != null && lastProcessedDay < endDayExclusive - 1) {
    console.warn("addEvents_TimeMapBlocks: runtime guard reached; synced up to day index " + lastProcessedDay + ".");
  }

  var syncStart = new Date(todayStart.getTime() + offset * 24 * 60 * 60 * 1000);
  syncStart.setHours(0, 0, 0, 0);
  var syncEnd = new Date(todayStart.getTime() + (lastProcessedDay + 1) * 24 * 60 * 60 * 1000);
  syncEnd.setMilliseconds(syncEnd.getMilliseconds() - 1);

  for (var q = 0; q < titles.length; q++) {
    var title = titles[q];
    _syncCalendarEvents(timemapCal, title, syncStart, syncEnd, desiredByTitle[title], {
      keyFromExisting: function (ev) {
        return String(ev.getStartTime().getTime()) + "_" + (ev.getTitle() || "");
      }
    });
  }

  var desiredErrands = _timeMapBuildErrandsOverlays(syncStart, syncEnd);
  _syncCalendarEvents(timemapCal, TIMEMAP_ERRANDS_TITLE, syncStart, syncEnd, desiredErrands, {
    keyFromExisting: function (ev) {
      return "ERRANDS_" + ev.getStartTime().getTime() + "_" + ev.getEndTime().getTime();
    }
  });

  var desiredScoutHall = _timeMapBuildScoutHallOverlays(syncStart, syncEnd);
  _syncCalendarEvents(timemapCal, TIMEMAP_SCOUTHALL_TITLE, syncStart, syncEnd, desiredScoutHall, {
    keyFromExisting: function (ev) {
      return "SCOUTHALL_" + ev.getStartTime().getTime() + "_" + ev.getEndTime().getTime();
    }
  });

  if (gymCal) {
    _syncCalendarEvents(gymCal, GYM_TITLE, syncStart, syncEnd, desiredGym, {
      keyFromExisting: function (ev) {
        var kDate = ev.getStartTime();
        return _timeMapDateKey(kDate) + "_Gym";
      },
      onEventSynced: function (calendar, event, desired) {
        _timeMapSetEventLocation(calendar, event, desired.location || "");
      }
    });
  }
}

/** Convenience trigger entry point for only TimeMap blocks + Gym. */
function update_Master_TimeMap_TimeMapBlocks() {
  addEvents_TimeMapBlocks(0, SCHEDULING_WINDOW, { maxRuntimeMs: 5 * 60 * 1000 });
}
