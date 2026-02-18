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
/** Special case: event with this title and location (substring match) uses fixed 10 min travel and no arrival buffer. */
const TRAVEL_GYM_TITLE = "Gym";
const TRAVEL_GYM_LOCATION_SUBSTRING = "Snap Fitness 24/7 Ashburton";
const TRAVEL_GYM_DRIVE_MINUTES = 10;

// Rate limiting for Maps API calls (avoid quota issues).
const TRAVEL_MAPS_SLEEP_MS = 500;
const TRAVEL_MAPS_SLEEP_EVERY_N = 1;
/** When Maps API limit is hit, use this duration (minutes) for legs that cannot be realigned from existing drive events. Rechecked on next run when Maps is available. */
const TRAVEL_FALLBACK_DURATION_MINUTES = 45;

/** Returns true if the error is the Maps "too many times for one day" quota. */
function _travelIsMapsQuotaError(e) {
  var msg = (e && e.message) ? String(e.message) : "";
  return msg.indexOf("too many times") !== -1 || (msg.indexOf("Service invoked") !== -1 && msg.indexOf("route") !== -1);
}

/**
 * When Maps API is unavailable: find an existing [Drive] event with the given title whose start or end time
 * is nearest to anchorTime. If useEndAnchor is true, match by end time (for outbound); else match by start time (for inbound).
 * Returns duration in minutes or null if none found.
 */
