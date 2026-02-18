/**
 * Sleep automation module.
 * Reserves 8 hours of sleep per night, ending 1 hour before "leave" time from the travel
 * automation when present, otherwise at an ideal wake time. Adapts to shift work by
 * avoiding or splitting around events during normal sleep hours (fallback: two 4-hour blocks).
 *
 * Requires: Travel calendar to be updated first (run updateTravelDriveEvents before addEvents_Sleep).
 * Set SLEEP_CALENDAR_ID to your sleep calendar ID. Uses CALENDARS_TO_EXCLUDE from Code.gs when scanning for commitments.
 * Events with status "free" (transparency: transparent) are not counted as conflicts; requires Calendar advanced service.
 */

// Replace with your sleep calendar ID (create calendar in Google Calendar, then copy ID from settings).
const SLEEP_CALENDAR_ID = "496baca0d033db4062ef3acd672aa7ba22cc505bad94b3920b2bd2358c25d610@group.calendar.google.com";

const SLEEP_DURATION_HOURS = 8;
const SLEEP_BEGIN = 20;   // hour (0-23) start of "normal sleep" window
const SLEEP_END = 12;     // hour (0-23) end of "normal sleep" window (next day)
const SLEEP_IDEAL_WAKE_UP_HRS = 6;
const SLEEP_IDEAL_WAKE_UP_MIN = 0;
const SLEEP_BUFFER_BEFORE_LEAVE_MINUTES = 60;
const SLEEP_MIN_BLOCK_HOURS = 4;
const SLEEP_EVENT_TAG = "[SLEEP]";

/** Prefix for outbound-from-home drive events on the Travel calendar (leave time = event start). */
const SLEEP_DRIVE_OUTBOUND_PREFIX = "[Drive] To:";

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

/**
 * Returns true if the event blocks time (busy). Returns false if status is "free" (transparent).
 * Uses Calendar advanced service; if lookup fails, treats as busy to be safe.
 */
function _sleepEventIsBusy(calendarEvent) {
  try {
    var cal = calendarEvent.getCalendar();
    var ev = Calendar.Events.get(cal.getId(), calendarEvent.getId());
    return ev.transparency !== "transparent";
  } catch (e) {
    return true;
  }
}

/** Event title/location that should not affect sleep conflicts (e.g. Gym; may add scheduling later). */
const SLEEP_IGNORE_TITLE = "Gym";
const SLEEP_IGNORE_LOCATION = "Snap Fitness 24/7 Ashburton";

/**
 * Returns true if the event should be ignored for sleep conflict detection (e.g. Gym at Snap Fitness Ashburton).
 */
function _sleepIsEventIgnoredForConflicts(calendarEvent) {
  var title = (calendarEvent.getTitle() || "").trim();
  var loc = (calendarEvent.getLocation() || "").trim();
  return title === SLEEP_IGNORE_TITLE && loc === SLEEP_IGNORE_LOCATION;
}

/** Events spanning at least this many hours are treated as all-day and do not affect sleep conflicts. */
const SLEEP_MULTIDAY_HOURS = 24;

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
 * Returns array of CalendarEvent sorted by start time.
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
      if (!ev.isAllDayEvent() && !_sleepIsMultiDayEvent(ev) && _sleepEventIsBusy(ev) && !_sleepIsEventIgnoredForConflicts(ev)) events.push(ev);
    }
  }
  events.sort(function (a, b) {
    return a.getStartTime().getTime() - b.getStartTime().getTime();
  });
  return events;
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
  var firstStart = events[0].getStartTime().getTime();
  if (firstStart > t0) gaps.push({ start: t0, end: Math.min(t1, firstStart) });
  for (var i = 0; i < events.length - 1; i++) {
    var a = events[i].getEndTime().getTime();
    var b = events[i + 1].getStartTime().getTime();
    if (b > a && a >= t0 && b <= t1) gaps.push({ start: a, end: b });
  }
  var lastEnd = events[events.length - 1].getEndTime().getTime();
  if (t1 > lastEnd) gaps.push({ start: Math.max(t0, lastEnd), end: t1 });
  return gaps;
}

/**
 * Adds [SLEEP] blocks to the sleep calendar for the scheduling window.
 * Run updateTravelDriveEvents() before this so leave times are available.
 * Creates/updates/deletes events via syncCalendarEvents() in Code.gs (that function
 * calls calendar.createEvent() for new events and setTime/setTitle for updates).
 */
