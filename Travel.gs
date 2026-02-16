/**
 * Travel / drive events module.
 * Scans configured calendars for events with locations, gets drive durations via Maps (no tolls),
 * and creates [Drive] events on a dedicated travel calendar. Arrive 15 min before each event,
 * leave immediately after. When time at home between two events would be < 30 min, travel
 * goes directly between those locations instead of via home.
 *
 * Requires: Maps service enabled (Resources > Advanced Google services > Maps).
 * Set TRAVEL_CALENDAR_ID to your travel calendar ID (create the calendar in Google Calendar first).
 */

// Replace with your travel calendar ID (create calendar in Google Calendar, then copy ID from calendar settings).
const TRAVEL_CALENDAR_ID = "REPLACE_WITH_YOUR_TRAVEL_CALENDAR_ID@group.calendar.google.com";
// Calendars to scan for events with locations (same pattern as sleep in Code.gs).
const TRAVEL_CALS_TO_SCAN = ["mlewis89@gmail.com", "Lewis, Mark Calendar (Canvas)", "Work", "skittles@waverleyvalleyscouts.org.au", "Mark Lewis's Facebook events", "skittles - onlinemeetings"];
const TRAVEL_ARRIVE_MINUTES_BEFORE = 15;
const TRAVEL_MIN_HOME_MINUTES = 30;
const TRAVEL_DRIVE_EVENT_TAG = "[Drive]";

// Rate limiting for Maps API calls (avoid quota issues).
const TRAVEL_MAPS_SLEEP_MS = 500;
const TRAVEL_MAPS_SLEEP_EVERY_N = 1;

/**
 * Returns drive duration in minutes (rounded up), or null if directions fail.
 * origin and destination can be address strings or "lat,lng".
 * Uses DirectionFinder with DRIVING mode and avoid tolls.
 */
function getDriveDurationMinutes(origin, destination) {
  if (!origin || !destination) return null;
  try {
    var directions = Maps.newDirectionFinder()
      .setOrigin(origin)
      .setDestination(destination)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .setAvoid(Maps.Avoid.TOLLS)
      .getDirections();
    if (!directions || !directions.routes || directions.routes.length === 0) return null;
    var leg = directions.routes[0].legs[0];
    if (!leg || leg.duration == null) return null;
    var seconds = leg.duration.value;
    return Math.ceil(seconds / 60);
  } catch (e) {
    console.warn("getDriveDurationMinutes failed: " + e.message + " (" + origin + " -> " + destination + ")");
    return null;
  }
}

/**
 * Returns home as a string for Directions API: "lat,lng" using LOCATION_LAT, LOCATION_LONG from Code.gs.
 */
function _travelHomeOrigin() {
  return LOCATION_LAT + "," + LOCATION_LONG;
}

/**
 * Collects events that have a location set, from TRAVEL_CALS_TO_SCAN, in [now, now + SCHEDULING_WINDOW].
 * Excludes all-day events. Returns array of CalendarEvent, sorted by start time.
 */
function _travelCollectEventsWithLocations(startDate, endDate) {
  var calendars = [];
  for (var i = 0; i < TRAVEL_CALS_TO_SCAN.length; i++) {
    var byName = CalendarApp.getCalendarsByName(TRAVEL_CALS_TO_SCAN[i]);
    for (var j = 0; j < byName.length; j++) {
      calendars.push(byName[j]);
    }
  }
  var events = [];
  for (var i = 0; i < calendars.length; i++) {
    var calEvents = calendars[i].getEvents(startDate, endDate);
    for (var k = 0; k < calEvents.length; k++) {
      var ev = calEvents[k];
      if (ev.isAllDayEvent()) continue;
      var loc = ev.getLocation ? ev.getLocation() : (ev.getEventLocation ? ev.getEventLocation() : "");
      if (loc && loc.toString().trim() !== "") {
        events.push(ev);
      }
    }
  }
  events.sort(function (a, b) {
    return a.getStartTime().getTime() - b.getStartTime().getTime();
  });
  return events;
}

/**
 * Precomputes all needed durations and returns a cache object: getDuration(originKey, destKey) returns minutes or null.
 * originKey/destKey are either _travelHomeOrigin() or event.getLocation().
 */
function _travelBuildDurationCache(events, homeStr) {
  var cache = {};
  var key = function (a, b) {
    return a + "\n" + b;
  };
  var get = function (origin, dest) {
    var k = key(origin, dest);
    if (cache[k] !== undefined) return cache[k];
    var mins = getDriveDurationMinutes(origin, dest);
    cache[k] = mins;
    if (TRAVEL_MAPS_SLEEP_EVERY_N > 0) {
      Utilities.sleep(TRAVEL_MAPS_SLEEP_MS);
    }
    return mins;
  };

  for (var i = 0; i < events.length; i++) {
    var loc = events[i].getLocation();
    get(homeStr, loc);
    get(loc, homeStr);
  }
  for (var i = 0; i < events.length - 1; i++) {
    get(events[i].getLocation(), events[i + 1].getLocation());
  }
  return cache;
}

