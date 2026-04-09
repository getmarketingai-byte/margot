/**
 * Sleep automation module.
 * Reserves 8 hours of sleep per night, ending before earliest outbound [Drive] To: (minus
 * SLEEP_BUFFER_BEFORE_LEAVE_MINUTES, optionally rounded) when present, otherwise at ideal wake.
 * [Drive] Home blocks sleep until end + SLEEP_BUFFER_AFTER_DRIVE_HOME_MINUTES (then optional round).
 * Adapts to shift work by
 * avoiding or splitting around events during normal sleep hours (fallback: two 4-hour blocks).
 *
 * Requires: Travel calendar to be updated first (run updateTravelDriveEvents before addEvents_Sleep).
 * Configure SLEEP_CALENDAR_ID in Config.gs. Uses CALENDARS_TO_EXCLUDE when scanning for commitments.
 * Events with status "free" (transparency: transparent) are not counted as conflicts; requires Calendar advanced service.
 * Gym-related outbound [Drive] To: legs do not shift wake time; [Drive] Home is only a sleep constraint when shown as busy (non-gym travel stays busy).
 */

/** Strips trailing " (fallback Nm)" suffix from travel event titles for stable matching. */
function _sleepStripTravelFallbackSuffix(title) {
  var t = (title || "").trim();
  var marker = " (fallback ";
  var idx = t.indexOf(marker);
  if (idx === -1) return t;
  return t.substring(0, idx).trim();
}

/**
 * True for outbound travel titles that exist only for gym (Skedpal or Snap Ashburton), so they must not pull wake time earlier.
 */
function _sleepIsGymRelatedOutboundDriveTitle(title) {
  var t = _sleepStripTravelFallbackSuffix(title || "");
  if (t.indexOf(SLEEP_DRIVE_OUTBOUND_PREFIX) !== 0) return false;
  var rest = t.substring(SLEEP_DRIVE_OUTBOUND_PREFIX.length).trim();
  if (rest === GYM_TITLE || /^gym\b/i.test(rest)) return true;
  if (/gym/i.test(rest) && /\[run\]/i.test(rest)) return true;
  return false;
}

/** Returns true if the event title is travel/drive-related (excluded from "last main conflict" display). */
function _sleepIsTravelConflict(title) {
  var t = (title || "").trim();
  return t.indexOf("[Drive]") === 0 || t.indexOf("->") !== -1;
}

/** Returns Calendar API eventId from CalendarApp event id (strips @google.com suffix if present). */
function _sleepGetApiEventId(calendarEventId) {
  if (!calendarEventId) return calendarEventId;
  return calendarEventId.slice(-11) === "@google.com" ? calendarEventId.slice(0, -11) : calendarEventId;
}

/** Adds [OVERRIDE] after [SLEEP] tag if missing, preserving existing suffix text. */
function _sleepEnsureOverrideTag(title) {
  var t = (title || "").trim();
  if (!t) return SLEEP_EVENT_TAG + " " + SLEEP_OVERRIDE_TAG;
  if (t.indexOf(SLEEP_OVERRIDE_TAG) !== -1) return t;
  if (t.indexOf(SLEEP_EVENT_TAG) !== -1) return t.replace(SLEEP_EVENT_TAG, SLEEP_EVENT_TAG + " " + SLEEP_OVERRIDE_TAG);
  return SLEEP_EVENT_TAG + " " + SLEEP_OVERRIDE_TAG + " " + t;
}

/**
 * Reads private extended properties for a sleep event.
 * @returns {{startMs:number,endMs:number}|null}
 */
function _sleepGetExtendedProps(calendarEvent) {
  try {
    var calId = calendarEvent.getCalendar().getId();
    var apiId = _sleepGetApiEventId(calendarEvent.getId());
    var resource = Calendar.Events.get(calId, apiId);
    var p = resource && resource.extendedProperties && resource.extendedProperties.private;
    if (!p) return null;
    var s = parseInt(p[SLEEP_EXTPROP_AUTO_START], 10);
    var e = parseInt(p[SLEEP_EXTPROP_AUTO_END], 10);
    if (isNaN(s) || isNaN(e)) return null;
    return { startMs: s, endMs: e };
  } catch (e) {
    return null;
  }
}

