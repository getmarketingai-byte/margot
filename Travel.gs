/**
 * Travel / drive events module.
 * Scans configured calendars for events with locations, gets drive durations via Maps (no tolls),
 * and creates [Drive] events on a dedicated travel calendar. Arrive 15 min before each event,
 * leave immediately after. When time at home between two events would be < 30 min, travel
 * goes directly between those locations instead of via home.
 * If the source event is marked as "free", the drive events for that leg are also created as free.
 *
 * Requires: Maps service and Calendar Advanced Service (Resources > Advanced Google services).
 * Configure TRAVEL_CALENDAR_ID in Config.gs.
 */

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
function _getDriveDurationMinutes(origin, destination) {
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
    console.warn("_getDriveDurationMinutes failed: " + e.message + " (" + origin + " -> " + destination + ")");
    return null;
  }
}

/**
 * Returns home as a string for Directions API: "lat,lng" using LOCATION_LAT, LOCATION_LONG from Config.gs.
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
 * Returns true if the calendar should be excluded from travel scanning
 * (name or ID in CALENDARS_TO_EXCLUDE from Config.gs, travel calendar, or dedicated gym-events calendar).
 */
function _travelIsCalendarExcluded(cal) {
  var id = cal.getId();
  if (id === TRAVEL_CALENDAR_ID) return true;
  if (typeof GYM_EVENT_CALENDAR_ID !== "undefined" && id === GYM_EVENT_CALENDAR_ID) return true;
  var name = cal.getName();
  for (var i = 0; i < CALENDARS_TO_EXCLUDE.length; i++) {
    var ex = CALENDARS_TO_EXCLUDE[i];
    if (ex === name || ex === id) return true;
  }
  return false;
}

/**
 * Returns true if the location string is the configured Gym location (used to skip Maps API for that leg).
 */
function _travelIsGymLocation(loc) {
  return (loc || "").indexOf(GYM_LOCATION_SUBSTRING) !== -1;
}

/**
 * Returns true if the event is the special-case Gym (fixed drive minutes, no arrival buffer).
 * Location is matched by containing GYM_LOCATION_SUBSTRING (handles full address e.g. "..., 234 High St, ...").
 */
function _travelIsGymAshburton(calendarEvent) {
  var title = (calendarEvent.getTitle() || "").trim();
  var loc = (calendarEvent.getLocation() || "").trim();
  return title === GYM_TITLE && _travelIsGymLocation(loc);
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

function _travelHashString(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  var out = "";
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] + 256) % 256;
    var h = v.toString(16);
    if (h.length < 2) h = "0" + h;
    out += h;
  }
  return out;
}

function _travelLegPropKey(origin, dest) {
  return TRAVEL_LEG_STATE_PREFIX + _travelHashString(origin + "\n" + dest);
}

function _travelGetLegState(origin, dest) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(_travelLegPropKey(origin, dest));
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

function _travelSetLegState(origin, dest, state) {
  try {
    PropertiesService.getScriptProperties().setProperty(_travelLegPropKey(origin, dest), JSON.stringify(state || {}));
  } catch (e) {
    console.warn("_travelSetLegState failed: " + e.message);
  }
}

/**
 * Returns true when a leg is currently using the default fallback duration constant.
 */
function _travelLegUsesDefaultFallback(origin, dest) {
  var state = _travelGetLegState(origin, dest);
  return !!(state
    && state.usedFallback === true
    && state.durationMin === TRAVEL_FALLBACK_DURATION_MINUTES);
}

function _travelBuildLegCandidates(events, homeStr) {
  var byKey = {};
  function addLeg(origin, dest, priorityTimeMs) {
    if (!origin || !dest) return;
    var legKey = origin + "\n" + dest;
    if (!byKey[legKey] || priorityTimeMs < byKey[legKey].priorityTimeMs) {
      byKey[legKey] = { key: legKey, origin: origin, dest: dest, priorityTimeMs: priorityTimeMs };
    }
  }

  for (var i = 0; i < events.length; i++) {
    var loc = events[i].getLocation();
    addLeg(homeStr, loc, events[i].getStartTime().getTime());
    addLeg(loc, homeStr, events[i].getEndTime().getTime());
  }
  for (var i = 0; i < events.length - 1; i++) {
    addLeg(events[i].getLocation(), events[i + 1].getLocation(), events[i + 1].getStartTime().getTime());
  }
  for (var i = 0; i < events.length; i++) {
    var parentIdx = _travelIndexOfContainingEvent(events, i);
    if (parentIdx >= 0) {
      addLeg(events[parentIdx].getLocation(), events[i].getLocation(), events[i].getStartTime().getTime());
    }
  }

  var out = [];
  for (var k in byKey) out.push(byKey[k]);
  out.sort(function (a, b) { return a.priorityTimeMs - b.priorityTimeMs; });
  return out;
}