/**
 * Main entry: updates drive events on the travel calendar for the scheduling window.
 * Cleans existing [Drive] events in range, then creates outbound/inbound drive events per located event.
 */
function updateTravelDriveEvents() {
  var travelCal = CalendarApp.getCalendarById(TRAVEL_CALENDAR_ID);
  if (!travelCal) {
    console.warn("Travel calendar not found. Set TRAVEL_CALENDAR_ID in Travel.gs.");
    return;
  }

  var now = new Date();
  var startDate = new Date(now.getTime());
  startDate.setHours(0, 0, 0, 0);
  var endDate = new Date(startDate.getTime());
  endDate.setDate(endDate.getDate() + SCHEDULING_WINDOW);
  endDate.setHours(23, 59, 59, 999);

  var events = _travelCollectEventsWithLocations(startDate, endDate);
  if (events.length === 0) {
    clean_timeMapCal(travelCal, TRAVEL_DRIVE_EVENT_TAG, startDate, endDate);
    return;
  }

  var homeStr = _travelHomeOrigin();
  var cache = _travelBuildDurationCache(events, homeStr);

  var cacheGet = function (origin, dest) {
    return cache[origin + "\n" + dest];
  };

  clean_timeMapCal(travelCal, TRAVEL_DRIVE_EVENT_TAG, startDate, endDate);

  var arriveBeforeMs = TRAVEL_ARRIVE_MINUTES_BEFORE * 60 * 1000;
  var minHomeMs = TRAVEL_MIN_HOME_MINUTES * 60 * 1000;

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var evStart = ev.getStartTime();
    var evEnd = ev.getEndTime();
    var evLoc = ev.getLocation();
    var evTitle = ev.getTitle() || "Event";
    var arriveAt = new Date(evStart.getTime() - arriveBeforeMs);

    // --- Outbound ---
    var outboundOrigin = homeStr;
    var outboundDurationMin = cacheGet(homeStr, evLoc);
    if (i > 0) {
      var prev = events[i - 1];
      var prevEnd = prev.getEndTime();
      var prevLoc = prev.getLocation();
      var prevToHome = cacheGet(prevLoc, homeStr);
      var homeToCur = cacheGet(homeStr, evLoc);
      var timeAtHomeMs = arriveAt.getTime() - prevEnd.getTime();
      if (prevToHome != null && homeToCur != null) {
        timeAtHomeMs -= (prevToHome + homeToCur) * 60 * 1000;
      }
      if (timeAtHomeMs < minHomeMs) {
        outboundOrigin = prevLoc;
        outboundDurationMin = cacheGet(prevLoc, evLoc);
      }
    }

    // Only create outbound when leaving from home. When chained from previous event, that segment is created as the previous event's inbound.
    if (outboundOrigin === homeStr && outboundDurationMin != null && outboundDurationMin > 0) {
      var outboundStart = new Date(arriveAt.getTime() - outboundDurationMin * 60 * 1000);
      var outboundTitle = TRAVEL_DRIVE_EVENT_TAG + " To: " + evTitle;
      if (outboundStart.getTime() < arriveAt.getTime()) {
        travelCal.createEvent(outboundTitle, outboundStart, arriveAt);
      }
    }

    // --- Inbound ---
    var inboundDest = homeStr;
    var inboundDurationMin = cacheGet(evLoc, homeStr);
    if (i < events.length - 1) {
      var next = events[i + 1];
      var nextStart = next.getStartTime();
      var nextArriveAt = new Date(nextStart.getTime() - arriveBeforeMs);
      var curToHome = cacheGet(evLoc, homeStr);
      var homeToNext = cacheGet(homeStr, next.getLocation());
      var timeAtHomeMs = nextArriveAt.getTime() - evEnd.getTime();
      if (curToHome != null && homeToNext != null) {
        timeAtHomeMs -= (curToHome + homeToNext) * 60 * 1000;
      }
      if (timeAtHomeMs < minHomeMs) {
        inboundDest = next.getLocation();
        inboundDurationMin = cacheGet(evLoc, inboundDest);
      }
    }

    if (inboundDurationMin != null && inboundDurationMin > 0) {
      var inboundEnd = new Date(evEnd.getTime() + inboundDurationMin * 60 * 1000);
      var inboundTitle = inboundDest === homeStr
        ? TRAVEL_DRIVE_EVENT_TAG + " Home"
        : TRAVEL_DRIVE_EVENT_TAG + " To: " + (events[i + 1].getTitle() || "Next");
      travelCal.createEvent(inboundTitle, evEnd, inboundEnd);
    }
  }
}