/** Persists automation-set start/end times into event private extended properties. */
function _sleepSetExtendedProps(calendar, calendarEvent, startMs, endMs) {
  try {
    var apiId = _sleepGetApiEventId(calendarEvent.getId());
    Calendar.Events.patch({
      extendedProperties: {
        private: (function () {
          var obj = {};
          obj[SLEEP_EXTPROP_AUTO_START] = String(startMs);
          obj[SLEEP_EXTPROP_AUTO_END] = String(endMs);
          return obj;
        })()
      }
    }, calendar.getId(), apiId);
  } catch (e) {
    console.warn("_sleepSetExtendedProps failed: " + e.message);
  }
}

/**
 * Returns true if the calendar should be excluded when collecting commitment events.
 * Travel is excluded so [Drive] events never count as conflicts and never pull sleep later
 * (no "sleep-in"). Leave times from Travel are still used in _sleepGetLeaveTimesByDay to
 * set target wake earlier when you have an early drive.
 */
function _sleepIsCalendarExcluded(cal) {
  var id = cal.getId();
  if (id === SLEEP_CALENDAR_ID) return true;
  if (id === TRAVEL_CALENDAR_ID) return true;
  var name = cal.getName();
  for (var i = 0; i < CALENDARS_TO_EXCLUDE.length; i++) {
    var ex = CALENDARS_TO_EXCLUDE[i];
    if (ex === name || ex === id) return true;
  }
  return false;
}

/** Returns true when this event should block sleep as busy time. */
function _sleepEventBlocksTime(calendarEvent, calendar) {
  var calId = calendar && typeof calendar.getId === "function" ? calendar.getId() : "";
  var calName = calendar && typeof calendar.getName === "function" ? (calendar.getName() || "") : "";
  return _eventIsBusyByTransparency(calendarEvent, calId, calName);
}

/**
 * Returns true if the event should be ignored for sleep conflict detection (e.g. Gym at Snap Fitness Ashburton).
 */
function _sleepIsEventIgnoredForConflicts(calendarEvent) {
  var title = (calendarEvent.getTitle() || "").trim();
  var loc = (calendarEvent.getLocation() || "").trim();
  return title === SLEEP_IGNORE_TITLE && loc.indexOf(SLEEP_IGNORE_LOCATION_SUBSTRING) !== -1;
}

/**
 * Returns true if the event spans multiple days (duration >= 24 hours). Such events are treated as all-day and do not affect sleep.
 */
function _sleepIsMultiDayEvent(calendarEvent) {
  var startMs = calendarEvent.getStartTime().getTime();
  var endMs = calendarEvent.getEndTime().getTime();
  return (endMs - startMs) >= SLEEP_MULTIDAY_HOURS * 60 * 60 * 1000;
}

/**
 * Collects timed (non-all-day) events in the given range from all calendars except
 * those excluded by _sleepIsCalendarExcluded. Only includes events that are "busy"
 * (transparency !== "transparent"). Events with status "free" do not affect sleep scheduling; all-day and multi-day events are also excluded.
 * Also includes busy [Drive] Home from Travel calendar so sleep cannot start until you've arrived home (transparent legs, e.g. gym, are ignored).
 * Returns array of lightweight commitment records sorted by start time.
 */