function _travelExistingDriveDurationMinutes(existingDriveEvents, exactTitle, anchorTime, useEndAnchor) {
  var best = null;
  var bestDist = Infinity;
  var anchorMs = anchorTime.getTime();
  for (var i = 0; i < existingDriveEvents.length; i++) {
    var ev = existingDriveEvents[i];
    if ((ev.getTitle() || "") !== exactTitle) continue;
    var t = useEndAnchor ? ev.getEndTime().getTime() : ev.getStartTime().getTime();
    var durMs = ev.getEndTime().getTime() - ev.getStartTime().getTime();
    if (durMs <= 0) continue;
    var dist = Math.abs(t - anchorMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = Math.ceil(durMs / 60000);
    }
  }
  return best;
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
 * Returns true if the location string is the Gym at Snap Fitness Ashburton (used to skip Maps API for that leg).
 */
function _travelIsGymLocation(loc) {
  return (loc || "").indexOf(TRAVEL_GYM_LOCATION_SUBSTRING) !== -1;
}

/**
 * Returns true if the event is the special-case Gym at Snap Fitness Ashburton (10 min drive, no arrival buffer).
 * Location is matched by containing TRAVEL_GYM_LOCATION_SUBSTRING (handles full address e.g. "..., 234 High St, ...").
 */
function _travelIsGymAshburton(calendarEvent) {
  var title = (calendarEvent.getTitle() || "").trim();
  var loc = (calendarEvent.getLocation() || "").trim();
  return title === TRAVEL_GYM_TITLE && _travelIsGymLocation(loc);
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
 * Returns the index of an event that fully contains the event at innerIdx (start <= inner start, end >= inner end).
 * Prefers the "innermost" container (smallest containing span). Returns -1 if none.
 */
function _travelIndexOfContainingEvent(events, innerIdx) {
  var innerStart = events[innerIdx].getStartTime().getTime();
  var innerEnd = events[innerIdx].getEndTime().getTime();
  var bestIdx = -1;
  var bestSpan = Infinity;
  for (var j = 0; j < events.length; j++) {
    if (j === innerIdx) continue;
    var js = events[j].getStartTime().getTime();
    var je = events[j].getEndTime().getTime();
    if (js <= innerStart && je >= innerEnd) {
      var span = je - js;
      if (span < bestSpan) {
        bestSpan = span;
        bestIdx = j;
      }
    }
  }
  return bestIdx;
}

/**
 * Precomputes all needed durations and returns a cache object: getDuration(originKey, destKey) returns minutes or null.
 * originKey/destKey are either _travelHomeOrigin() or event.getLocation().
 * Includes legs from containing (parent) events to nested (sub) events so drive to a sub-event is from the parent's location.
 * Gym (Snap Fitness Ashburton) legs use TRAVEL_GYM_DRIVE_MINUTES and do not call the Maps API.
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
    if (_travelIsGymLocation(loc)) {
      cache[key(homeStr, loc)] = TRAVEL_GYM_DRIVE_MINUTES;
      cache[key(loc, homeStr)] = TRAVEL_GYM_DRIVE_MINUTES;
    } else {
      get(homeStr, loc);
      get(loc, homeStr);
    }
  }
  for (var i = 0; i < events.length - 1; i++) {
    var from = events[i].getLocation();
    var to = events[i + 1].getLocation();
    if (_travelIsGymLocation(from) || _travelIsGymLocation(to)) {
      cache[key(from, to)] = TRAVEL_GYM_DRIVE_MINUTES;
    } else {
      get(from, to);
    }
  }
  for (var i = 0; i < events.length; i++) {
    var parentIdx = _travelIndexOfContainingEvent(events, i);
    if (parentIdx >= 0) {
      var from = events[parentIdx].getLocation();
      var to = events[i].getLocation();
      if (_travelIsGymLocation(from) || _travelIsGymLocation(to)) {
        cache[key(from, to)] = TRAVEL_GYM_DRIVE_MINUTES;
      } else {
        get(from, to);
      }
    }
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
  var cache = {};
  var usedFallback = false;
  try {
    cache = _travelBuildDurationCache(events, homeStr);
  } catch (e) {
    if (_travelIsMapsQuotaError(e)) {
      console.warn("Maps daily limit exceeded; using existing drive events to realign or " + TRAVEL_FALLBACK_DURATION_MINUTES + " min fallback. Will recheck on next run when Maps is available.");
      usedFallback = true;
      var existingDriveEvents = travelCal.getEvents(startDate, endDate, { search: TRAVEL_DRIVE_EVENT_TAG });
      var outboundPrefix = TRAVEL_DRIVE_EVENT_TAG + " To: ";
      for (var e = 0; e < events.length; e++) {
        var ev = events[e];
        var evTitle = ev.getTitle() || "Event";
        var evLoc = ev.getLocation();
        var arriveAt = new Date(ev.getStartTime().getTime() - TRAVEL_ARRIVE_MINUTES_BEFORE * 60 * 1000);
        var outboundDur = _travelExistingDriveDurationMinutes(existingDriveEvents, outboundPrefix + evTitle, arriveAt, true);
        if (outboundDur != null) cache[homeStr + "\n" + evLoc] = outboundDur;
        var inboundDur = _travelExistingDriveDurationMinutes(existingDriveEvents, TRAVEL_DRIVE_EVENT_TAG + " Home", ev.getEndTime(), false);
        if (inboundDur != null) cache[evLoc + "\n" + homeStr] = inboundDur;
        if (e < events.length - 1) {
          var nextTitle = events[e + 1].getTitle() || "Next";
          var nextArriveAt = new Date(events[e + 1].getStartTime().getTime() - TRAVEL_ARRIVE_MINUTES_BEFORE * 60 * 1000);
          var toNextDur = _travelExistingDriveDurationMinutes(existingDriveEvents, outboundPrefix + nextTitle, nextArriveAt, true);
          if (toNextDur != null) cache[evLoc + "\n" + events[e + 1].getLocation()] = toNextDur;
        }
      }
      // Fill missing with fallback duration so the loop below can proceed
      for (var e = 0; e < events.length; e++) {
        var loc = events[e].getLocation();
        if (cache[homeStr + "\n" + loc] == null) cache[homeStr + "\n" + loc] = TRAVEL_FALLBACK_DURATION_MINUTES;
        if (cache[loc + "\n" + homeStr] == null) cache[loc + "\n" + homeStr] = TRAVEL_FALLBACK_DURATION_MINUTES;
      }
      for (var e = 0; e < events.length - 1; e++) {
        var from = events[e].getLocation();
        var to = events[e + 1].getLocation();
        if (cache[from + "\n" + to] == null) cache[from + "\n" + to] = TRAVEL_FALLBACK_DURATION_MINUTES;
      }
      for (var e = 0; e < events.length; e++) {
        var pIdx = _travelIndexOfContainingEvent(events, e);
        if (pIdx >= 0) {
          var from = events[pIdx].getLocation();
          var to = events[e].getLocation();
          if (cache[from + "\n" + to] == null) cache[from + "\n" + to] = TRAVEL_FALLBACK_DURATION_MINUTES;
        }
      }
    } else {
      throw e;
    }
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
    var isGymAshburton = _travelIsGymAshburton(ev);
    var arriveAt = isGymAshburton ? new Date(evStart.getTime()) : new Date(evStart.getTime() - arriveBeforeMs);

    // --- Outbound ---
    var outboundOrigin = homeStr;
    var outboundDurationMin = isGymAshburton ? TRAVEL_GYM_DRIVE_MINUTES : cacheGet(homeStr, evLoc);
    var parentIdx = _travelIndexOfContainingEvent(events, i);
    if (parentIdx >= 0 && !isGymAshburton) {
      outboundOrigin = events[parentIdx].getLocation();
      outboundDurationMin = cacheGet(outboundOrigin, evLoc);
    } else if (i > 0 && !isGymAshburton) {
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

    var pushOutbound = (outboundOrigin === homeStr || parentIdx >= 0) && outboundDurationMin != null && outboundDurationMin > 0;
    if (pushOutbound) {
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
    var inboundDurationMin = isGymAshburton ? TRAVEL_GYM_DRIVE_MINUTES : cacheGet(evLoc, homeStr);
    if (i < events.length - 1 && !isGymAshburton) {
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

/** Wipes all future events on the Travel calendar (no tag filter). Uses wipeCalendarFutureEvents in Code.gs. */
function wipeTravelCalendar() {
  wipeCalendarFutureEvents(TRAVEL_CALENDAR_ID);
}

/**
 * DIAGNOSTIC: Run this from the Apps Script editor to log any gym-like events in the next 14 days.
 * Use the output to tune TRAVEL_GYM_* / SLEEP_IGNORE_* criteria. View log: Executions > (run) > Logs.
 * Copy the "--- EVENT DATA (paste this for tuning) ---" block and paste it back so we can fix matching.
 */
function logGymCandidatesForTuning() {
  var now = new Date();
  var startDate = new Date(now.getTime());
  startDate.setHours(0, 0, 0, 0);
  var endDate = new Date(startDate.getTime());
  endDate.setDate(endDate.getDate() + 14);
  endDate.setHours(23, 59, 59, 999);

  var keywords = ["gym", "snap", "fitness", "ashburton"];
  var allCalendars = CalendarApp.getAllCalendars();
  var found = [];

  for (var i = 0; i < allCalendars.length; i++) {
    var cal = allCalendars[i];
    if (_travelIsCalendarExcluded(cal)) continue;
    var calEvents = cal.getEvents(startDate, endDate);
    for (var k = 0; k < calEvents.length; k++) {
      var ev = calEvents[k];
      if (ev.isAllDayEvent()) continue;
      var title = (ev.getTitle() || "");
      var loc = (ev.getLocation() || "");
      var titleLower = title.toLowerCase();
      var locLower = loc.toLowerCase();
      var match = false;
      for (var w = 0; w < keywords.length; w++) {
        if (titleLower.indexOf(keywords[w]) !== -1 || locLower.indexOf(keywords[w]) !== -1) {
          match = true;
          break;
        }
      }
      if (!match) continue;
      var isMatch = _travelIsGymAshburton(ev);
      found.push({
        title: title,
        location: loc,
        start: ev.getStartTime(),
        end: ev.getEndTime(),
        calendar: cal.getName(),
        currentMatch: isMatch
      });
    }
  }

  Logger.log("=== Gym candidate events (next 14 days) ===");
  if (found.length === 0) {
    Logger.log("No events found containing gym/snap/fitness/ashburton. Try widening the date range or keywords.");
    return;
  }
  for (var f = 0; f < found.length; f++) {
    var o = found[f];
    Logger.log("--- EVENT DATA (paste this for tuning) ---");
    Logger.log("title: " + JSON.stringify(o.title));
    Logger.log("location: " + JSON.stringify(o.location));
    Logger.log("title.length: " + o.title.length + ", location.length: " + o.location.length);
    Logger.log("start: " + o.start.toISOString ? o.start.toISOString() : String(o.start));
    Logger.log("end: " + o.end.toISOString ? o.end.toISOString() : String(o.end));
    Logger.log("calendar: " + o.calendar);
    Logger.log("currentMatch (is Gym Ashburton?): " + o.currentMatch);
    Logger.log("--- END EVENT ---");
  }
}
