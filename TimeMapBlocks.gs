/**
 * TimeMap blocks + Gym automation.
 * Fills remaining daily time with four configurable TimeMap blocks and schedules Gym using
 * preferred windows and duration fallbacks.
 */

function _timeMapDebugLog(runId, hypothesisId, location, message, data) {
  return;
}

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
 * Formats epoch ms in script timezone for readable debug logs.
 */
function _timeMapFormatMsLocal(ms) {
  if (ms == null) return null;
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(ms), tz, "yyyy-MM-dd HH:mm:ss Z");
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
 * True if this calendar looks like a SkedPal calendar (name or ID).
 */
function _timeMapIsSkedpalCalendar(cal) {
  var id = String(cal.getId() || "").toLowerCase();
  var name = String(cal.getName() || "").toLowerCase();
  return id.indexOf("skedpal") !== -1 || name.indexOf("skedpal") !== -1;
}

/**
 * Returns true if this calendar should be ignored for TimeMap busy collection.
 */
function _timeMapIsCalendarExcluded(cal, extraExcludedById) {
  var id = cal.getId();
  var name = cal.getName();
  var isSkedpal = _timeMapIsSkedpalCalendar(cal);
  if (extraExcludedById && extraExcludedById[id]) return true;
  // Explicitly include Travel/Sleep as busy inputs even if their names are in CALENDARS_TO_EXCLUDE.
  if (typeof TRAVEL_CALENDAR_ID !== "undefined" && id === TRAVEL_CALENDAR_ID) return false;
  if (typeof SLEEP_CALENDAR_ID !== "undefined" && id === SLEEP_CALENDAR_ID) return false;
  if (isSkedpal) return !TIMEMAP_TREAT_SKEDPAL_AS_BUSY;
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
function _timeMapCollectBusyIntervals(dayStartMs, dayEndMs, extraExcludedById, allCalendars, debugMeta) {
  var calendars = allCalendars || CalendarApp.getAllCalendars();
  var out = [];
  var multiDayThresholdMs = 24 * 60 * 60 * 1000;
  for (var i = 0; i < calendars.length; i++) {
    var cal = calendars[i];
    if (_timeMapIsCalendarExcluded(cal, extraExcludedById)) continue;
    var isSkedpal = _timeMapIsSkedpalCalendar(cal);
    var events = cal.getEvents(new Date(dayStartMs), new Date(dayEndMs));
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      if (ev.isAllDayEvent()) {
        if (isSkedpal && debugMeta) debugMeta.skedpalAllDaySkipped++;
        continue;
      }
      var evStartMs = ev.getStartTime().getTime();
      var evEndMs = ev.getEndTime().getTime();
      if (evEndMs - evStartMs >= multiDayThresholdMs) {
        if (isSkedpal && debugMeta) debugMeta.skedpalMultiDaySkipped++;
        continue;
      }
      // Busy/free transparency checks are expensive (Calendar.Events.get per event).
      // Restrict them to SkedPal where free blocks are commonly used for planning.
      var skedpalBusyState = null;
      if (isSkedpal) {
        if (debugMeta) debugMeta.skedpalSeen++;
        if (typeof _eventIsBusyByTransparency === "function") {
          skedpalBusyState = _eventIsBusyByTransparency(ev, cal.getId(), cal.getName() || "");
          if (!skedpalBusyState) {
            if (debugMeta) debugMeta.skedpalFreeSkipped++;
            continue;
          }
          if (debugMeta) debugMeta.skedpalBusyIncluded++;
        } else if (debugMeta) {
          debugMeta.skedpalBusyCheckUnavailable++;
        }
      }
      var s = Math.max(dayStartMs, evStartMs);
      var e = Math.min(dayEndMs, evEndMs);
      if (e > s) {
        out.push({ startMs: s, endMs: e });
        if (debugMeta) {
          var calId = cal.getId();
          var calName = cal.getName() || "";
          var title = ev.getTitle() || "";
          var durationMinutes = Math.floor((e - s) / 60000);
          if (!debugMeta.calendarCounts[calName]) debugMeta.calendarCounts[calName] = 0;
          debugMeta.calendarCounts[calName]++;
          if (debugMeta.samples.length < 10) {
            var transparency = null;
            if (isSkedpal) {
              transparency = skedpalBusyState == null ? "unknown" : (skedpalBusyState ? "busy" : "transparent");
            }
            debugMeta.samples.push({
              calId: calId,
              calName: calName,
              title: title,
              startMs: s,
              endMs: e,
              durationMinutes: durationMinutes,
              transparency: transparency
            });
          }
        }
      }
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
 * Loads merged [Outside] intervals from the TimeMap calendar for a day window.
 */
function _timeMapGetOutsideIntervalsForDay(timemapCal, dayStartMs, dayEndMs) {
  if (!timemapCal) return [];
  var outsideEvents = timemapCal.getEvents(new Date(dayStartMs), new Date(dayEndMs), { search: "[Outside]" });
  var intervals = [];
  for (var i = 0; i < outsideEvents.length; i++) {
    var ev = outsideEvents[i];
    if (ev.isAllDayEvent()) continue;
    var s = Math.max(dayStartMs, ev.getStartTime().getTime());
    var e = Math.min(dayEndMs, ev.getEndTime().getTime());
    if (e > s) intervals.push({ startMs: s, endMs: e });
  }
  return _timeMapMergeIntervals(intervals);
}

/**
 * True when [startMs, endMs) is fully contained by one merged interval.
 */
function _timeMapIntervalIsFullyContained(startMs, endMs, mergedIntervals) {
  if (startMs == null || endMs == null || endMs <= startMs) return false;
  var intervals = mergedIntervals || [];
  for (var i = 0; i < intervals.length; i++) {
    if (startMs >= intervals[i].startMs && endMs <= intervals[i].endMs) return true;
  }
  return false;
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
 * Finds a slot only if it can start at exactStartMs.
 */
function _timeMapFindSlotAtExactStart(gaps, exactStartMs, durationMs) {
  var exactEndMs = exactStartMs + durationMs;
  for (var i = 0; i < gaps.length; i++) {
    if (gaps[i].startMs <= exactStartMs && gaps[i].endMs >= exactEndMs) {
      return { startMs: exactStartMs, endMs: exactEndMs };
    }
  }
  return null;
}

/**
 * Picks one Gym slot for the day according to window and duration preferences.
 */
function _timeMapPlaceGym(dayStartMs, dayEndMs, freeGaps, outsideIntervals) {
  var msPerMinute = 60 * 1000;
  var earliestStartMs = new Date(dayStartMs).setHours(GYM_EARLIEST_START_HOUR, GYM_EARLIEST_START_MINUTE, 0, 0);
  var latestEndMs = Math.min(dayEndMs, new Date(dayStartMs).setHours(GYM_LATEST_END_HOUR, GYM_LATEST_END_MINUTE, 0, 0));
  // #region agent log
  _timeMapDebugLog("gym-debug", "H8", "TimeMapBlocks.gs:_timeMapPlaceGym:daytime-bounds", "Gym placement daytime bounds", {
    dayStartMs: dayStartMs,
    dayEndMs: dayEndMs,
    earliestStartMs: earliestStartMs,
    latestEndMs: latestEndMs,
    dayStartLocal: _timeMapFormatMsLocal(dayStartMs),
    dayEndLocal: _timeMapFormatMsLocal(dayEndMs),
    earliestStartLocal: _timeMapFormatMsLocal(earliestStartMs),
    latestEndLocal: _timeMapFormatMsLocal(latestEndMs),
    freeGapsCount: (freeGaps || []).length
  });
  // #endregion
  if (latestEndMs <= earliestStartMs) return null;
  var preferredExactStarts = [
    new Date(dayStartMs).setHours(GYM_PREFERRED_EXACT_START_HOUR, GYM_PREFERRED_EXACT_START_MINUTE, 0, 0)
  ];
  var windows = [
    {
      startMs: new Date(dayStartMs).setHours(GYM_PREFERRED_WINDOW_1_START_HOUR, GYM_PREFERRED_WINDOW_1_START_MINUTE, 0, 0),
      endMs: new Date(dayStartMs).setHours(GYM_PREFERRED_WINDOW_1_END_HOUR, GYM_PREFERRED_WINDOW_1_END_MINUTE, 0, 0)
    },
    {
      startMs: Math.max(dayStartMs, earliestStartMs),
      endMs: new Date(dayStartMs).setHours(GYM_PREFERRED_WINDOW_2_END_HOUR, GYM_PREFERRED_WINDOW_2_END_MINUTE, 0, 0)
    },
    {
      startMs: Math.max(dayStartMs, earliestStartMs),
      endMs: latestEndMs
    }
  ];
  // #region agent log
  _timeMapDebugLog("gym-debug", "H11", "TimeMapBlocks.gs:_timeMapPlaceGym:window-definition", "Gym window definitions in local time", {
    window0StartLocal: _timeMapFormatMsLocal(windows[0].startMs),
    window0EndLocal: _timeMapFormatMsLocal(windows[0].endMs),
    window1StartLocal: _timeMapFormatMsLocal(windows[1].startMs),
    window1EndLocal: _timeMapFormatMsLocal(windows[1].endMs),
    window2StartLocal: _timeMapFormatMsLocal(windows[2].startMs),
    window2EndLocal: _timeMapFormatMsLocal(windows[2].endMs)
  });
  // #endregion
  var options = [
    // Gym session duration must remain 45m/30m; travel is always emitted as separate events.
    // Prefer run legs first (long then short), then fallback to drive legs.
    { gymMinutes: 45, travelEachMinutes: GYM_RUN_MINUTES, travelMode: "run" },
    { gymMinutes: 30, travelEachMinutes: GYM_RUN_MINUTES, travelMode: "run" },
    { gymMinutes: 45, travelEachMinutes: GYM_DRIVE_MINUTES, travelMode: "drive" },
    { gymMinutes: 30, travelEachMinutes: GYM_DRIVE_MINUTES, travelMode: "drive" }
  ];
  var windowFitMinutes = [];
  for (var wi = 0; wi < windows.length; wi++) {
    var bestFitMs = 0;
    for (var wfg = 0; wfg < freeGaps.length; wfg++) {
      var ws = Math.max(freeGaps[wfg].startMs, windows[wi].startMs);
      var we = Math.min(freeGaps[wfg].endMs, windows[wi].endMs);
      if (we > ws) {
        var fitMsWindow = we - ws;
        if (fitMsWindow > bestFitMs) bestFitMs = fitMsWindow;
      }
    }
    windowFitMinutes.push(Math.floor(bestFitMs / 60000));
  }
  // #region agent log
  _timeMapDebugLog("gym-debug", "H13", "TimeMapBlocks.gs:_timeMapPlaceGym:window-fit-minutes", "Longest fit minutes per gym window", {
    window0Local: _timeMapFormatMsLocal(windows[0].startMs) + " -> " + _timeMapFormatMsLocal(windows[0].endMs),
    window1Local: _timeMapFormatMsLocal(windows[1].startMs) + " -> " + _timeMapFormatMsLocal(windows[1].endMs),
    window2Local: _timeMapFormatMsLocal(windows[2].startMs) + " -> " + _timeMapFormatMsLocal(windows[2].endMs),
    window0LongestFitMinutes: windowFitMinutes[0],
    window1LongestFitMinutes: windowFitMinutes[1],
    window2LongestFitMinutes: windowFitMinutes[2]
  });
  // #endregion
  var longestDaytimeFitMs = 0;
  var totalFreeDaytimeMs = 0;
  for (var fg = 0; fg < freeGaps.length; fg++) {
    var fitS = Math.max(freeGaps[fg].startMs, earliestStartMs);
    var fitE = Math.min(freeGaps[fg].endMs, latestEndMs);
    if (fitE > fitS) {
      var fitMs = fitE - fitS;
      if (fitMs > longestDaytimeFitMs) longestDaytimeFitMs = fitMs;
      totalFreeDaytimeMs += fitMs;
    }
  }
  var totalFreeDaytimeMinutes = Math.floor(totalFreeDaytimeMs / 60000);
  var linearDenominator = GYM_FREE_MINUTES_FULL - GYM_FREE_MINUTES_MIN;
  var freeTimeRatio = linearDenominator > 0
    ? (totalFreeDaytimeMinutes - GYM_FREE_MINUTES_MIN) / linearDenominator
    : (totalFreeDaytimeMinutes >= GYM_FREE_MINUTES_FULL ? 1 : 0);
  if (freeTimeRatio < 0) freeTimeRatio = 0;
  if (freeTimeRatio > 1) freeTimeRatio = 1;
  var allowedGymMinutes = 30 + (15 * freeTimeRatio);
  var optionFeasibility = [];
  for (var ofi = 0; ofi < options.length; ofi++) {
    var requiredMinutes = options[ofi].gymMinutes + 2 * options[ofi].travelEachMinutes;
    optionFeasibility.push({
      mode: options[ofi].travelMode,
      gymMinutes: options[ofi].gymMinutes,
      travelEachMinutes: options[ofi].travelEachMinutes,
      requiredMinutes: requiredMinutes,
      feasibleByLongestDaytimeGap: longestDaytimeFitMs >= requiredMinutes * msPerMinute
    });
  }
  // #region agent log
  _timeMapDebugLog("gym-debug", "H9", "TimeMapBlocks.gs:_timeMapPlaceGym:daytime-feasibility", "Daytime feasibility against gym options", {
    dayStartMs: dayStartMs,
    earliestStartMs: earliestStartMs,
    latestEndMs: latestEndMs,
    longestDaytimeFitMinutes: Math.floor(longestDaytimeFitMs / 60000),
    totalFreeDaytimeMinutes: totalFreeDaytimeMinutes,
    freeMinutesMin: GYM_FREE_MINUTES_MIN,
    freeMinutesFull: GYM_FREE_MINUTES_FULL,
    freeTimeRatio: freeTimeRatio,
    allowedGymMinutes: allowedGymMinutes,
    optionFeasibility: optionFeasibility
  });
  // #endregion
  var mergedOutside = outsideIntervals || [];
  var tryBuildGymPlacement = function (slot, option, sourceLabel, sourceData) {
    var travelMs = option.travelEachMinutes * msPerMinute;
    var gymDurationMs = option.gymMinutes * msPerMinute;
    var gymStartMs = slot.startMs + travelMs;
    var gymEndMs = gymStartMs + gymDurationMs;
    if (option.travelMode === "run") {
      var thereCovered = _timeMapIntervalIsFullyContained(slot.startMs, gymStartMs, mergedOutside);
      var backCovered = _timeMapIntervalIsFullyContained(gymEndMs, slot.endMs, mergedOutside);
      if (!thereCovered || !backCovered) {
        // #region agent log
        _timeMapDebugLog("gym-debug", "H23", "TimeMapBlocks.gs:_timeMapPlaceGym:run-rejected-outside", "Run option rejected because [Outside] does not fully cover both legs", {
          source: sourceLabel,
          sourceData: sourceData || null,
          slotStartMs: slot.startMs,
          slotEndMs: slot.endMs,
          gymStartMs: gymStartMs,
          gymEndMs: gymEndMs,
          thereCovered: thereCovered,
          backCovered: backCovered,
          outsideIntervalsCount: mergedOutside.length
        });
        // #endregion
        return null;
      }
    }
    return {
      startMs: slot.startMs,
      endMs: slot.endMs,
      gymStartMs: gymStartMs,
      gymEndMs: gymEndMs,
      travelMode: option.travelMode,
      travelBeforeStartMs: travelMs > 0 ? slot.startMs : null,
      travelBeforeEndMs: travelMs > 0 ? gymStartMs : null,
      travelAfterStartMs: travelMs > 0 ? gymEndMs : null,
      travelAfterEndMs: travelMs > 0 ? slot.endMs : null
    };
  };

  for (var o = 0; o < options.length; o++) {
    var totalMinutes = options[o].gymMinutes + (2 * options[o].travelEachMinutes);
    var durationMs = totalMinutes * msPerMinute;

    for (var p = 0; p < preferredExactStarts.length; p++) {
      var exactStartMs = preferredExactStarts[p];
      if (exactStartMs < earliestStartMs) continue;
      if (exactStartMs + durationMs > latestEndMs) continue;
      var slot = _timeMapFindSlotAtExactStart(freeGaps, exactStartMs, durationMs);
      if (slot) {
        var placementExact = tryBuildGymPlacement(slot, options[o], "exact-start", { exactStartMs: exactStartMs });
        if (!placementExact) continue;
        if (options[o].gymMinutes > allowedGymMinutes) continue;
        // #region agent log
        _timeMapDebugLog("gym-debug", "H3", "TimeMapBlocks.gs:_timeMapPlaceGym:exact-match", "Gym slot selected via preferred exact start", { dayStartMs: dayStartMs, freeGapsCount: (freeGaps || []).length, travelMode: options[o].travelMode, gymMinutes: options[o].gymMinutes, travelEachMinutes: options[o].travelEachMinutes, slotStartMs: slot.startMs, slotEndMs: slot.endMs });
        // #endregion
        // #region agent log
        _timeMapDebugLog("gym-debug", "H12", "TimeMapBlocks.gs:_timeMapPlaceGym:exact-match-local", "Gym exact-match slot local time", {
          slotStartLocal: _timeMapFormatMsLocal(slot.startMs),
          slotEndLocal: _timeMapFormatMsLocal(slot.endMs),
          gymStartLocal: _timeMapFormatMsLocal(placementExact.gymStartMs),
          gymEndLocal: _timeMapFormatMsLocal(placementExact.gymEndMs)
        });
        // #endregion
        return placementExact;
      }
    }

    for (var w = 0; w < windows.length; w++) {
      var slot = _timeMapFindSlotInWindow(freeGaps, windows[w].startMs, windows[w].endMs, durationMs);
      if (slot) {
        var placementWindow = tryBuildGymPlacement(slot, options[o], "window", { windowIndex: w });
        if (!placementWindow) continue;
        if (options[o].gymMinutes > allowedGymMinutes) continue;
        // #region agent log
        _timeMapDebugLog("gym-debug", "H3", "TimeMapBlocks.gs:_timeMapPlaceGym:window-match", "Gym slot selected via window search", { dayStartMs: dayStartMs, freeGapsCount: (freeGaps || []).length, windowIndex: w, windowStartMs: windows[w].startMs, windowEndMs: windows[w].endMs, travelMode: options[o].travelMode, gymMinutes: options[o].gymMinutes, travelEachMinutes: options[o].travelEachMinutes, slotStartMs: slot.startMs, slotEndMs: slot.endMs });
        // #endregion
        // #region agent log
        _timeMapDebugLog("gym-debug", "H12", "TimeMapBlocks.gs:_timeMapPlaceGym:window-match-local", "Gym window-match slot local time", {
          windowIndex: w,
          windowStartLocal: _timeMapFormatMsLocal(windows[w].startMs),
          windowEndLocal: _timeMapFormatMsLocal(windows[w].endMs),
          slotStartLocal: _timeMapFormatMsLocal(slot.startMs),
          slotEndLocal: _timeMapFormatMsLocal(slot.endMs),
          gymStartLocal: _timeMapFormatMsLocal(placementWindow.gymStartMs),
          gymEndLocal: _timeMapFormatMsLocal(placementWindow.gymEndMs)
        });
        // #endregion
        return placementWindow;
      }
    }
  }
  var longestGapMs = 0;
  for (var g = 0; g < freeGaps.length; g++) {
    var gapMs = freeGaps[g].endMs - freeGaps[g].startMs;
    if (gapMs > longestGapMs) longestGapMs = gapMs;
  }
  // #region agent log
  _timeMapDebugLog("gym-debug", "H3", "TimeMapBlocks.gs:_timeMapPlaceGym:return-null", "No gym slot found for day", { dayStartMs: dayStartMs, dayEndMs: dayEndMs, freeGapsCount: (freeGaps || []).length, longestGapMinutes: Math.floor(longestGapMs / 60000) });
  // #endregion
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

  var out = [];
  if (totalMinutes < 7 * 60) {
    var windowStartMs = usable[0].startMs;
    var windowEndMs = usable[usable.length - 1].endMs;
    var b4s = Math.max(windowStartMs, windowEndMs - 60 * 60000);
    var b3s = Math.max(windowStartMs, windowEndMs - 120 * 60000);
    var b2e = b3s;
    var b2s = Math.max(windowStartMs, b2e - 120 * 60000);
    var b1e = b2s;
    var b1s = Math.max(windowStartMs, b1e - 120 * 60000);
    var blocks = [
      { title: titles[0], startMs: b1s, endMs: b1e },
      { title: titles[1], startMs: b2s, endMs: b2e },
      { title: titles[2], startMs: b3s, endMs: windowEndMs },
      { title: titles[3], startMs: b4s, endMs: windowEndMs }
    ];

    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      if (block.endMs <= block.startMs) continue;
      for (var g = 0; g < usable.length; g++) {
        var segStart = Math.max(block.startMs, usable[g].startMs);
        var segEnd = Math.min(block.endMs, usable[g].endMs);
        if ((segEnd - segStart) < minMs) continue;
        out.push({
          title: block.title,
          startMs: segStart,
          endMs: segEnd
        });
      }
    }
    return out;
  }

  var durationsMin;
  if (totalMinutes >= 14 * 60) {
    durationsMin = [TIMEMAP_1_HOURS * 60, TIMEMAP_2_HOURS * 60, TIMEMAP_3_HOURS * 60, TIMEMAP_4_HOURS * 60];
  } else {
    durationsMin = _timeMapScaledDurations(totalMinutes);
  }

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
    console.warn("TimeMap calendar not found. Set TIMEMAP_CALENDAR_ID in Config.gs.");
    return;
  }

  var gymCal = null;
  if (GYM_EVENT_CALENDAR_ID && GYM_EVENT_CALENDAR_ID.indexOf("REPLACE_WITH_") !== 0) {
    gymCal = CalendarApp.getCalendarById(GYM_EVENT_CALENDAR_ID);
    if (!gymCal) console.warn("Gym calendar not found. Set GYM_EVENT_CALENDAR_ID in Config.gs.");
  } else {
    console.warn("GYM_EVENT_CALENDAR_ID is placeholder; Gym scheduling is skipped.");
  }
  // #region agent log
  _timeMapDebugLog("gym-debug", "H1", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:gym-cal-init", "Gym calendar initialization status", { gymEventCalendarIdConfigured: !!GYM_EVENT_CALENDAR_ID, isPlaceholder: GYM_EVENT_CALENDAR_ID ? GYM_EVENT_CALENDAR_ID.indexOf("REPLACE_WITH_") === 0 : true, gymCalendarResolved: !!gymCal });
  // #endregion

  var now = new Date();
  var todayStart = new Date(now.getTime());
  todayStart.setHours(0, 0, 0, 0);
  var offset = (dayOffset != null && dayOffset >= 0) ? dayOffset : 0;
  var count = (dayCount != null && dayCount > 0) ? dayCount : SCHEDULING_WINDOW;
  var endDayExclusive = Math.min(offset + count, SCHEDULING_WINDOW);
  var maxRuntimeMs = runOptions && runOptions.maxRuntimeMs ? runOptions.maxRuntimeMs : null;
  var runStartMs = Date.now();
  // #region agent log
  _timeMapDebugLog("gym-debug", "H2", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:range", "TimeMap run window parameters", { offset: offset, count: count, endDayExclusive: endDayExclusive, schedulingWindow: SCHEDULING_WINDOW, maxRuntimeMs: maxRuntimeMs });
  // #endregion
  // #region agent log
  _timeMapDebugLog("gym-debug", "H10", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:timezone", "Timezone configuration cross-check", {
    scriptTimezone: Session.getScriptTimeZone(),
    scriptNowLocal: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss Z"),
    defaultCalendarTimezone: CalendarApp.getDefaultCalendar().getTimeZone(),
    gymCalendarTimezone: gymCal ? gymCal.getTimeZone() : null
  });
  // #endregion
  // #region agent log
  _timeMapDebugLog("gym-debug", "H22", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:busy-helper-availability", "Busy helper availability/function fingerprint", {
    hasEventIsBusyByTransparency: typeof _eventIsBusyByTransparency === "function",
    eventIsBusyByTransparencyFingerprint: typeof _eventIsBusyByTransparency === "function" ? String(_eventIsBusyByTransparency).slice(0, 180) : null
  });
  // #endregion
  var desiredByTitle = {};
  var titles = _timeMapBlockTitles();
  for (var t = 0; t < titles.length; t++) desiredByTitle[titles[t]] = [];
  var desiredGym = [];
  var allCalendars = CalendarApp.getAllCalendars();
  var skedpalCalendarAudit = [];
  for (var ac = 0; ac < allCalendars.length; ac++) {
    var auditCal = allCalendars[ac];
    if (!_timeMapIsSkedpalCalendar(auditCal)) continue;
    skedpalCalendarAudit.push({
      id: auditCal.getId(),
      name: auditCal.getName(),
      excludedByRules: _timeMapIsCalendarExcluded(auditCal, null)
    });
  }
  // #region agent log
  _timeMapDebugLog("gym-debug", "H18", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:skedpal-calendar-audit", "SkedPal calendar exclusion audit", {
    timemapTreatSkedpalAsBusy: TIMEMAP_TREAT_SKEDPAL_AS_BUSY,
    skedpalCalendarCount: skedpalCalendarAudit.length,
    skedpalCalendars: skedpalCalendarAudit
  });
  // #endregion
  var sleepCal = (typeof SLEEP_CALENDAR_ID !== "undefined") ? CalendarApp.getCalendarById(SLEEP_CALENDAR_ID) : null;
  var noSlotDiagnosticsEmitted = 0;
  // #region agent log
  _timeMapDebugLog("gym-debug", "H7", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:sleep-cal-init", "Sleep calendar visibility for busy-collection cross-check", {
    sleepCalendarIdConfigured: typeof SLEEP_CALENDAR_ID !== "undefined",
    sleepCalendarResolved: !!sleepCal
  });
  // #endregion

  var lastProcessedDay = offset - 1;
  for (var i = offset; i < endDayExclusive; i++) {
    if (maxRuntimeMs != null && (Date.now() - runStartMs) >= maxRuntimeMs) break;
    lastProcessedDay = i;

    var dayStart = new Date(todayStart.getTime());
    dayStart.setDate(todayStart.getDate() + i);
    dayStart.setHours(0, 0, 0, 0);
    var dayEnd = new Date(dayStart.getTime());
    dayEnd.setDate(dayEnd.getDate() + 1);
    var dayStartMs = dayStart.getTime();
    var dayEndMs = dayEnd.getTime();
    var dayKey = _timeMapDateKey(dayStart);

    var excluded = {};
    excluded[TIMEMAP_CALENDAR_ID] = true;
    if (gymCal) excluded[GYM_EVENT_CALENDAR_ID] = true;
    var busyDebugMeta = {
      calendarCounts: {},
      samples: [],
      skedpalSeen: 0,
      skedpalBusyIncluded: 0,
      skedpalFreeSkipped: 0,
      skedpalBusyCheckUnavailable: 0,
      skedpalAllDaySkipped: 0,
      skedpalMultiDaySkipped: 0
    };
    var busy = _timeMapCollectBusyIntervals(dayStartMs, dayEndMs, excluded, allCalendars, busyDebugMeta);
    var mergedBusy = _timeMapMergeIntervals(busy);
    var freeGaps = _timeMapFreeGaps(dayStartMs, dayEndMs, mergedBusy);
    if (sleepCal) {
      var sleepEvents = sleepCal.getEvents(dayStart, dayEnd, { search: SLEEP_EVENT_TAG });
      var sleepOverlapMinutes = 0;
      for (var se = 0; se < sleepEvents.length; se++) {
        var seStart = Math.max(dayStartMs, sleepEvents[se].getStartTime().getTime());
        var seEnd = Math.min(dayEndMs, sleepEvents[se].getEndTime().getTime());
        if (seEnd > seStart) sleepOverlapMinutes += Math.floor((seEnd - seStart) / 60000);
      }
      // #region agent log
      _timeMapDebugLog("gym-debug", "H7", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:sleep-overlap", "Sleep overlap in this day window", {
        dayKey: dayKey,
        sleepEventCountInDay: sleepEvents.length,
        sleepOverlapMinutes: sleepOverlapMinutes
      });
      // #endregion
    }
    // #region agent log
    _timeMapDebugLog("gym-debug", "H4", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:day-gaps", "Daily free gap stats before gym placement", { dayKey: dayKey, busyCount: busy.length, mergedBusyCount: mergedBusy.length, freeGapCount: freeGaps.length, firstGapStartMs: freeGaps.length ? freeGaps[0].startMs : null, firstGapEndMs: freeGaps.length ? freeGaps[0].endMs : null });
    // #endregion
    // #region agent log
    _timeMapDebugLog("gym-debug", "H17", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:skedpal-filter", "SkedPal busy/free filtering counts", {
      dayKey: dayKey,
      skedpalSeen: busyDebugMeta.skedpalSeen,
      skedpalBusyIncluded: busyDebugMeta.skedpalBusyIncluded,
      skedpalFreeSkipped: busyDebugMeta.skedpalFreeSkipped,
      skedpalBusyCheckUnavailable: busyDebugMeta.skedpalBusyCheckUnavailable,
      skedpalAllDaySkipped: busyDebugMeta.skedpalAllDaySkipped,
      skedpalMultiDaySkipped: busyDebugMeta.skedpalMultiDaySkipped
    });
    // #endregion

    var outsideIntervals = _timeMapGetOutsideIntervalsForDay(timemapCal, dayStartMs, dayEndMs);
    var gymSlot = gymCal ? _timeMapPlaceGym(dayStartMs, dayEndMs, freeGaps, outsideIntervals) : null;
    // #region agent log
    _timeMapDebugLog("gym-debug", "H4", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:gym-slot", "Gym slot placement result for day", { dayKey: dayKey, hasGymCal: !!gymCal, gymSlotFound: !!gymSlot, travelMode: gymSlot ? gymSlot.travelMode : null, gymStartMs: gymSlot ? gymSlot.gymStartMs : null, gymEndMs: gymSlot ? gymSlot.gymEndMs : null });
    // #endregion
    if (!gymSlot && noSlotDiagnosticsEmitted < 6) {
      var topCalendars = Object.keys(busyDebugMeta.calendarCounts).map(function (name) {
        return { name: name, count: busyDebugMeta.calendarCounts[name] };
      }).sort(function (a, b) {
        return b.count - a.count;
      }).slice(0, 5);
      // #region agent log
      _timeMapDebugLog("gym-debug", "H14", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:no-slot-attribution", "No-slot busy attribution sample", {
        dayKey: dayKey,
        skedpalSeen: busyDebugMeta.skedpalSeen,
        skedpalBusyIncluded: busyDebugMeta.skedpalBusyIncluded,
        skedpalFreeSkipped: busyDebugMeta.skedpalFreeSkipped,
        skedpalBusyCheckUnavailable: busyDebugMeta.skedpalBusyCheckUnavailable,
        topCalendars: topCalendars,
        sampleEvents: busyDebugMeta.samples
      });
      // #endregion
      noSlotDiagnosticsEmitted++;
    }
    if (gymSlot) {
      var toTitle = gymSlot.travelMode === "run" ? GYM_RUN_TO_TITLE : GYM_DRIVE_TO_TITLE;
      var homeTitle = gymSlot.travelMode === "run" ? GYM_RUN_HOME_TITLE : GYM_DRIVE_HOME_TITLE;
      var toKey = gymSlot.travelMode === "run" ? dayKey + "_Gym_RunTo" : dayKey + "_Gym_DriveTo";
      var homeKey = gymSlot.travelMode === "run" ? dayKey + "_Gym_RunHome" : dayKey + "_Gym_DriveHome";

      if (gymSlot.travelBeforeStartMs != null && gymSlot.travelBeforeEndMs != null) {
        desiredGym.push({
          key: toKey,
          title: toTitle,
          startMs: gymSlot.travelBeforeStartMs,
          endMs: gymSlot.travelBeforeEndMs,
          location: ""
        });
      }

      desiredGym.push({
        key: dayKey + "_Gym_Main",
        title: GYM_TITLE,
        startMs: gymSlot.gymStartMs,
        endMs: gymSlot.gymEndMs,
        location: GYM_LOCATION_SUBSTRING
      });

      if (gymSlot.travelAfterStartMs != null && gymSlot.travelAfterEndMs != null) {
        desiredGym.push({
          key: homeKey,
          title: homeTitle,
          startMs: gymSlot.travelAfterStartMs,
          endMs: gymSlot.travelAfterEndMs,
          location: ""
        });
      }

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
    // #region agent log
    _timeMapDebugLog("gym-debug", "H2", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:no-days", "No days processed due runtime/range", { offset: offset, lastProcessedDay: lastProcessedDay, endDayExclusive: endDayExclusive });
    // #endregion
    return;
  }
  if (maxRuntimeMs != null && lastProcessedDay < endDayExclusive - 1) {
    console.warn("addEvents_TimeMapBlocks: runtime guard reached; synced up to day index " + lastProcessedDay + ".");
  }

  var syncStart = new Date(todayStart.getTime());
  syncStart.setDate(todayStart.getDate() + offset);
  syncStart.setHours(0, 0, 0, 0);
  var syncEnd = new Date(todayStart.getTime());
  syncEnd.setDate(todayStart.getDate() + (lastProcessedDay + 1));
  syncEnd.setHours(0, 0, 0, 0);
  syncEnd.setMilliseconds(syncEnd.getMilliseconds() - 1);
  if (TIMEMAP_DEBUG_NO_WRITES) {
    var desiredTimeMapCounts = {};
    for (var tc = 0; tc < titles.length; tc++) {
      desiredTimeMapCounts[titles[tc]] = desiredByTitle[titles[tc]].length;
    }
    var desiredErrands = _timeMapBuildErrandsOverlays(syncStart, syncEnd);
    var desiredScoutHall = _timeMapBuildScoutHallOverlays(syncStart, syncEnd);
    var desiredGymMainCount = 0;
    var desiredGymRunToCount = 0;
    var desiredGymRunHomeCount = 0;
    var desiredGymDriveToCount = 0;
    var desiredGymDriveHomeCount = 0;
    for (var dg = 0; dg < desiredGym.length; dg++) {
      var gTitle = desiredGym[dg].title;
      if (gTitle === GYM_TITLE) desiredGymMainCount++;
      else if (gTitle === GYM_RUN_TO_TITLE) desiredGymRunToCount++;
      else if (gTitle === GYM_RUN_HOME_TITLE) desiredGymRunHomeCount++;
      else if (gTitle === GYM_DRIVE_TO_TITLE) desiredGymDriveToCount++;
      else if (gTitle === GYM_DRIVE_HOME_TITLE) desiredGymDriveHomeCount++;
    }
    // #region agent log
    _timeMapDebugLog("gym-debug", "H20", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:no-write-mode", "No-write debug mode active; skipping calendar syncs", {
      timemapDebugNoWrites: TIMEMAP_DEBUG_NO_WRITES,
      syncStartMs: syncStart.getTime(),
      syncEndMs: syncEnd.getTime(),
      desiredTimeMapCounts: desiredTimeMapCounts,
      desiredErrandsCount: desiredErrands.length,
      desiredScoutHallCount: desiredScoutHall.length,
      desiredGymTotal: desiredGym.length,
      desiredGymMain: desiredGymMainCount,
      desiredGymRunTo: desiredGymRunToCount,
      desiredGymRunHome: desiredGymRunHomeCount,
      desiredGymDriveTo: desiredGymDriveToCount,
      desiredGymDriveHome: desiredGymDriveHomeCount
    });
    // #endregion
    return;
  }

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
    var desiredGymMain = desiredGym.filter(function (e) { return e.title === GYM_TITLE; });
    var desiredGymRunTo = desiredGym.filter(function (e) { return e.title === GYM_RUN_TO_TITLE; });
    var desiredGymRunHome = desiredGym.filter(function (e) { return e.title === GYM_RUN_HOME_TITLE; });
    var desiredGymDriveTo = desiredGym.filter(function (e) { return e.title === GYM_DRIVE_TO_TITLE; });
    var desiredGymDriveHome = desiredGym.filter(function (e) { return e.title === GYM_DRIVE_HOME_TITLE; });
    // #region agent log
    _timeMapDebugLog("gym-debug", "H5", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:pre-sync-gym", "Gym desired payload counts before sync", { syncStartMs: syncStart.getTime(), syncEndMs: syncEnd.getTime(), desiredGymTotal: desiredGym.length, desiredGymMain: desiredGymMain.length, desiredGymRunTo: desiredGymRunTo.length, desiredGymRunHome: desiredGymRunHome.length, desiredGymDriveTo: desiredGymDriveTo.length, desiredGymDriveHome: desiredGymDriveHome.length });
    // #endregion

    var gymMainStats = _syncCalendarEvents(gymCal, GYM_TITLE, syncStart, syncEnd, desiredGymMain, {
      keyFromExisting: function (ev) {
        return (ev.getTitle() || "").trim() === GYM_TITLE
          ? _timeMapDateKey(ev.getStartTime()) + "_Gym_Main"
          : null;
      },
      onEventSynced: function (calendar, event, desired) {
        // #region agent log
        _timeMapDebugLog("gym-debug", "H6", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:gym-main-synced", "Gym main event synced", {
          calendarId: calendar.getId(),
          eventId: event.getId(),
          title: event.getTitle(),
          startMs: event.getStartTime().getTime(),
          endMs: event.getEndTime().getTime(),
          desiredKey: desired ? desired.key : null
        });
        // #endregion
        _timeMapSetEventLocation(calendar, event, desired.location || "");
      }
    });
    // #region agent log
    _timeMapDebugLog("gym-debug", "H6", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:gym-main-stats", "Gym main sync stats", gymMainStats);
    // #endregion

    var gymRunToStats = _syncCalendarEvents(gymCal, GYM_RUN_TO_TITLE, syncStart, syncEnd, desiredGymRunTo, {
      keyFromExisting: function (ev) {
        return (ev.getTitle() || "").trim() === GYM_RUN_TO_TITLE
          ? _timeMapDateKey(ev.getStartTime()) + "_Gym_RunTo"
          : null;
      },
      onEventSynced: function (calendar, event, desired) {
        _timeMapSetEventLocation(calendar, event, desired.location || "");
      }
    });
    // #region agent log
    _timeMapDebugLog("gym-debug", "H6", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:gym-run-to-stats", "Gym run-to sync stats", gymRunToStats);
    // #endregion

    var gymRunHomeStats = _syncCalendarEvents(gymCal, GYM_RUN_HOME_TITLE, syncStart, syncEnd, desiredGymRunHome, {
      keyFromExisting: function (ev) {
        return (ev.getTitle() || "").trim() === GYM_RUN_HOME_TITLE
          ? _timeMapDateKey(ev.getStartTime()) + "_Gym_RunHome"
          : null;
      },
      onEventSynced: function (calendar, event, desired) {
        _timeMapSetEventLocation(calendar, event, desired.location || "");
      }
    });
    // #region agent log
    _timeMapDebugLog("gym-debug", "H6", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:gym-run-home-stats", "Gym run-home sync stats", gymRunHomeStats);
    // #endregion

    var gymDriveToStats = _syncCalendarEvents(gymCal, GYM_DRIVE_TO_TITLE, syncStart, syncEnd, desiredGymDriveTo, {
      keyFromExisting: function (ev) {
        return (ev.getTitle() || "").trim() === GYM_DRIVE_TO_TITLE
          ? _timeMapDateKey(ev.getStartTime()) + "_Gym_DriveTo"
          : null;
      },
      onEventSynced: function (calendar, event, desired) {
        _timeMapSetEventLocation(calendar, event, desired.location || "");
      }
    });
    // #region agent log
    _timeMapDebugLog("gym-debug", "H6", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:gym-drive-to-stats", "Gym drive-to sync stats", gymDriveToStats);
    // #endregion

    var gymDriveHomeStats = _syncCalendarEvents(gymCal, GYM_DRIVE_HOME_TITLE, syncStart, syncEnd, desiredGymDriveHome, {
      keyFromExisting: function (ev) {
        return (ev.getTitle() || "").trim() === GYM_DRIVE_HOME_TITLE
          ? _timeMapDateKey(ev.getStartTime()) + "_Gym_DriveHome"
          : null;
      },
      onEventSynced: function (calendar, event, desired) {
        _timeMapSetEventLocation(calendar, event, desired.location || "");
      }
    });
    // #region agent log
    _timeMapDebugLog("gym-debug", "H6", "TimeMapBlocks.gs:addEvents_TimeMapBlocks:gym-drive-home-stats", "Gym drive-home sync stats", gymDriveHomeStats);
    // #endregion
  }
}

/** Convenience trigger entry point for only TimeMap blocks + Gym. */
function update_Master_TimeMap_TimeMapBlocks() {
  addEvents_TimeMapBlocks(0, SCHEDULING_WINDOW, { maxRuntimeMs: 5 * 60 * 1000 });
}