function _sleepCollectCommitmentEvents(start, end) {
  if (start.getTime() >= end.getTime()) return [];
  var allCalendars = CalendarApp.getAllCalendars();
  var events = [];
  for (var i = 0; i < allCalendars.length; i++) {
    var cal = allCalendars[i];
    if (_sleepIsCalendarExcluded(cal)) continue;
    var calEvents = cal.getEvents(start, end);
    for (var k = 0; k < calEvents.length; k++) {
      var ev = calEvents[k];
      if (!ev.isAllDayEvent() && !_sleepIsMultiDayEvent(ev) && _sleepEventBlocksTime(ev, cal) && !_sleepIsEventIgnoredForConflicts(ev)) {
        events.push({
          startMs: ev.getStartTime().getTime(),
          endMs: ev.getEndTime().getTime(),
          title: ev.getTitle() || "",
          calendarName: cal.getName() || ""
        });
      }
    }
  }
  // Include [Drive] Home from Travel so sleep starts only after arriving home (not when prior event ends).
  var travelCal = CalendarApp.getCalendarById(TRAVEL_CALENDAR_ID);
  if (travelCal) {
    var driveEvents = travelCal.getEvents(start, end, { search: "[Drive]" });
    for (var d = 0; d < driveEvents.length; d++) {
      var dev = driveEvents[d];
      if ((dev.getTitle() || "").trim() === SLEEP_DRIVE_HOME_TITLE) {
        if (!dev.isAllDayEvent() && !_sleepIsMultiDayEvent(dev) && _eventIsBusyByTransparency(dev, travelCal.getId(), travelCal.getName())) {
          var rawEnd = dev.getEndTime().getTime();
          var afterHomeMs =
            rawEnd + (typeof SLEEP_BUFFER_AFTER_DRIVE_HOME_MINUTES === "number" ? SLEEP_BUFFER_AFTER_DRIVE_HOME_MINUTES : 0) * 60 * 1000;
          var endAfterBuffer =
            typeof SLEEP_TRAVEL_BUFFER_ROUND_MINUTES === "number" && SLEEP_TRAVEL_BUFFER_ROUND_MINUTES > 0
              ? _sleepRoundLocalTimeMs(afterHomeMs, SLEEP_TRAVEL_BUFFER_ROUND_MINUTES)
              : afterHomeMs;
          events.push({
            startMs: dev.getStartTime().getTime(),
            endMs: endAfterBuffer,
            title: dev.getTitle() || "",
            calendarName: travelCal.getName() || ""
          });
        }
      }
    }
  }
  events.sort(function (a, b) {
    return a.startMs - b.startMs;
  });
  return events;
}

/** Returns commitment records from prefetched list that overlap [windowStartMs, windowEndMs). */
function _sleepGetCommitmentsForWindow(prefetchedCommitments, windowStartMs, windowEndMs) {
  if (!prefetchedCommitments || prefetchedCommitments.length === 0) return [];
  var out = [];
  for (var i = 0; i < prefetchedCommitments.length; i++) {
    var ev = prefetchedCommitments[i];
    if (_sleepOverlaps(windowStartMs, windowEndMs, ev.startMs, ev.endMs)) out.push(ev);
  }
  return out;
}

/**
 * Returns a map of calendar-day key (YYYY-M-D) to { time: Date, title: string } for the
 * earliest leave time that day. Reads Travel calendar for [Drive] events with "[Drive] To:".
 * TRAVEL_CALENDAR_ID must be in scope (Travel.gs).
 */
function _sleepGetLeaveTimesByDay(startDate, endDate) {
  var travelCal = CalendarApp.getCalendarById(TRAVEL_CALENDAR_ID);
  if (!travelCal) return {};
  var driveEvents = travelCal.getEvents(startDate, endDate, { search: "[Drive]" });
  var byDay = {};
  for (var i = 0; i < driveEvents.length; i++) {
    var ev = driveEvents[i];
    var title = ev.getTitle() || "";
    if (title.indexOf(SLEEP_DRIVE_OUTBOUND_PREFIX) !== 0) continue;
    if (_sleepIsGymRelatedOutboundDriveTitle(title)) continue;
    var start = ev.getStartTime();
    var key = start.getFullYear() + "-" + start.getMonth() + "-" + start.getDate();
    if (byDay[key] === undefined || start.getTime() < byDay[key].time.getTime()) {
      byDay[key] = { time: new Date(start.getTime()), title: title };
    }
  }
  return byDay;
}

/** Returns true if [start1, end1] and [start2, end2] overlap (times in ms). */
function _sleepOverlaps(start1, end1, start2, end2) {
  return start1 < end2 && start2 < end1;
}

/**
 * Rounds a local-time instant to the nearest N minutes (same calendar day anchor from midnight).
 * @param {number} ms - UTC ms
 * @param {number} roundMinutes - e.g. 15; 0 or negative = return ms unchanged
 * @returns {number}
 */
function _sleepRoundLocalTimeMs(ms, roundMinutes) {
  if (!roundMinutes || roundMinutes <= 0) return ms;
  var d = new Date(ms);
  var dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  var minsSinceMidnight = (ms - dayStart) / 60000;
  var rounded = Math.round(minsSinceMidnight / roundMinutes) * roundMinutes;
  return dayStart + rounded * 60000;
}