/**
 * Builds duration cache using quota-aware Maps lookups:
 * - prioritize soonest stale (>3 days), never-checked, or fallback legs
 * - spend Maps calls up to per-run budget
 * - use stored durations/fallback for remaining legs
 * @param {{maxRuntimeMs?: number}} [runOptions] - Optional runtime guard for stale-leg refresh loop.
 */
function _travelBuildDurationCache(events, homeStr, runOptions) {
  var cache = {};
  var nowMs = Date.now();
  var legs = _travelBuildLegCandidates(events, homeStr);
  var budgetInfo = _getQuotaRunBudget(QUOTA_SERVICE_MAPS_DIRECTION);
  var mapsBudget = budgetInfo.budget;
  var mapsCallsUsed = 0;
  var mapsCallsAttempted = 0;
  var staleLegs = [];
  var runStartMs = Date.now();
  var maxRuntimeMs = runOptions && runOptions.maxRuntimeMs ? runOptions.maxRuntimeMs : null;

  for (var i = 0; i < legs.length; i++) {
    var leg = legs[i];
    if (_travelIsGymLocation(leg.origin) || _travelIsGymLocation(leg.dest)) {
      cache[leg.key] = GYM_DRIVE_MINUTES;
      continue;
    }
    var state = _travelGetLegState(leg.origin, leg.dest);
    var hasDuration = state && state.durationMin != null && state.durationMin > 0;
    if (hasDuration) cache[leg.key] = state.durationMin;

    var staleByAge = !state || !state.lastCheckedMs || (nowMs - state.lastCheckedMs) >= TRAVEL_RECHECK_STALE_MS;
    var needsRefresh = !hasDuration || staleByAge || (state && state.usedFallback === true);
    if (needsRefresh) staleLegs.push({ leg: leg, state: state });
  }

  staleLegs.sort(function (a, b) {
    var aFallback = (a.state && a.state.usedFallback) ? 0 : 1;
    var bFallback = (b.state && b.state.usedFallback) ? 0 : 1;
    if (aFallback !== bFallback) return aFallback - bFallback;
    return a.leg.priorityTimeMs - b.leg.priorityTimeMs;
  });

  for (var s = 0; s < staleLegs.length; s++) {
    if (maxRuntimeMs != null && (Date.now() - runStartMs) >= maxRuntimeMs) {
      console.warn("Travel runtime guard reached while refreshing stale leg durations. Remaining legs will use stored/fallback durations.");
      break;
    }
    if (mapsCallsUsed >= mapsBudget) break;
    var candidate = staleLegs[s].leg;
    try {
      var mins = _getDriveDurationMinutes(candidate.origin, candidate.dest);
      mapsCallsAttempted++;
      mapsCallsUsed++;
      if (mins != null && mins > 0) {
        cache[candidate.key] = mins;
        _travelSetLegState(candidate.origin, candidate.dest, {
          durationMin: mins,
          lastCheckedMs: nowMs,
          usedFallback: false
        });
      } else {
        var prevState = _travelGetLegState(candidate.origin, candidate.dest) || {};
        var fbMins = prevState.durationMin != null ? prevState.durationMin : TRAVEL_FALLBACK_DURATION_MINUTES;
        cache[candidate.key] = fbMins;
        _travelSetLegState(candidate.origin, candidate.dest, {
          durationMin: fbMins,
          lastCheckedMs: prevState.lastCheckedMs || 0,
          usedFallback: true,
          lastFallbackMs: nowMs
        });
      }
      if (TRAVEL_MAPS_SLEEP_EVERY_N > 0 && mapsCallsAttempted % TRAVEL_MAPS_SLEEP_EVERY_N === 0) {
        Utilities.sleep(TRAVEL_MAPS_SLEEP_MS);
      }
    } catch (e) {
      if (_travelIsMapsQuotaError(e)) {
        console.warn("Maps daily limit reached during prioritized refresh. Remaining legs will use stored/fallback durations.");
        break;
      }
      console.warn("_travelBuildDurationCache leg lookup failed: " + e.message);
    }
  }

  _commitQuotaUsage(QUOTA_SERVICE_MAPS_DIRECTION, mapsCallsUsed);

  for (var i = 0; i < legs.length; i++) {
    var leg = legs[i];
    if (cache[leg.key] != null) continue;
    if (_travelIsGymLocation(leg.origin) || _travelIsGymLocation(leg.dest)) {
      cache[leg.key] = GYM_DRIVE_MINUTES;
      continue;
    }
    var state = _travelGetLegState(leg.origin, leg.dest) || {};
    var fallbackMins = state.durationMin != null ? state.durationMin : TRAVEL_FALLBACK_DURATION_MINUTES;
    cache[leg.key] = fallbackMins;
    _travelSetLegState(leg.origin, leg.dest, {
      durationMin: fallbackMins,
      lastCheckedMs: state.lastCheckedMs || 0,
      usedFallback: true,
      lastFallbackMs: nowMs
    });
  }

  console.log("Travel quota: limit=" + budgetInfo.limit + ", used=" + budgetInfo.used + ", remaining=" + budgetInfo.remaining + ", budgetThisRun=" + budgetInfo.budget + ", mapsCallsUsed=" + mapsCallsUsed + ", staleLegs=" + staleLegs.length + ", totalLegs=" + legs.length);
  return cache;
}

