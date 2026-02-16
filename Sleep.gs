/**
 * Sleep automation module.
 * Reserves 8 hours of sleep per night, ending 1 hour before "leave" time from the travel
 * automation when present, otherwise at an ideal wake time. Adapts to shift work by
 * avoiding or splitting around events during normal sleep hours (fallback: two 4-hour blocks).
 *
 * Requires: Travel calendar to be updated first (run updateTravelDriveEvents before addEvents_Sleep).
 * Set SLEEP_CALENDAR_ID to your sleep calendar ID. Uses CALENDARS_TO_EXCLUDE from Code.gs when scanning for commitments.
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
 * Returns true if the calendar should be excluded when collecting commitment events
 * (sleep calendar or name/ID in CALENDARS_TO_EXCLUDE from Code.gs).
 */
function _sleepIsCalendarExcluded(cal) {
  var id = cal.getId();
  if (id === SLEEP_CALENDAR_ID) return true;
  var name = cal.getName();
  for (var i = 0; i < CALENDARS_TO_EXCLUDE.length; i++) {
    var ex = CALENDARS_TO_EXCLUDE[i];
    if (ex === name || ex === id) return true;
  }
  return false;
}

/**
 * Collects timed (non–all-day) events in the given range from all calendars except
 * those excluded by _sleepIsCalendarExcluded. Returns array of CalendarEvent sorted by start time.
 */
function _sleepCollectCommitmentEvents(start, end) {
  var allCalendars = CalendarApp.getAllCalendars();
  var events = [];
  for (var i = 0; i < allCalendars.length; i++) {
    var cal = allCalendars[i];
    if (_sleepIsCalendarExcluded(cal)) continue;
    var calEvents = cal.getEvents(start, end);
    for (var k = 0; k < calEvents.length; k++) {
      var ev = calEvents[k];
      if (ev.isAllDayEvent()) continue;
      events.push(ev);
    }
  }
  events.sort(function (a, b) {
    return a.getStartTime().getTime() - b.getStartTime().getTime();
  });
  return events;
}

/**
 * Returns a map of calendar-day key (YYYY-M-D) to Date (earliest leave time that day).
 * Reads Travel calendar for [Drive] events whose title starts with "[Drive] To:" (outbound from home).
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
    if (byDay[key] === undefined || start.getTime() < byDay[key].getTime()) {
      byDay[key] = new Date(start.getTime());
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
  var endDate = new Date(now.getTime());
  endDate.setHours(23, 59, 59, 999);
  endDate.setDate(endDate.getDate() + SCHEDULING_WINDOW);

  var leaveByDay = _sleepGetLeaveTimesByDay(now, endDate);
  var msPerHour = 60 * 60 * 1000;
  var ms8 = SLEEP_DURATION_HOURS * msPerHour;
  var ms4 = SLEEP_MIN_BLOCK_HOURS * msPerHour;
  var bufferMs = SLEEP_BUFFER_BEFORE_LEAVE_MINUTES * 60 * 1000;
  var desiredSleep = [];

  for (var i = 0; i <= SCHEDULING_WINDOW; i++) {
    var dayD = new Date(now.getTime());
    dayD.setDate(dayD.getDate() + i);
    dayD.setHours(0, 0, 0, 0);

    var dateKey = dayD.getFullYear() + "-" + dayD.getMonth() + "-" + dayD.getDate();
    var targetWake;
    if (leaveByDay[dateKey]) {
      targetWake = new Date(leaveByDay[dateKey].getTime() - bufferMs);
    } else {
      targetWake = new Date(dayD.getTime());
      targetWake.setHours(SLEEP_IDEAL_WAKE_UP_HRS, SLEEP_IDEAL_WAKE_UP_MIN, 0, 0);
    }

    var targetEnd = targetWake.getTime();
    var targetStart = targetEnd - ms8;

    var nightStart = new Date(dayD.getTime());
    nightStart.setDate(nightStart.getDate() - 1);
    nightStart.setHours(SLEEP_BEGIN, 0, 0, 0);
    var nightEnd = new Date(dayD.getTime());
    nightEnd.setHours(SLEEP_END, 59, 59, 999);
    if (targetWake.getTime() > nightEnd.getTime()) nightEnd = new Date(targetWake.getTime());

    var commitments = _sleepCollectCommitmentEvents(nightStart, nightEnd);
    var overlapsTarget = false;
    for (var c = 0; c < commitments.length; c++) {
      var evStart = commitments[c].getStartTime().getTime();
      var evEnd = commitments[c].getEndTime().getTime();
      if (_sleepOverlaps(targetStart, targetEnd, evStart, evEnd)) {
        overlapsTarget = true;
        break;
      }
    }

    var blocksToCreate = [];
    if (!overlapsTarget) {
      blocksToCreate.push({ start: targetStart, end: targetEnd });
    } else {
      var gaps = _sleepFreeGaps(nightStart, nightEnd, commitments);
      var found8 = false;
      for (var g = 0; g < gaps.length; g++) {
        if (gaps[g].end - gaps[g].start >= ms8) {
          blocksToCreate.push({ start: gaps[g].end - ms8, end: gaps[g].end });
          found8 = true;
          break;
        }
      }
      if (!found8) {
        for (var g = 0; g < gaps.length && blocksToCreate.length < 2; g++) {
          if (gaps[g].end - gaps[g].start >= ms4) {
            blocksToCreate.push({ start: gaps[g].end - ms4, end: gaps[g].end });
          }
        }
      }
    }

    for (var b = 0; b < blocksToCreate.length; b++) {
      var bl = blocksToCreate[b];
      desiredSleep.push({
        title: SLEEP_EVENT_TAG,
        start: new Date(bl.start),
        end: new Date(bl.end),
        key: String(bl.start)
      });
    }
  }

  if (desiredSleep.length === 0) {
    console.warn("addEvents_Sleep: no [SLEEP] blocks computed for the window; no events will be written.");
  }
  // Create/update/delete [SLEEP] events on the calendar (see Code.gs syncCalendarEvents → calendar.createEvent / setTime).
  syncCalendarEvents(sleep_cal, SLEEP_EVENT_TAG, now, endDate, desiredSleep, {
    keyFromExisting: function (ev) { return String(ev.getStartTime().getTime()); }
  });
}