/**
 * For a night window [nightStart, nightEnd] and sorted commitment events,
 * returns an array of free gaps { start: Date, end: Date } (in ms for duration checks).
 */
function _sleepFreeGaps(nightStart, nightEnd, events) {
  var gaps = [];
  var t0 = nightStart.getTime();
  var t1 = nightEnd.getTime();
  if (events.length === 0) {
    if (t1 > t0) gaps.push({ start: t0, end: t1 });
    return gaps;
  }
  var firstStart = events[0].startMs;
  if (firstStart > t0) gaps.push({ start: t0, end: Math.min(t1, firstStart) });
  for (var i = 0; i < events.length - 1; i++) {
    var a = events[i].endMs;
    var b = events[i + 1].startMs;
    if (b > a && a >= t0 && b <= t1) gaps.push({ start: a, end: b });
  }
  var lastEnd = events[events.length - 1].endMs;
  if (t1 > lastEnd) gaps.push({ start: Math.max(t0, lastEnd), end: t1 });
  return gaps;
}

/**
 * Adds [SLEEP] blocks to the sleep calendar for the scheduling window (or a day range when using progressive scheduling).
 * Run updateTravelDriveEvents() before this so leave times are available.
 * Creates/updates/deletes events via _syncCalendarEvents() in Code.gs (that function
 * calls calendar.createEvent() for new events and setTime/setTitle for updates).
 * @param {number} [dayOffset=0] - Start day index (0 = today).
 * @param {number} [dayCount] - Number of days to process; default full SCHEDULING_WINDOW when omitted.
 * @param {{useQuotaBudget?: boolean, maxRuntimeMs?: number}} [runOptions] - useQuotaBudget caps daily creates; maxRuntimeMs applies a soft run-time guard.
 */