/**
 * Main entry: updates drive events on the travel calendar for the scheduling window.
 * Syncs [Drive] events: only deletes orphans, creates missing, updates in place (avoids API rate limit).
 * @param {number} [dayOffset=0] - Start this many days from today (for chunked runs).
 * @param {number} [dayCount] - Number of days to process; default SCHEDULING_WINDOW. Use with dayOffset to run in chunks.
 * @param {{maxRuntimeMs?: number}} [runOptions] - Optional runtime guard for Maps stale-leg refresh.
 */
function updateTravelDriveEvents(dayOffset, dayCount, runOptions) {
  var travelCal = CalendarApp.getCalendarById(TRAVEL_CALENDAR_ID);
  if (!travelCal) {
    console.warn("Travel calendar not found. Set TRAVEL_CALENDAR_ID in Config.gs.");
    return;
  }

  var now = new Date();
  var startDate = new Date(now.getTime());
  startDate.setHours(0, 0, 0, 0);
  if (dayOffset != null && dayOffset > 0) {
    startDate.setDate(startDate.getDate() + dayOffset);
  }
  var numDays = (dayCount != null && dayCount > 0) ? dayCount : SCHEDULING_WINDOW;
  var endDate = new Date(startDate.getTime());
  endDate.setDate(endDate.getDate() + numDays);
  endDate.setHours(23, 59, 59, 999);

  var events = _travelCollectEventsWithLocations(startDate, endDate);
  if (events.length === 0) {
    _syncCalendarEvents(travelCal, TRAVEL_DRIVE_EVENT_TAG, startDate, endDate, [], {
      keyFromExisting: function (ev) { return String(ev.getStartTime().getTime()) + "_" + ev.getEndTime().getTime(); }
    });
    return;
  }

  var homeStr = _travelHomeOrigin();
  var cache = _travelBuildDurationCache(events, homeStr, runOptions);

  var cacheGet = function (origin, dest) {
    return cache[origin + "\n" + dest];
  };

  var arriveBeforeMs = TRAVEL_ARRIVE_MINUTES_BEFORE * 60 * 1000;
  var minHomeMs = TRAVEL_MIN_HOME_MINUTES * 60 * 1000;
  var desiredDrive = [];
  var fallbackNote = " (fallback " + TRAVEL_FALLBACK_DURATION_MINUTES + "m)";

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
    var outboundDurationMin = isGymAshburton ? GYM_DRIVE_MINUTES : cacheGet(homeStr, evLoc);
    var outboundUsesDefaultFallback = isGymAshburton ? false : _travelLegUsesDefaultFallback(homeStr, evLoc);
    var parentIdx = _travelIndexOfContainingEvent(events, i);
    if (parentIdx >= 0 && !isGymAshburton) {
      outboundOrigin = events[parentIdx].getLocation();
      outboundDurationMin = cacheGet(outboundOrigin, evLoc);
      outboundUsesDefaultFallback = _travelLegUsesDefaultFallback(outboundOrigin, evLoc);
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
        outboundUsesDefaultFallback = _travelLegUsesDefaultFallback(prevLoc, evLoc);
      }
    }

    var pushOutbound = (outboundOrigin === homeStr || parentIdx >= 0) && outboundDurationMin != null && outboundDurationMin > 0;
    if (pushOutbound) {
      var outboundStart = new Date(arriveAt.getTime() - outboundDurationMin * 60 * 1000);
      var outboundTitle = TRAVEL_DRIVE_EVENT_TAG + " To: " + evTitle;
      if (outboundUsesDefaultFallback) outboundTitle += fallbackNote;
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
    var inboundDurationMin = isGymAshburton ? GYM_DRIVE_MINUTES : cacheGet(evLoc, homeStr);
    var inboundUsesDefaultFallback = isGymAshburton ? false : _travelLegUsesDefaultFallback(evLoc, homeStr);
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
        inboundUsesDefaultFallback = _travelLegUsesDefaultFallback(evLoc, inboundDest);
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
      if (inboundUsesDefaultFallback) inboundTitle += fallbackNote;
      desiredDrive.push({
        title: inboundTitle,
        start: inboundStart,
        end: inboundEnd,
        key: String(inboundStart.getTime()) + "_" + inboundEnd.getTime(),
        free: evIsFree
      });
    }
  }

  _syncCalendarEvents(travelCal, TRAVEL_DRIVE_EVENT_TAG, startDate, endDate, desiredDrive, {
    keyFromExisting: function (ev) {
      return String(ev.getStartTime().getTime()) + "_" + ev.getEndTime().getTime();
    },
    setFree: _travelSetEventFree
  });
}

