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
// Uses CALENDARS_TO_EXCLUDE from Code.gs when scanning for events with locations. Travel calendar (TRAVEL_CALENDAR_ID) is always excluded.
// Location substrings treated as "no physical location" (video/phone meetings). Case-insensitive.
const TRAVEL_VIRTUAL_LOCATION_SUBSTRINGS = ["microsoft teams meeting", "teams meeting", "zoom", "google meet", "meet - ", "webex", "video call", "ringcentral", "gotomeeting", "skype", "facetime", "meet.google", "teams.microsoft", "zoom.us"];

const TRAVEL_ARRIVE_MINUTES_BEFORE = 15;
const TRAVEL_MIN_HOME_MINUTES = 30;
const TRAVEL_DRIVE_EVENT_TAG = "[Drive]";

// Rate limiting for Maps API calls (avoid quota issues).
const TRAVEL_MAPS_SLEEP_MS = 500;
const TRAVEL_MAPS_SLEEP_EVERY_N = 1;

/** Returns true if the error is the Maps "too many times for one day" quota. */
function _travelIsMapsQuotaError(e) {
  var msg = (e && e.message) ? String(e.message) : "";
  return msg.indexOf("too many times") !== -1 || (msg.indexOf("Service invoked") !== -1 && msg.indexOf("route") !== -1);
}

/**
 * Returns drive duration in minutes (rounded up), or null if directions fail.
 * Throws on Maps daily quota exceeded so callers can abort travel calcs and continue with Sleep etc.
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
    if (_travelIsMapsQuotaError(e)) throw e;
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
 * Returns true if the calendar should be excluded from travel scanning (name or ID in CALENDARS_TO_EXCLUDE from Code.gs, or is the travel calendar).
 */
function _travelIsCalendarExcluded(cal) {
  var id = cal.getId();
  if (id === TRAVEL_CALENDAR_ID) return true;
  var name = cal.getName();
  for (var i = 0; i < CALENDARS_TO_EXCLUDE.length; i++) {
    var ex = CALENDARS_TO_EXCLUDE[i];
    if (ex === name || ex === id) return true;
  }
  return false;
}

/**
 * Returns true if the location string should be treated as empty (video/phone meeting, no physical place).
 */
function _travelIsVirtualMeetingLocation(loc) {
  if (!loc || typeof loc !== "string") return true;
  var s = loc.trim();
  if (s === "") return true;
  var lower = s.toLowerCase();
  for (var i = 0; i < TRAVEL_VIRTUAL_LOCATION_SUBSTRINGS.length; i++) {
    if (lower.indexOf(TRAVEL_VIRTUAL_LOCATION_SUBSTRINGS[i]) !== -1) return true;
  }
  return false;
}

/**
 * Collects events that have a physical location from all calendars except those in CALENDARS_TO_EXCLUDE (and the travel calendar).
 * Excludes all-day events and events whose location is a video-call placeholder (e.g. "Microsoft Teams Meeting").
 * Returns array of CalendarEvent, sorted by start time.
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
      if (loc && loc.toString().trim() !== "" && !_travelIsVirtualMeetingLocation(loc)) {
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
 * Syncs [Drive] events: only deletes orphans, creates missing, updates in place (avoids API rate limit).
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
    syncCalendarEvents(travelCal, TRAVEL_DRIVE_EVENT_TAG, startDate, endDate, [], {
      keyFromExisting: function (ev) { return String(ev.getStartTime().getTime()) + "_" + ev.getEndTime().getTime(); }
    });
    return;
  }

  var homeStr = _travelHomeOrigin();
  var cache;
  try {
    cache = _travelBuildDurationCache(events, homeStr);
  } catch (e) {
    if (_travelIsMapsQuotaError(e)) {
      console.warn("Maps daily limit exceeded; skipping travel drive updates. Sleep and other steps will continue.");
      return;
    }
    throw e;
  }

  var cacheGet = function (origin, dest) {
    return cache[origin + "\n" + dest];
  };

  var arriveBeforeMs = TRAVEL_ARRIVE_MINUTES_BEFORE * 60 * 1000;
  var minHomeMs = TRAVEL_MIN_HOME_MINUTES * 60 * 1000;
  var desiredDrive = [];

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

    if (outboundOrigin === homeStr && outboundDurationMin != null && outboundDurationMin > 0) {
      var outboundStart = new Date(arriveAt.getTime() - outboundDurationMin * 60 * 1000);
      var outboundTitle = TRAVEL_DRIVE_EVENT_TAG + " To: " + evTitle;
      if (outboundStart.getTime() < arriveAt.getTime()) {
        desiredDrive.push({
          title: outboundTitle,
          start: outboundStart,
          end: arriveAt,
          key: String(outboundStart.getTime()) + "_" + arriveAt.getTime(),
          free: evIsFree
        });
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
      var inboundStart, inboundEnd;
      if (inboundDest === homeStr) {
        // Leave immediately after event, drive home.
        inboundStart = evEnd;
        inboundEnd = new Date(evEnd.getTime() + inboundDurationMin * 60 * 1000);
      } else {
        // Direct to next event: sit towards next event — finish 15 min before it.
        var nextArriveAt = new Date(events[i + 1].getStartTime().getTime() - arriveBeforeMs);
        inboundEnd = nextArriveAt;
        inboundStart = new Date(nextArriveAt.getTime() - inboundDurationMin * 60 * 1000);
      }
      var inboundTitle = inboundDest === homeStr
        ? TRAVEL_DRIVE_EVENT_TAG + " Home"
        : TRAVEL_DRIVE_EVENT_TAG + " To: " + (events[i + 1].getTitle() || "Next");
      desiredDrive.push({
        title: inboundTitle,
        start: inboundStart,
        end: inboundEnd,
        key: String(inboundStart.getTime()) + "_" + inboundEnd.getTime(),
        free: evIsFree
      });
    }
  }

  syncCalendarEvents(travelCal, TRAVEL_DRIVE_EVENT_TAG, startDate, endDate, desiredDrive, {
    keyFromExisting: function (ev) {
      return String(ev.getStartTime().getTime()) + "_" + ev.getEndTime().getTime();
    },
    setFree: _travelSetEventFree
  });
}