async function addEvents_Sleep() {
  var sleep_cal = CalendarApp.getCalendarById(SLEEP_CALENDAR_ID);
  if (!sleep_cal) {
    console.warn("Sleep calendar not found. Set SLEEP_CALENDAR_ID in Sleep.gs.");
    return;
  }

  var now = new Date();
  var msPerDay = 24 * 60 * 60 * 1000;
  var endDate = new Date(now.getTime() + SCHEDULING_WINDOW * msPerDay);
  endDate.setHours(23, 59, 59, 999);

  var leaveByDay = _sleepGetLeaveTimesByDay(now, endDate);
  var msPerHour = 60 * 60 * 1000;
  var ms8 = SLEEP_DURATION_HOURS * msPerHour;
  var ms4 = SLEEP_MIN_BLOCK_HOURS * msPerHour;
  var bufferMs = SLEEP_BUFFER_BEFORE_LEAVE_MINUTES * 60 * 1000;
  var desiredSleep = [];
  for (var i = 0; i <= SCHEDULING_WINDOW; i++) {
    var dayD = new Date(now.getTime());
    dayD.setHours(0, 0, 0, 0);
    dayD = new Date(dayD.getTime() + i * msPerDay);

    var dateKey = dayD.getFullYear() + "-" + dayD.getMonth() + "-" + dayD.getDate();
    var idealWake = new Date(dayD.getTime());
    idealWake.setHours(SLEEP_IDEAL_WAKE_UP_HRS, SLEEP_IDEAL_WAKE_UP_MIN, 0, 0);
    var targetWake;
    if (leaveByDay[dateKey]) {
      var wakeFromLeave = new Date(leaveByDay[dateKey].time.getTime() - bufferMs);
      // Use leave only to wake earlier, never later (no sleep-in from travel).
      targetWake = wakeFromLeave.getTime() < idealWake.getTime() ? wakeFromLeave : idealWake;
    } else {
      targetWake = new Date(idealWake.getTime());
    }

    var targetEnd = targetWake.getTime();
    var targetStart = targetEnd - ms8;
    var leaveInfo = leaveByDay[dateKey];
    var usedLeaveForWake = leaveInfo && targetWake.getTime() === leaveInfo.time.getTime() - bufferMs;
    var leaveTitleForDay = leaveInfo ? leaveInfo.title : null;

    // Only schedule nights that end in the future (skip "night ending today" / past nights).
    if (targetEnd <= now.getTime()) continue;

    var nightStart = new Date(dayD.getTime() - msPerDay);
    nightStart.setHours(SLEEP_BEGIN, 0, 0, 0);
    var nightEnd = new Date(dayD.getTime());
    nightEnd.setHours(SLEEP_END, 59, 59, 999);
    if (targetWake.getTime() > nightEnd.getTime()) nightEnd = new Date(targetWake.getTime());
    if (nightStart.getTime() >= nightEnd.getTime()) continue;

    var commitments = _sleepCollectCommitmentEvents(nightStart, nightEnd);
    var conflictTitles = [];
    var hasOverlap = false;
    for (var c = 0; c < commitments.length; c++) {
      var evStart = commitments[c].getStartTime().getTime();
      var evEnd = commitments[c].getEndTime().getTime();
      if (_sleepOverlaps(targetStart, targetEnd, evStart, evEnd)) {
        hasOverlap = true;
        var t = (commitments[c].getTitle() || "").trim();
        if (!t) t = "(" + (commitments[c].getCalendar().getName() || "no title") + ")";
        if (conflictTitles.indexOf(t) === -1) conflictTitles.push(t);
      }
    }
    var overlapsTarget = hasOverlap;

    var blocksToCreate = [];
    if (!overlapsTarget) {
      blocksToCreate.push({ start: targetStart, end: targetEnd, conflictTitles: [] });
    } else {
      // Prefer placing sleep at the start of a gap so it begins right after the conflict (e.g. after reception ends), not at the end of the night.
      var gaps = _sleepFreeGaps(nightStart, nightEnd, commitments);
      var found8 = false;
      for (var g = 0; g < gaps.length; g++) {
        if (gaps[g].end - gaps[g].start >= ms8) {
          blocksToCreate.push({ start: gaps[g].start, end: gaps[g].start + ms8, conflictTitles: conflictTitles });
          found8 = true;
          break;
        }
      }
      if (!found8) {
        for (var g = 0; g < gaps.length && blocksToCreate.length < 2; g++) {
          if (gaps[g].end - gaps[g].start >= ms4) {
            blocksToCreate.push({ start: gaps[g].start, end: gaps[g].start + ms4, conflictTitles: conflictTitles });
          }
        }
      }
      if (blocksToCreate.length === 0) {
        blocksToCreate.push({ start: targetStart, end: targetEnd, conflictTitles: conflictTitles });
      }
    }

    // Stable key per night + block index so when conflict goes away we update the same event to correct times (not delete+create).
    var maxConflictLen = 80;
    for (var b = 0; b < blocksToCreate.length; b++) {
      var bl = blocksToCreate[b];
      // Always start from clean tag so title is cleared when conflict is no longer there (sync overwrites existing title).
      // Any modified-time block must show the reason (conflicts or "before [Drive]...").
      var title = SLEEP_EVENT_TAG;
      if (bl.conflictTitles && bl.conflictTitles.length > 0) {
        var conflictStr = bl.conflictTitles.join(", ");
        if (conflictStr.length > maxConflictLen) conflictStr = conflictStr.slice(0, maxConflictLen - 3) + "...";
        title = title + " (conflicts: " + conflictStr + ")";
      } else if (usedLeaveForWake && leaveTitleForDay && bl.endMs === targetEnd && !overlapsTarget) {
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

  if (desiredSleep.length === 0) {
    console.warn("addEvents_Sleep: no [SLEEP] blocks computed for the window; no events will be written.");
    return;
  }

  var todayStart = new Date(now.getTime());
  todayStart.setHours(0, 0, 0, 0);
  var syncStart = new Date(todayStart.getTime() - msPerDay);

  syncCalendarEvents(sleep_cal, SLEEP_EVENT_TAG, syncStart, endDate, desiredSleep, {
    keyFromExistingWithList: function (ev, existingList) {
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
    }
  });
}

/** Wipes all future events on the Sleep calendar (no tag filter). Uses wipeCalendarFutureEvents in Code.gs. */
function wipeSleepCalendar() {
  wipeCalendarFutureEvents(SLEEP_CALENDAR_ID);
}
