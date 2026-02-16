/**
 * Travel / drive events module.
 * Scans configured calendars for events with locations, gets drive durations via Maps (no tolls),
 * and creates [Drive] events on a dedicated travel calendar. Arrive 15 min before each event,
 * leave immediately after. When time at home between two events would be < 30 min, travel
 * goes directly between those locations instead of via home.
 * If the source event is marked as "free", the drive events for that leg are also created as free.
 *
 * Requires: Maps service and Calendar Advanced Service (Resources > Advanced Google services).
 * Set TRAVEL_CALENDAR_ID to your travel calendar ID (create the calendar in Google Calendar first).
 */

// Replace with your travel calendar ID (create calendar in Google Calendar, then copy ID from calendar settings).
const TRAVEL_CALENDAR_ID = "c6511974498db2a541c354a55443df76cbee6a1ba88e943c898e013768e05a12@group.calendar.google.com";
// Calendars to exclude from scanning. All other calendars are scanned for events with locations.
// You can use calendar names (e.g. "Travel", "Sleep") or full calendar IDs. The travel calendar (TRAVEL_CALENDAR_ID) is always excluded.
const TRAVEL_CALS_TO_EXCLUDE = ["Sleep", "Timemap"];
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
      .setAvoid(Maps.DirectionFinder.Avoid.TOLLS)
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
 * Returns true if the calendar event is marked as "free" (transparent). Uses Calendar Advanced Service.
 */
function _travelIsEventFree(calendarEvent) {
  try {
    var calId = calendarEvent.getCalendar().getId();
    var eventId = calendarEvent.getId();
    var resource = Calendar.Events.get(calId, eventId);
    return resource.transparency === "transparent";
  } catch (e) {
    return false;
  }
}

/**
 * Sets an existing calendar event to "free" (transparent). Uses Calendar Advanced Service.
 */
function _travelSetEventFree(calendar, event) {
  try {
    var eventId = event.getId().slice(0, event.getId().length - 11);
    Calendar.Events.patch({ transparency: "transparent" }, calendar.getId(), eventId);
  } catch (e) {
    console.warn("_travelSetEventFree failed: " + e.message);
  }
}

/**
 * Returns true if the calendar should be excluded from travel scanning (name or ID in TRAVEL_CALS_TO_EXCLUDE, or is the travel calendar).
 */
function _travelIsCalendarExcluded(cal) {
  var id = cal.getId();
  if (id === TRAVEL_CALENDAR_ID) return true;
  var name = cal.getName();
  for (var i = 0; i < TRAVEL_CALS_TO_EXCLUDE.length; i++) {
    var ex = TRAVEL_CALS_TO_EXCLUDE[i];
    if (ex === name || ex === id) return true;
  }
  return false;
}

/**
 * Collects events that have a location set from all calendars except those in TRAVEL_CALS_TO_EXCLUDE (and the travel calendar).
 * Excludes all-day events. Returns array of CalendarEvent, sorted by start time.
 */
function _travelCollectEventsWithLocations(startDate, endDate) {
  var allCalendars = CalendarApp.getAllCalendars();
  var events = [];
  for (var i = 0; i < allCalendars.length; i++) {
    var cal = allCalendars[i];
    if (_travelIsCalendarExcluded(cal)) continue;
    var calEvents = cal.getEvents(startDate, endDate);
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
    var evIsFree = _travelIsEventFree(ev);
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
        var outboundEv = travelCal.createEvent(outboundTitle, outboundStart, arriveAt);
        if (evIsFree) _travelSetEventFree(travelCal, outboundEv);
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
      var inboundEv = travelCal.createEvent(inboundTitle, evEnd, inboundEnd);
      if (evIsFree) _travelSetEventFree(travelCal, inboundEv);
    }
  }
}