async function addEvents_Sleep(dayOffset, dayCount, runOptions) {
  var sleep_cal = CalendarApp.getCalendarById(SLEEP_CALENDAR_ID);
  if (!sleep_cal) {
    console.warn("Sleep calendar not found. Set SLEEP_CALENDAR_ID in Config.gs.");
    return;
  }

  var now = new Date();
  var msPerDay = 24 * 60 * 60 * 1000;
  var offset = (dayOffset != null && dayOffset >= 0) ? dayOffset : 0;
  var count = (dayCount != null && dayCount > 0) ? dayCount : SCHEDULING_WINDOW;
  var endDay = Math.min(offset + count, SCHEDULING_WINDOW);
  var todayStart = new Date(now.getTime());
  todayStart.setHours(0, 0, 0, 0);

  var rangeEndDate = new Date(now.getTime() + SCHEDULING_WINDOW * msPerDay);
  rangeEndDate.setHours(23, 59, 59, 999);
  var leaveByDay = _sleepGetLeaveTimesByDay(now, rangeEndDate);
  // Batch-read commitment events once for the run range, then filter in memory per night.
  var commitmentsRangeStart = new Date(todayStart.getTime() + (offset - 1) * msPerDay);
  commitmentsRangeStart.setHours(0, 0, 0, 0);
  var commitmentsRangeEnd = new Date(todayStart.getTime() + endDay * msPerDay);
  commitmentsRangeEnd.setHours(23, 59, 59, 999);
  var prefetchedCommitments = _sleepCollectCommitmentEvents(commitmentsRangeStart, commitmentsRangeEnd);

  var msPerHour = 60 * 60 * 1000;
  var ms8 = SLEEP_DURATION_HOURS * msPerHour;
  var ms4 = SLEEP_MIN_BLOCK_HOURS * msPerHour;
  var bufferMs = SLEEP_BUFFER_BEFORE_LEAVE_MINUTES * 60 * 1000;
  var roundMin =
    typeof SLEEP_TRAVEL_BUFFER_ROUND_MINUTES === "number" ? SLEEP_TRAVEL_BUFFER_ROUND_MINUTES : 0;
  var quotaBudget = null;
  if (runOptions && runOptions.useQuotaBudget) {
    quotaBudget = _getQuotaRunBudget(QUOTA_SERVICE_CALENDAR_CREATES);
    console.log("Sleep quota: limit=" + quotaBudget.limit + ", used=" + quotaBudget.used + ", remaining=" + quotaBudget.remaining + ", budgetThisRun=" + quotaBudget.budget);
  }
  var maxRuntimeMs = runOptions && runOptions.maxRuntimeMs ? runOptions.maxRuntimeMs : null;
  var runStartMs = Date.now();
  var timedOut = false;
  var lastProcessedDay = offset - 1;
  var desiredSleep = [];
  for (var i = offset; i <= endDay; i++) {
    if (maxRuntimeMs != null && (Date.now() - runStartMs) >= maxRuntimeMs) {
      timedOut = true;
      break;
    }
    lastProcessedDay = i;
    var dayD = new Date(now.getTime());
    dayD.setHours(0, 0, 0, 0);
    dayD = new Date(dayD.getTime() + i * msPerDay);

    var dateKey = dayD.getFullYear() + "-" + dayD.getMonth() + "-" + dayD.getDate();
    var idealWake = new Date(dayD.getTime());
    idealWake.setHours(SLEEP_IDEAL_WAKE_UP_HRS, SLEEP_IDEAL_WAKE_UP_MIN, 0, 0);
    var targetWake;
    if (leaveByDay[dateKey]) {
      var leaveWakeMs = leaveByDay[dateKey].time.getTime() - bufferMs;
      leaveWakeMs = _sleepRoundLocalTimeMs(leaveWakeMs, roundMin);
      var wakeFromLeave = new Date(leaveWakeMs);
      // Use leave only to wake earlier, never later (no sleep-in from travel).
      targetWake = wakeFromLeave.getTime() < idealWake.getTime() ? wakeFromLeave : idealWake;
    } else {
      targetWake = new Date(idealWake.getTime());
    }

    var targetEnd = targetWake.getTime();
    var targetStart = targetEnd - ms8;
    var leaveInfo = leaveByDay[dateKey];
    var leaveWakeForCompare =
      leaveInfo &&
      _sleepRoundLocalTimeMs(leaveInfo.time.getTime() - bufferMs, roundMin);
    var usedLeaveForWake = leaveInfo && targetWake.getTime() === leaveWakeForCompare;
    var leaveTitleForDay = leaveInfo ? leaveInfo.title : null;

    // Only schedule nights that end in the future (skip "night ending today" / past nights).
    if (targetEnd <= now.getTime()) continue;

    var nightStart = new Date(dayD.getTime() - msPerDay);
    nightStart.setHours(SLEEP_BEGIN, 0, 0, 0);
    var nightEnd = new Date(dayD.getTime());
    nightEnd.setHours(SLEEP_END, 59, 59, 999);
    if (targetWake.getTime() > nightEnd.getTime()) nightEnd = new Date(targetWake.getTime());
    if (nightStart.getTime() >= nightEnd.getTime()) continue;

    var commitments = _sleepGetCommitmentsForWindow(prefetchedCommitments, nightStart.getTime(), nightEnd.getTime());
    var conflictTitles = [];
    var lastMainConflict = null;  // Last non-travel overlapping event (by end time) for concise title
    var hasOverlap = false;
    for (var c = 0; c < commitments.length; c++) {
      var evStart = commitments[c].startMs;
      var evEnd = commitments[c].endMs;
      if (_sleepOverlaps(targetStart, targetEnd, evStart, evEnd)) {
        hasOverlap = true;
        var t = (commitments[c].title || "").trim();
        if (!t) t = "(" + (commitments[c].calendarName || "no title") + ")";
        if (conflictTitles.indexOf(t) === -1) conflictTitles.push(t);
        if (!_sleepIsTravelConflict(t) && (lastMainConflict === null || evEnd > lastMainConflict.endMs)) {
          lastMainConflict = { title: t, endMs: evEnd };
        }
      }
    }
    var overlapsTarget = hasOverlap;

    var lastMainTitle = lastMainConflict ? lastMainConflict.title : null;
    var blocksToCreate = [];
    if (!overlapsTarget) {
      blocksToCreate.push({ start: targetStart, end: targetEnd, conflictTitles: [], lastMainConflictTitle: null });
    } else {
      // Prefer placing sleep at the start of a gap so it begins right after the conflict (e.g. after reception ends), not at the end of the night.
      var gaps = _sleepFreeGaps(nightStart, nightEnd, commitments);
      var found8 = false;
      for (var g = 0; g < gaps.length; g++) {
        if (gaps[g].end - gaps[g].start >= ms8) {
          blocksToCreate.push({ start: gaps[g].start, end: gaps[g].start + ms8, conflictTitles: conflictTitles, lastMainConflictTitle: lastMainTitle });
          found8 = true;
          break;
        }
      }
      if (!found8) {
        for (var g = 0; g < gaps.length && blocksToCreate.length < 2; g++) {
          var gapDur = gaps[g].end - gaps[g].start;
          if (gapDur >= ms4) {
            var blockEnd = gaps[g].start + Math.min(gapDur, ms8);
            blocksToCreate.push({ start: gaps[g].start, end: blockEnd, conflictTitles: conflictTitles, lastMainConflictTitle: lastMainTitle });
          }
        }
      }
      if (blocksToCreate.length === 0) {
        // No 8.5h or 4h block fits: use the largest achievable gap and note reduced sleep.
        var best = null;
        for (var g = 0; g < gaps.length; g++) {
          var dur = gaps[g].end - gaps[g].start;
          if (dur > 0 && (best === null || dur > best.end - best.start)) best = gaps[g];
        }
        if (best && best.end > best.start) {
          var hrs = Math.round((best.end - best.start) / msPerHour * 10) / 10;
          blocksToCreate.push({ start: best.start, end: best.end, conflictTitles: conflictTitles, lastMainConflictTitle: lastMainTitle, lessThanIdealHours: hrs });
        } else {
          blocksToCreate.push({ start: targetStart, end: targetEnd, conflictTitles: conflictTitles, lastMainConflictTitle: lastMainTitle });
        }
      }
    }

    // Stable key per night + block index so when conflict goes away we update the same event to correct times (not delete+create).
    var maxConflictLen = 80;
    for (var b = 0; b < blocksToCreate.length; b++) {
      var bl = blocksToCreate[b];
      // Always start from clean tag so title is cleared when conflict is no longer there (sync overwrites existing title).
      // Any modified-time block must show the reason (conflicts or "before [Drive]...").
      var title = SLEEP_EVENT_TAG;
      var blHrs = bl.lessThanIdealHours != null ? bl.lessThanIdealHours : Math.round((bl.end - bl.start) / msPerHour * 10) / 10;
      var isLessThanIdeal = blHrs < SLEEP_DURATION_HOURS;
      var parts = [];
      if (isLessThanIdeal) parts.push("less than ideal sleep " + blHrs + "hrs");
      if (bl.conflictTitles && bl.conflictTitles.length > 0) {
        var conflictStr = (bl.lastMainConflictTitle != null) ? bl.lastMainConflictTitle : bl.conflictTitles.join(", ");
        if (conflictStr.length > maxConflictLen) conflictStr = conflictStr.slice(0, maxConflictLen - 3) + "...";
        parts.push("conflicts: " + conflictStr);
      }
      if (parts.length > 0) {
        title = title + " (" + parts.join(", ") + ")";
      } else if (usedLeaveForWake && leaveTitleForDay && bl.end === targetEnd && !overlapsTarget) {
        var leaveStr = leaveTitleForDay.length > maxConflictLen ? leaveTitleForDay.slice(0, maxConflictLen - 3) + "..." : leaveTitleForDay;
        title = title + " (before " + leaveStr + ")";
      } else if (overlapsTarget && bl.conflictTitles && bl.conflictTitles.length === 0) {
        title = title + " (moved; conflict had no title)";
      }
      desiredSleep.push({
        title: title,
        startMs: bl.start,
        endMs: bl.end,
        key: dateKey + "_" + b
      });
    }
  }
  if (timedOut) {
    console.warn("addEvents_Sleep: runtime guard reached; synced up to day index " + lastProcessedDay + " this run.");
  }
  if (lastProcessedDay < offset) {
    console.warn("addEvents_Sleep: runtime guard reached before processing any day; skipping writes this run.");
    return;
  }

  var syncStart = new Date(todayStart.getTime() + offset * msPerDay);
  syncStart.setHours(0, 0, 0, 0);
  if (offset === 0) syncStart = new Date(todayStart.getTime() - msPerDay);
  var syncEnd = new Date(todayStart.getTime() + lastProcessedDay * msPerDay);
  syncEnd.setHours(23, 59, 59, 999);

  var keyFromExistingWithList = function (ev, existingList) {
    var endT = ev.getEndTime();
    var endDateKey = endT.getFullYear() + "-" + endT.getMonth() + "-" + endT.getDate();
    var sorted = existingList.slice().sort(function (a, b) { return a.getStartTime().getTime() - b.getStartTime().getTime(); });
    var idx = 0;
    for (var s = 0; s < sorted.length; s++) {
      if (sorted[s].getId() === ev.getId()) return endDateKey + "_" + idx;
      var oEnd = sorted[s].getEndTime();
      var oKey = oEnd.getFullYear() + "-" + oEnd.getMonth() + "-" + oEnd.getDate();
      if (oKey === endDateKey) idx++;
    }
    return endDateKey + "_" + idx;
  };

  // Preserve manually overridden sleep events. Detection is metadata-based (moved times) or explicit [OVERRIDE] tag.
  var desiredByKey = {};
  for (var q = 0; q < desiredSleep.length; q++) {
    var d = desiredSleep[q];
    if (d.key != null && d.key !== "") desiredByKey[d.key] = d;
  }
  var existingSleep = sleep_cal.getEvents(syncStart, syncEnd, { search: SLEEP_EVENT_TAG });
  for (var r = 0; r < existingSleep.length; r++) {
    var existing = existingSleep[r];
    var existingKey = keyFromExistingWithList(existing, existingSleep);
    if (existingKey == null || existingKey === "") continue;

    var existingTitle = existing.getTitle() || SLEEP_EVENT_TAG;
    var existingStartMs = existing.getStartTime().getTime();
    var existingEndMs = existing.getEndTime().getTime();
    var hasOverrideTag = existingTitle.indexOf(SLEEP_OVERRIDE_TAG) !== -1;
    var shouldPreserveAsOverride = hasOverrideTag;

    if (!shouldPreserveAsOverride) {
      var meta = _sleepGetExtendedProps(existing);
      if (meta && (meta.startMs !== existingStartMs || meta.endMs !== existingEndMs)) {
        shouldPreserveAsOverride = true;
        existingTitle = _sleepEnsureOverrideTag(existingTitle);
      }
    }

    if (shouldPreserveAsOverride) {
      desiredByKey[existingKey] = {
        key: existingKey,
        title: existingTitle,
        startMs: existingStartMs,
        endMs: existingEndMs,
        isOverride: true
      };
    }
  }
  desiredSleep = [];
  for (var dk in desiredByKey) {
    desiredSleep.push(desiredByKey[dk]);
  }

  if (desiredSleep.length === 0) {
    console.warn("addEvents_Sleep: no [SLEEP] blocks computed for the window; no events will be written.");
    return;
  }

  var syncStats = _syncCalendarEvents(sleep_cal, SLEEP_EVENT_TAG, syncStart, syncEnd, desiredSleep, {
    keyFromExistingWithList: keyFromExistingWithList,
    maxCreates: quotaBudget ? quotaBudget.budget : null,
    onEventSynced: function (calendar, event, desired) {
      if (desired && desired.isOverride) return;
      var startTime = desired.start instanceof Date ? desired.start : (desired.startMs != null ? new Date(desired.startMs) : null);
      var endTime = desired.end instanceof Date ? desired.end : (desired.endMs != null ? new Date(desired.endMs) : null);
      if (!startTime || !endTime) return;
      _sleepSetExtendedProps(calendar, event, startTime.getTime(), endTime.getTime());
    }
  });
  if (quotaBudget) _commitQuotaUsage(QUOTA_SERVICE_CALENDAR_CREATES, syncStats.created);
  if (syncStats && syncStats.skippedCreates > 0) {
    console.warn("addEvents_Sleep: create budget reached, skipped " + syncStats.skippedCreates + " farther-out creates this run.");
  }
}

