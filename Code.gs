/**
 * Google Apps Script: Calendar automations (timemaps, work, sleep, pay period, travel drive events).
 * Enable Calendar Advanced Service: Resources > Advanced Google services > Calendar API.
 * For travel drive events (Travel.gs): enable Maps service.
 * For getFlightData(): set script property AVIATION_STACK_API_KEY in Project properties.
 * Configuration constants live in Config.gs.
 */

async function Update_InsideTimemap() //rolls daylight and nice weather into one timemap.
{
  var timemap_cal = CalendarApp.getCalendarById(TIMEMAP_CALENDAR_ID);
    var startDate = new Date();
  startDate.setHours(0, 0, 0);

  var endDate = new Date();
  endDate.setHours(23, 59, 0);
  endDate.setDate(startDate.getDate() + SCHEDULING_WINDOW);

  _Update_InvertedTimemap(timemap_cal, startDate, endDate, "[Outside]", "[Inside]");
}

async function Update_InsideOutsideTimemap() //rolls daylight and nice weather into one timemap.
{
  var timemap_cal = CalendarApp.getCalendarById(TIMEMAP_CALENDAR_ID);

  var startDate = new Date();
  startDate.setHours(0, 0, 0);

  var endDate = new Date();
  endDate.setHours(23, 59, 0);
  endDate.setDate(startDate.getDate() + SCHEDULING_WINDOW);


  
  var w_data = await get_WeatherData();
  if (w_data[w_data.length - 1].NiceWeather) //make sure the final state will closeout the final event
  {
    w_data[w_data.length - 1].NiceWeather = false;
  }
  var tempEventList = [];
  var previous_NiceWeather = false;
  //var j = 0;
  var tempObj = {};
  for (var i in w_data) {

    //check within start and end date - including previous hour
    if (w_data[i].time.valueOf() >= startDate.valueOf() - 3600000 && w_data[i].time.valueOf() <= endDate.valueOf()) {
      if (w_data[i].NiceWeather) {
        //var tempObj = {};
        if (previous_NiceWeather == false) //check for state change
        {
          tempObj["niceweather_start"] = w_data[i].time;

        }
        previous_NiceWeather = true;

      }
      else {
        if (previous_NiceWeather == true) //check for state change
        {
          tempObj["niceweather_stop"] = w_data[i].time;
          tempObj["source"] = "WEATHER";
          tempEventList.push(Object.assign({}, tempObj));
          //j++;
        }
        previous_NiceWeather = false;

      }
    }
  }
  if ((ASSUME_NICEWEATHER_BEYOND_FORCAST || BEYOND_FORCAST_IS_INSIDE) && tempEventList.length > 0) {
    //tempEventList[j]= {};
    const lastEvent = tempEventList[tempEventList.length - 1].niceweather_stop;;
    const newStart = new Date(tempEventList[tempEventList.length - 1].niceweather_stop.getTime() + 24 * 60 * 60 * 1000);
    newStart.setHours(6, 0, 0);
    //var remainingDays = endDate - newStart;
    var i = 0;
    var temp_date = new Date(newStart.getTime());
    //temp_date.setDate(newStart.getDate());
    var tempObj = {};
    while (temp_date.valueOf() <= endDate.valueOf()) {

      //var dayEvents = [];
      //var temp_date = new Date;


      var sundata = await get_SunRiseSet(LOCATION_LAT, LOCATION_LONG, temp_date);
      var sunrise = sundata.results.sunrise;
      var sunset = sundata.results.sunset;
      //tempEventList[j] = {};
      tempObj["niceweather_start"] = sunrise;
      tempObj["niceweather_stop"] = sunset;
      tempObj["source"] = "SUN";
      tempEventList.push(Object.assign({}, tempObj));
      i++;
      temp_date = new Date(temp_date.getTime() + 24 * 60 * 60 * 1000);
      temp_date.setHours(6, 0, 0);
      //j++;
    }
  }
  var desiredOutside = [];
  for (var k in tempEventList) {
    var s = tempEventList[k].niceweather_start;
    var e = tempEventList[k].niceweather_stop;
    if (s.valueOf() < e.valueOf()) {
      desiredOutside.push({ title: "[Outside]", start: s, end: e, key: String(s.getTime()) });
    }
  }
  _syncCalendarEvents(timemap_cal, "[Outside]", startDate, endDate, desiredOutside, {
    keyFromExisting: function (ev) { return String(ev.getStartTime().getTime()); }
  });
  _Update_InvertedTimemap(timemap_cal, startDate, endDate, "[Outside]", "[Inside]");
  if (WORK_OFFICE_IS_INSIDE) {
    await _BlindAdd_TimeMapEvents_from_EventArr(timemap_cal, timemap_cal.getEvents(startDate, endDate, { search: "[Work_Office]" }), "[Inside]");
  }
  if (BEYOND_FORCAST_IS_INSIDE && tempEventList.length > 0) {
    var j = 0;
    var notFound = true;
    while (notFound && j < tempEventList.length) {
      if (tempEventList[j].source == "SUN") {
        notFound = false;
        var sDate = tempEventList[j - 1].niceweather_stop;
      }
      j++;
    }
    if (!notFound) {
      await _BlindAdd_TimeMapEvents_from_EventArr(timemap_cal, timemap_cal.getEvents(sDate, endDate, { search: "[Outside]" }), "[Inside]");
    }
  }
  return 0;
}

/**
 * Reads rolling 24h quota state for a service and resets window when expired.
 * Stored shape: { startMs: number, used: number }.
 */
function _getQuotaState(serviceName) {
  var props = PropertiesService.getScriptProperties();
  var key = QUOTA_STATE_PREFIX + serviceName;
  var now = Date.now();
  var state = { startMs: now, used: 0 };
  var raw = props.getProperty(key);
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.startMs && parsed.used != null) state = parsed;
    } catch (e) {
      state = { startMs: now, used: 0 };
    }
  }
  if (now - state.startMs >= QUOTA_WINDOW_MS || state.used < 0) {
    state = { startMs: now, used: 0 };
    props.setProperty(key, JSON.stringify(state));
  }
  return state;
}

function _getQuotaDailyLimit(serviceName) {
  if (serviceName === QUOTA_SERVICE_MAPS_DIRECTION) return MAPS_DIRECTION_DAILY_LIMIT;
  if (serviceName === QUOTA_SERVICE_CALENDAR_CREATES) return CALENDAR_EVENTS_CREATED_DAILY_LIMIT;
  return 0;
}

/**
 * Returns per-run budget for a quota service using burst-then-backoff strategy.
 * - while usage < 75%, budget tries to jump to 75% quickly
 * - after 75%, budget scales down with remaining quota
 */
function _getQuotaRunBudget(serviceName) {
  var limit = _getQuotaDailyLimit(serviceName);
  var state = _getQuotaState(serviceName);
  var used = Math.min(state.used || 0, limit);
  var remaining = Math.max(0, limit - used);
  if (remaining <= 0) return { limit: limit, used: used, remaining: 0, budget: 0 };

  var usedFrac = limit > 0 ? used / limit : 1;
  var targetUsed = Math.floor(limit * QUOTA_BURST_TARGET_FRACTION);
  var budget;
  if (used < targetUsed) {
    budget = Math.max(1, targetUsed - used);
  } else if (usedFrac >= QUOTA_BACKOFF_SOFT_STOP_FRACTION) {
    budget = Math.max(1, Math.ceil(remaining * QUOTA_BACKOFF_LOW_REMAINING_FRACTION));
  } else if (usedFrac >= QUOTA_BACKOFF_START_FRACTION) {
    budget = Math.max(1, Math.ceil(remaining * QUOTA_BACKOFF_MID_REMAINING_FRACTION));
  } else {
    budget = remaining;
  }
  if (budget > remaining) budget = remaining;
  return { limit: limit, used: used, remaining: remaining, budget: budget };
}

function _commitQuotaUsage(serviceName, amountUsed) {
  if (!amountUsed || amountUsed <= 0) return;
  var props = PropertiesService.getScriptProperties();
  var key = QUOTA_STATE_PREFIX + serviceName;
  var state = _getQuotaState(serviceName);
  var limit = _getQuotaDailyLimit(serviceName);
  state.used = Math.min(limit, (state.used || 0) + amountUsed);
  props.setProperty(key, JSON.stringify(state));
}

/**
 * Deletes all events in the given calendar that start on or after 'now'.
 * Does not filter by tag - every future event in the calendar is removed.
 * @param {string} calendarId - Full calendar ID (from Calendar settings).
 * @param {number} [daysAhead=400] - How far ahead to look (default covers scheduling window + buffer).
 */
function _wipeCalendarFutureEvents(calendarId, daysAhead) {
  if (daysAhead == null) daysAhead = 400;
  var cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) {
    console.warn("_wipeCalendarFutureEvents: calendar not found for id " + calendarId);
    return;
  }
  var now = new Date();
  var nowMs = now.getTime();
  var end = new Date(now.getTime());
  end.setDate(end.getDate() + daysAhead);
  end.setHours(23, 59, 59, 999);
  var events = cal.getEvents(now, end);
  for (var j = 0; j < events.length; j++) {
    // Only delete events that *start* on or after now (doc). Events that started before now
    // (e.g. last night's sleep ending this morning) must be kept so time maps don't start from midnight.
    if (events[j].getStartTime().getTime() >= nowMs) {
      events[j].deleteEvent();
    }
  }
}

async function _wipeCalendar(CALENDAR_ID) {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const now = new Date();
  const endDate = new Date();
  endDate.setHours(23, 59, 0);
  endDate.setDate(now.getDate() + 365);

  var events = cal.getEvents(now, endDate);
  for (var j in events) {
    events[j].deleteEvent();
  }
}




function _isNiceWeather(weatherData) {

  //var nice = true;
  /***************************
   * NICE WEATHER CONDITIONS *
   ***************************/
  //Chance of rain < X%
  if (weatherData.precipitation_probability >= 25) {
    return false;
  }
  //Temp is between X degC
  if (weatherData.temperature_2m <= 13 || weatherData.temperature_2m >= 35) {
    return false;
  }
  //Wind Less than X Km/h
  if (weatherData.windspeed_10m >= 50) {
    return false;
  }
  //UV Less Than 
  if (weatherData.uv_index >= 8) {
    return false;
  }
  //is Daylight 

  //humidity less than 90%
  /*if(weatherData.relativehumidity_2m >= 90)
  {
   return false;
  }*/

  if (weatherData.is_day == 0) {
    return false;
  }
  return true;
}

function _addDays(date, days) {
  var result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}



async function updateWorkEvents() {
  const work_cal = await CalendarApp.getCalendarById(WORK_CALENDAR_ID);
  const timemap_cal = await CalendarApp.getCalendarById(TIMEMAP_CALENDAR_ID);

  const now = new Date();
  const endDate = new Date();
  endDate.setHours(23, 59, 0);
  endDate.setDate(now.getDate() + SCHEDULING_WINDOW);

  const events = await work_cal.getEvents(now, endDate);
  var desiredWorkOffice = [];
  for (var i = 0; i < events.length; i++) {
    if (events[i].isAllDayEvent() || (events[i].getTitle() || "").includes("[MIN")) continue;
    var s = events[i].getStartTime();
    var e = events[i].getEndTime();
    desiredWorkOffice.push({ title: "[Work_Office]", start: s, end: e, key: String(s.getTime()) });
  }
  _syncCalendarEvents(timemap_cal, "[Work_Office]", now, endDate, desiredWorkOffice, {
    keyFromExisting: function (ev) { return String(ev.getStartTime().getTime()); }
  });
}

function _getCurrentPayPeriodDates(d) {
  if (typeof d === 'undefined') {
    var d = new Date();
  }


  // calculate start of pay period
  var start_of_current_PayPeriod = new Date(REFERENCE_PAY_PERIOD_START);
  var payStart = Math.floor(((d - REFERENCE_PAY_PERIOD_START) / 1000 / 60 / 60 / 24) / PAY_PERIOD); // how many pay periods between reference and now
  start_of_current_PayPeriod = _addDays(start_of_current_PayPeriod, PAY_PERIOD * payStart);
  start_of_current_PayPeriod.setHours(0, 0, 0);

  // calulate end of pay period
  var end_of_current_PayPeriod = new Date(start_of_current_PayPeriod);
  end_of_current_PayPeriod = _addDays(end_of_current_PayPeriod, PAY_PERIOD - 1);
  end_of_current_PayPeriod.setHours(23, 59, 0);

  return { payPeriodStart: start_of_current_PayPeriod, payPeriodEnd: end_of_current_PayPeriod };
}

async function addEvents_WorkingHoursTotals() {
  var work_cal = await CalendarApp.getCalendarById(WORK_CALENDAR_ID);
  var d = new Date();
  var rangeStart = null;
  var rangeEnd = null;
  var desiredEndOfCycle = [];
  var desiredMinAchieved = [];
  var desiredMinNotMet = [];

  do {
    var payDates = _getCurrentPayPeriodDates(d);
    var start_of_current_FN = payDates.payPeriodStart;
    var end_of_current_FN = payDates.payPeriodEnd;
    if (rangeStart === null) rangeStart = new Date(start_of_current_FN.getTime());
    rangeEnd = new Date(end_of_current_FN.getTime());

    var allEvents = work_cal.getEvents(start_of_current_FN, end_of_current_FN);
    var workevents = [];
    for (var e = 0; e < allEvents.length; e++) {
      var t = (allEvents[e].getTitle() || "");
      if (t.indexOf("[MIN") === -1 && t.indexOf("[END OF PAY CYCLE]") === -1 && t.indexOf("[TOTAL HOURS]") === -1) workevents.push(allEvents[e]);
    }

    var totalDuration = 0;
    var durationArr = [];
    for (var i = 0; i < workevents.length; i++) {
      var duration = Math.ceil((workevents[i].getEndTime() - workevents[i].getStartTime()) / 1000 / 60);
      durationArr.push(duration);
      totalDuration += duration;
    }

    var endCycleStart = new Date(end_of_current_FN.getTime() - 1000 * 60 * SUMMARY_EVENT_DURATION_MINUTES);
    desiredEndOfCycle.push({
      title: "[END OF PAY CYCLE] hrs:" + Math.ceil(totalDuration / 60) + " ~$" + (totalDuration / 60 * HOURLY_RATE),
      start: endCycleStart,
      end: end_of_current_FN,
      key: String(end_of_current_FN.getTime()),
      free: true
    });

    if (MIN_WORK_HOURS_ENABLE) {
      if (totalDuration >= MIN_WORKING_MINUTES_PER_FORTNIGHT) {
        var overflow = totalDuration - MIN_WORKING_MINUTES_PER_FORTNIGHT;
        var j = durationArr.length - 1;
        do {
          overflow = overflow - durationArr[j];
          j--;
        } while (overflow > 0);
        var startTime = new Date(workevents[j + 1].getStartTime().getTime() + Math.abs(overflow) * 60 * 1000);
        var endTime = new Date(startTime.getTime() + 1000 * 60 * SUMMARY_EVENT_DURATION_MINUTES);
        desiredMinAchieved.push({
          title: "[MIN HOURS ACHIEVED] " + Math.ceil(MIN_WORKING_MINUTES_PER_FORTNIGHT / 60) + "Hours worked!",
          start: startTime,
          end: endTime,
          key: String(startTime.getTime())
        });
      } else {
        var Remaining_minutes = (MIN_WORKING_MINUTES_PER_FORTNIGHT - totalDuration);
        var RemainingDays = Math.ceil(Remaining_minutes / 60 / 8);
        var endTime = new Date(end_of_current_FN.getTime());
        for (var i = 0; i < RemainingDays; i++) {
          if (i > 0) endTime = new Date(endTime.getTime() - (1000 * 60 * 60 * 24));
          if (endTime.getDay() === 0) endTime.setTime(endTime.getTime() - 2 * 24 * 60 * 60 * 1000);
          else if (endTime.getDay() === 6) endTime.setTime(endTime.getTime() - 24 * 60 * 60 * 1000);
          endTime.setHours(17, 0, 0);
          var startTime;
          var nextRemaining = 0;
          if (Remaining_minutes / 60 > 8) {
            startTime = new Date(endTime.getTime() - 8 * 60 * 60 * 1000);
            nextRemaining = Remaining_minutes - 8 * 60;
          } else {
            startTime = new Date(endTime.getTime() - Remaining_minutes * 60 * 1000);
          }
          desiredMinNotMet.push({
            title: "[MIN HOURS NOT MET] " + Remaining_minutes / 60 + "hr Remaining",
            start: startTime,
            end: new Date(endTime.getTime()),
            key: String(startTime.getTime()),
            free: WORK_REMAINING_HOUR_EVENT_STATUS_FREE
          });
          Remaining_minutes = nextRemaining;
        }
      }
    }
    d = _Date_add_days(d, 15);
  } while (_dateDifference(d, _Date_add_days(new Date(), SCHEDULING_WINDOW), 'days') > 0);

  if (rangeStart === null) return;
  var endCycleOpts = { keyFromExisting: function (ev) { return String(ev.getEndTime().getTime()); }, setFree: _setEventFreeForSync };
  _syncCalendarEvents(work_cal, "[END OF PAY CYCLE]", rangeStart, rangeEnd, desiredEndOfCycle, endCycleOpts);
  _syncCalendarEvents(work_cal, "[MIN HOURS ACHIEVED]", rangeStart, rangeEnd, desiredMinAchieved, { keyFromExisting: function (ev) { return String(ev.getStartTime().getTime()); } });
  _syncCalendarEvents(work_cal, "[MIN HOURS NOT MET]", rangeStart, rangeEnd, desiredMinNotMet, { keyFromExisting: function (ev) { return String(ev.getStartTime().getTime()); }, setFree: _setEventFreeForSync });
}

/**
 * Creates a calendar event and sets its availability to "free" (transparent).
 * Requires the Calendar Advanced Service to be enabled (Resources > Advanced Google services).
 */
async function createEventAndSetAvailabilityToFREE({ calendar, title, startTime, endTime }) {
  var newEvent = calendar.createEvent(title, startTime, endTime);
  var calendarID = calendar.getId();
  var eventId = newEvent.getId().slice(0, newEvent.getId().length - 11);
  return Calendar.Events.patch({ transparency: "transparent" }, calendarID, eventId);
}

/** Sets an existing event to "free" (transparent). Used by _syncCalendarEvents when desired.free is true. */
function _setEventFreeForSync(calendar, event) {
  try {
    var eventId = event.getId().slice(0, event.getId().length - 11);
    Calendar.Events.patch({ transparency: "transparent" }, calendar.getId(), eventId);
  } catch (e) {
    console.warn("_setEventFreeForSync failed: " + e.message);
  }
}

/** Returns Calendar API eventId from CalendarApp event id (strips @google.com suffix if present). */
function _eventGetApiEventId(calendarEventId) {
  if (!calendarEventId) return calendarEventId;
  return calendarEventId.slice(-11) === "@google.com" ? calendarEventId.slice(0, -11) : calendarEventId;
}

/**
 * Returns true if the event blocks time (busy), false when explicitly transparent.
 * Uses Calendar advanced service; if lookup fails, treats as busy to be safe.
 */
function _eventShouldDefaultFreeOnLookupFailure(calendarEvent) {
  if (!calendarEvent) return false;
  try {
    var title = typeof calendarEvent.getTitle === "function" ? (calendarEvent.getTitle() || "") : "";
    var titleLower = title.toLowerCase();
    if (titleLower.indexOf("declined:") === 0 || titleLower.indexOf("pending:") === 0) return true;
  } catch (_titleError) {}
  try {
    if (typeof calendarEvent.getMyStatus === "function") {
      var myStatus = calendarEvent.getMyStatus();
      if (myStatus === CalendarApp.GuestStatus.NO) return true;
    }
  } catch (_statusError) {}
  return false;
}

function _eventIsBusyByTransparency(calendarEvent, calendarId, calendarName) {
  var calId = calendarId ? String(calendarId) : "";
  var calName = calendarName ? String(calendarName) : "";
  var rawEventId = "";
  var apiEventId = "";
  if (!calendarEvent) return true;
  try {
    if (typeof calendarEvent.getId === "function") rawEventId = calendarEvent.getId() || "";
    apiEventId = _eventGetApiEventId(rawEventId);
    if (!calId) throw new Error("Missing calendar id for busy lookup" + (calName ? " in " + calName : ""));
    if (!rawEventId) throw new Error("Missing event id for busy lookup" + (calName ? " in " + calName : ""));
    var ev = null;
    try {
      ev = Calendar.Events.get(calId, rawEventId);
    } catch (primaryLookupError) {
      if (apiEventId && apiEventId !== rawEventId) {
        ev = Calendar.Events.get(calId, apiEventId);
      } else {
        throw primaryLookupError;
      }
    }
    return ev.transparency !== "transparent";
  } catch (e) {
    if (_eventShouldDefaultFreeOnLookupFailure(calendarEvent)) return false;
    // Keep default-safe behavior: if transparency cannot be resolved, treat as busy.
    return true;
  }
}

function _Date_add_days(date, numDays) {
  var newDate = new Date();
  newDate.setTime(date.getTime() + 1000 * 60 * 60 * 24 * numDays);
  return newDate;
}

/**
 * Returns the difference between two dates in the specified unit.
 * Positive if secondDate is later than firstDate.
 * @param {Date} firstDate
 * @param {Date} secondDate
 * @param {string} unit - 'milliseconds'|'seconds'|'minutes'|'hours'|'days'|'weeks'|'years'
 * @return {number}
 */
function _dateDifference(firstDate, secondDate, unit) {
  var val1 = firstDate.valueOf();
  var val2 = secondDate.valueOf();
  var differenceMilliSec = val2 - val1;

  if (unit === 'milliseconds' || unit === undefined) {
    return differenceMilliSec;
  }
  if (unit === 'seconds') {
    return differenceMilliSec / 1000;
  }
  if (unit === 'minutes') {
    return differenceMilliSec / (1000 * 60);
  }
  if (unit === 'hours') {
    return differenceMilliSec / (1000 * 60 * 60);
  }
  if (unit === 'days') {
    return differenceMilliSec / (1000 * 60 * 60 * 24);
  }
  if (unit === 'weeks') {
    return differenceMilliSec / (1000 * 60 * 60 * 24 * 7);
  }
  if (unit === 'years') {
    return differenceMilliSec / (1000 * 60 * 60 * 24 * 365);
  }
  return differenceMilliSec;
}

function _clean_timeMapCal(timemap_cal, arrEventNames, startDate, endDate) {
  if (!Array.isArray(arrEventNames)) {
    arrEventNames = [arrEventNames];
  }

  for (var i in arrEventNames) {
    var events = timemap_cal.getEvents(startDate, endDate, { search: arrEventNames[i] });
    for (var j in events) {
      events[j].deleteEvent();
    }
  }
}

/**
 * Syncs calendar events to a desired list: deletes orphans, creates missing, updates in place when only time/title changed.
 * Reduces API churn and avoids "too many events" rate limit.
 * - Create: when a desired event has no matching existing event, calendar.createEvent() is called below.
 * - Update: when an existing event matches but times/title differ, setTime()/setTitle() are used.
 * - Delete: existing events whose key is not in the desired list are deleted.
 * @param {Calendar} calendar - Calendar to sync.
 * @param {string} eventTag - Search tag for existing events (e.g. "[Outside]", "[Drive]", "[SLEEP]").
 * @param {Date} startDate - Range start.
 * @param {Date} endDate - Range end.
 * @param {Array<{title: string, start: Date, end: Date, key: string, free?: boolean}>} desiredEvents - Desired events; each must have key for matching.
 * @param {{ keyFromExisting: (CalendarEvent) => string, keyFromExistingWithList?: (CalendarEvent, CalendarEvent[]) => string, setFree?: (Calendar, CalendarEvent) => void, maxCreates?: number, onEventSynced?: (Calendar, CalendarEvent, Object, boolean) => void }} options - keyFromExisting(ev) returns key; if keyFromExistingWithList(ev, list) is set, it is used instead (so keys can be stable per night for Sleep). onEventSynced is called after create/update with (calendar, event, desired, wasCreated).
 * @returns {{created: number, updated: number, deleted: number, skippedCreates: number}}
 */
function _syncCalendarEvents(calendar, eventTag, startDate, endDate, desiredEvents, options) {
  var keyFromExisting = options.keyFromExisting;
  var keyFromExistingWithList = options.keyFromExistingWithList;
  var setFree = options.setFree;
  var maxCreates = options.maxCreates;
  var onEventSynced = options.onEventSynced;
  var existingList = calendar.getEvents(startDate, endDate, { search: eventTag });
  var existingByKey = {};
  var stats = { created: 0, updated: 0, deleted: 0, skippedCreates: 0 };
  for (var i = 0; i < existingList.length; i++) {
    var ev = existingList[i];
    var k = keyFromExistingWithList ? keyFromExistingWithList(ev, existingList) : keyFromExisting(ev);
    if (k != null && k !== "") existingByKey[k] = ev;
  }
  var desiredByKey = {};
  for (var j = 0; j < desiredEvents.length; j++) {
    var d = desiredEvents[j];
    if (d.key != null && d.key !== "") desiredByKey[d.key] = d;
  }
  var opCount = 0;
  function throttle() {
    opCount++;
    if (opCount % SYNC_THROTTLE_EVERY_N === 0) Utilities.sleep(SYNC_THROTTLE_MS);
  }
  // Delete existing events that are no longer desired. Skip events that have already ended
  // (historical records), e.g. last night's sleep - keep those for the calendar record.
  var nowMs = Date.now();
  for (var key in existingByKey) {
    if (!desiredByKey[key]) {
      var ev = existingByKey[key];
      if (ev.getEndTime().getTime() < nowMs) continue;  // preserve past events
      ev.deleteEvent();
      stats.deleted++;
      throttle();
    }
  }
  // For each desired event: leave alone, update in place, or create.
  // Support both { start, end } (Date) and { startMs, endMs } (number) so Sleep can pass timestamps.
  for (var k = 0; k < desiredEvents.length; k++) {
    var desired = desiredEvents[k];
    var startTime = desired.start instanceof Date ? desired.start : (desired.startMs != null ? new Date(desired.startMs) : null);
    var endTime = desired.end instanceof Date ? desired.end : (desired.endMs != null ? new Date(desired.endMs) : null);
    if (startTime == null || endTime == null || startTime.getTime() >= endTime.getTime()) continue;
    var dKey = desired.key;
    if (dKey == null || dKey === "") continue;
    var existing = existingByKey[dKey];
    if (existing) {
      var sameTime = existing.getStartTime().getTime() === startTime.getTime() && existing.getEndTime().getTime() === endTime.getTime();
      var sameTitle = (existing.getTitle() || "") === (desired.title || "");
      if (sameTime && sameTitle) {
        // Keep availability aligned even when time/title are unchanged.
        if (setFree && desired.free) setFree(calendar, existing);
        continue;
      }
      existing.setTime(startTime, endTime);
      if (desired.title != null) existing.setTitle(desired.title);
      if (setFree && desired.free) setFree(calendar, existing);
      if (onEventSynced) onEventSynced(calendar, existing, desired, false);
      stats.updated++;
      throttle();
    } else {
      if (maxCreates != null && stats.created >= maxCreates) {
        stats.skippedCreates++;
        continue;
      }
      var newEv = calendar.createEvent(desired.title || eventTag, startTime, endTime);
      if (setFree && desired.free) setFree(calendar, newEv);
      if (onEventSynced) onEventSynced(calendar, newEv, desired, true);
      stats.created++;
      throttle();
    }
  }
  return stats;
}

function _Add_TimeMapEvents_from_EventArr(timemapCal, EventsArr, timeMapTitle) {
  for (var i in EventsArr) {
    var start = EventsArr[i].getStartTime();
    var end = EventsArr[i].getEndTime();
    _AddUpdateTimeMapEvent(timemapCal, EventsArr[i].getStartTime(), EventsArr[i].getEndTime(), timeMapTitle);
  }
}

function _BlindAdd_TimeMapEvents_from_EventArr(timemapCal, EventsArr, timeMapTitle) {
  for (var i in EventsArr) {
    _BlindAddTimeMapEvent(timemapCal, EventsArr[i].getStartTime(), EventsArr[i].getEndTime(), timeMapTitle);
    if (i % RATE_LIMIT_EVERY_N_EVENTS === 0) {
      Utilities.sleep(RATE_LIMIT_SLEEP_MS);
    }
  }
}






var URL_FETCH_MAX_RETRIES = 3;
var URL_FETCH_RETRY_DELAY_MS = 2000;

/**
 * Fetches URL with simple retries on failure.
 */
function _fetchWithRetry(url) {
  var lastError;
  for (var attempt = 0; attempt < URL_FETCH_MAX_RETRIES; attempt++) {
    try {
      return UrlFetchApp.fetch(url);
    } catch (e) {
      lastError = e;
      if (attempt < URL_FETCH_MAX_RETRIES - 1) {
        Utilities.sleep(URL_FETCH_RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

/**
 * Returns today's date string (YYYY-MM-DD) in OPENMETEO_CACHE_TIMEZONE for cache key comparison.
 */
function _getTodayDateString() {
  return Utilities.formatDate(new Date(), OPENMETEO_CACHE_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Returns date string for N days ago (YYYY-MM-DD) in OPENMETEO_CACHE_TIMEZONE.
 */
function _getDateStringDaysAgo(daysAgo) {
  var d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return Utilities.formatDate(d, OPENMETEO_CACHE_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Returns true if cacheDateStr (YYYY-MM-DD) is within OPENMETEO_CACHE_MAX_AGE_DAYS.
 */
function _isCacheFresh(cacheDateStr) {
  if (!cacheDateStr) return false;
  var today = _getTodayDateString();
  if (cacheDateStr === today) return true;
  for (var d = 1; d <= OPENMETEO_CACHE_MAX_AGE_DAYS; d++) {
    if (cacheDateStr === _getDateStringDaysAgo(d)) return true;
  }
  return false;
}

/**
 * Saves a long string to Script Properties in chunks (9KB limit per value).
 */
function _setOpenMeteoCache(dateStr, rawJson) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(OPENMETEO_CACHE_DATE_KEY, dateStr);
  var len = rawJson.length;
  var numChunks = Math.ceil(len / OPENMETEO_CACHE_CHUNK_SIZE);
  props.setProperty(OPENMETEO_CACHE_PREFIX + 'N', String(numChunks));
  for (var c = 0; c < numChunks; c++) {
    props.setProperty(OPENMETEO_CACHE_PREFIX + c, rawJson.slice(c * OPENMETEO_CACHE_CHUNK_SIZE, (c + 1) * OPENMETEO_CACHE_CHUNK_SIZE));
  }
}

/**
 * Reads chunked Open-Meteo cache and returns parsed raw API object, or null if missing/invalid.
 */
function _getOpenMeteoCache() {
  var props = PropertiesService.getScriptProperties();
  var dateStr = props.getProperty(OPENMETEO_CACHE_DATE_KEY);
  var numChunksStr = props.getProperty(OPENMETEO_CACHE_PREFIX + 'N');
  if (!dateStr || !numChunksStr) return null;
  var numChunks = parseInt(numChunksStr, 10);
  var parts = [];
  for (var c = 0; c < numChunks; c++) {
    var part = props.getProperty(OPENMETEO_CACHE_PREFIX + c);
    if (!part) return null;
    parts.push(part);
  }
  try {
    return JSON.parse(parts.join(''));
  } catch (e) {
    return null;
  }
}

/**
 * Converts raw Open-Meteo API response (data) into the processed newData array used by callers.
 */
function _processWeatherRawToNewData(data) {
  var newData = [];
  for (var i in data.hourly.time) {
    var timeData = {};
    for (var j in data.hourly) {
      if (j === "time") {
        timeData[j] = new Date(_getDateFromIso(data.hourly[j][i]));
      } else {
        timeData[j] = data.hourly[j][i];
      }
    }
    timeData['NiceWeather'] = _isNiceWeather(timeData);
    newData.push(timeData);
  }
  return newData;
}

/**
 * Fetches Open-Meteo API URL; on 429 retries once after OPENMETEO_429_RETRY_DELAY_MS.
 * @returns {{code: number, json: string}}
 */
function _fetchOpenMeteoWithRetry(apiUrl) {
  var options = { muteHttpExceptions: true };
  var response;
  try {
    response = UrlFetchApp.fetch(apiUrl, options);
  } catch (e) {
    console.error('get_WeatherData fetch error: ' + e.message);
    return { code: -1, json: e.message };
  }
  var code = response.getResponseCode();
  var json = response.getContentText();
  if (code === 429) {
    console.warn('Open-Meteo 429 received. Retrying once after ' + (OPENMETEO_429_RETRY_DELAY_MS / 1000) + 's.');
    Utilities.sleep(OPENMETEO_429_RETRY_DELAY_MS);
    try {
      response = UrlFetchApp.fetch(apiUrl, options);
    } catch (e2) {
      return { code: 429, json: json };
    }
    code = response.getResponseCode();
    json = response.getContentText();
  }
  return { code: code, json: json };
}

/**
 * Fetches hourly weather from Open-Meteo and returns array of { time, ...hourly, NiceWeather }.
 * Uses Script Properties cache: API called at most once per OPENMETEO_CACHE_MAX_AGE_DAYS (default 2).
 * On 429 (shared-IP limit exceeded) uses last cached response; retries once after delay if no cache.
 * Source: https://open-meteo.com/en/docs
 * Limits: 10k/day, 5k/hour, 600/min per IP; GAS shares IPs with other scripts.
 */
function get_WeatherData() {
  var apiUrl = "https://api.open-meteo.com/v1/forecast?latitude=" + LOCATION_LAT + "&longitude=" + LOCATION_LONG + "&hourly=temperature_2m,relativehumidity_2m,precipitation_probability,windspeed_10m,uv_index,is_day&timezone=Australia%2FSydney&forecast_days=10";
  var today = _getTodayDateString();
  var props = PropertiesService.getScriptProperties();
  var lastFetchDate = props.getProperty(OPENMETEO_CACHE_DATE_KEY);

  // Use cache when fresh (within OPENMETEO_CACHE_MAX_AGE_DAYS) to avoid API calls.
  if (_isCacheFresh(lastFetchDate)) {
    var cached = _getOpenMeteoCache();
    if (cached) {
      return _processWeatherRawToNewData(cached);
    }
  }

  var result = _fetchOpenMeteoWithRetry(apiUrl);
  var code = result.code;
  var json = result.json;

  if (code === 429) {
    console.warn('Open-Meteo daily API limit exceeded (429). Using last cached forecast if available.');
    var fallback429 = _getOpenMeteoCache();
    if (fallback429) {
      return _processWeatherRawToNewData(fallback429);
    }
    throw new Error('Open-Meteo daily API limit exceeded and no cached forecast available. Try again tomorrow or reduce run frequency.');
  }

  if (code === -1 || code !== 200) {
    console.error('get_WeatherData failed: ' + (code === -1 ? 'fetch error: ' + json : 'HTTP ' + code + ' ' + json));
    var fallback = _getOpenMeteoCache();
    if (fallback) {
      console.warn('Using last cached Open-Meteo data.');
      return _processWeatherRawToNewData(fallback);
    }
    throw new Error('Open-Meteo request failed' + (code === -1 ? ': ' + json : ' with HTTP ' + code));
  }

  var data;
  try {
    data = JSON.parse(json);
  } catch (e) {
    console.error('get_WeatherData JSON parse failed: ' + e.message);
    var fallback = _getOpenMeteoCache();
    if (fallback) {
      return _processWeatherRawToNewData(fallback);
    }
    throw e;
  }

  // Success: persist for today so we don't call again this calendar day.
  _setOpenMeteoCache(today, json);
  return _processWeatherRawToNewData(data);
}

function _Update_NonWorkTimemap(timemap_cal, startDate, endDate) {
  return _Update_InvertedTimemap(timemap_cal, startDate, endDate, '[Work_Office]', '[Not@work]', WORK_NONWORK_BUFFER_MINUTES);
}


async function _Update_InvertedTimemap(timemap_cal, startDate, endDate, OrigTimemap, InvertedTimemap, buffer) {
  if (buffer === undefined) {
    buffer = 0;
  }
  var Main_events = timemap_cal.getEvents(startDate, endDate, { search: OrigTimemap });
  var desiredInside = [];
  var i = 0;
  do {
    var start, end;
    if (Main_events.length === 0) {
      start = new Date(startDate.getTime());
      end = new Date(endDate.getTime());
    } else if (i === 0) {
      start = new Date(startDate.getTime());
      end = new Date(Main_events[i].getStartTime().getTime() - buffer * 60 * 1000);
    } else if (i < Main_events.length) {
      start = new Date(Main_events[i - 1].getEndTime().getTime() + buffer * 60 * 1000);
      end = new Date(Main_events[i].getStartTime().getTime() - buffer * 60 * 1000);
    } else if (i === Main_events.length) {
      start = new Date(Main_events[Main_events.length - 1].getEndTime().getTime() + buffer * 60 * 1000);
      end = new Date(endDate.getTime());
    }
    if (start != null && end != null && SPLIT_TIMEMAPS_BY_DAYS) {
      var duration = (start.getDate() === end.getDate() && start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear())
        ? 0
        : Math.ceil((end.getTime() - start.getTime()) / 1000 / 60 / 60 / 24);
      if (duration === 0) {
        if (start.valueOf() < end.valueOf()) desiredInside.push({ title: InvertedTimemap, start: start, end: end, key: String(start.getTime()) });
      } else {
        for (var z = 0; z <= duration; z++) {
          var s, e;
          if (z === 0) {
            s = new Date(start.getTime());
            e = new Date(start.getTime());
            e.setHours(23, 59, 59);
          } else if (z === duration) {
            e = new Date(end.getTime());
            s = new Date(end.getTime());
            s.setHours(0, 0, 0);
          } else {
            s = new Date(start.getTime() + z * 1000 * 60 * 60 * 24);
            e = new Date(start.getTime() + z * 1000 * 60 * 60 * 24);
            s.setHours(0, 0, 0);
            e.setHours(23, 59, 59);
          }
          if (s.valueOf() < e.valueOf()) desiredInside.push({ title: InvertedTimemap, start: s, end: e, key: String(s.getTime()) });
        }
      }
    } else if (start != null && end != null) {
      if (start.valueOf() < end.valueOf()) desiredInside.push({ title: InvertedTimemap, start: start, end: end, key: String(start.getTime()) });
    }
    i++;
  } while (i <= Main_events.length);

  _syncCalendarEvents(timemap_cal, InvertedTimemap, startDate, endDate, desiredInside, {
    keyFromExisting: function (ev) { return String(ev.getStartTime().getTime()); }
  });
}

function _BlindAddTimeMapEvent(timemap_cal, start, end, eventName) {
  if (start.valueOf() < end.valueOf()) {
    timemap_cal.createEvent(eventName, start, end);
  }
  return;
}

function _AddUpdateTimeMapEvent(timemap_cal, start, end, eventName) {
  if (start.valueOf() < end.valueOf()) {
    var existing_events = timemap_cal.getEvents(start, end, { search: eventName });
    if (existing_events.length === 1) {
      var ex = existing_events[0];
      var sameStart = ex.getStartTime().getTime() === start.getTime();
      var sameEnd = ex.getEndTime().getTime() === end.getTime();
      if (sameStart && sameEnd) return;
      ex.setTime(start, end);
    } else if (existing_events.length > 1) {
      for (var j in existing_events) {
        existing_events[j].deleteEvent();
      }
      timemap_cal.createEvent(eventName, start, end);
    } else {
      timemap_cal.createEvent(eventName, start, end);
    }
  }
  return;
}

function _add_daylightEvent(cal, date) {
  var data = get_SunRiseSet(LOCATION_LAT, LOCATION_LONG, date);
  var sunrise = data.results.sunrise;
  var sunset = data.results.sunset;
  var start = new Date(date);
  start.setHours(00, 00, 00);
  var end = new Date(date);
  end.setHours(23, 59, 59);
  var events = cal.getEvents(start, end, { search: '[Daylight]' });
  //if event exists on this day- check/update times
  //if no event create event
  if (events.length == 0) {
    cal.createEvent("[Daylight]", sunrise, sunset);
  }
  return 0;

}


/**
 * Returns sunrise/sunset for a date at the given lat/lng.
 */
function get_SunRiseSet(lat, lng, date) {
  var url = "https://api.sunrise-sunset.org/json?lat=" + lat + "&lng=" + lng + "&date=" + Utilities.formatDate(date, 'Australia/Melbourne', 'YYYY-MM-dd') + "&formatted=0";
  try {
    var response = _fetchWithRetry(url);
    var json = response.getContentText();
    var data = JSON.parse(json);
  } catch (e) {
    console.error('get_SunRiseSet failed: ' + e.message);
    throw e;
  }
  for (var i in data.results) {
    if (i !== "day_length") {
      data.results[i] = new Date(data.results[i]);
    }
  }
  return data;
}

//var dt = new Date(_getDateFromIso("2012-08-03T23:00:26-05:00"));

// http://delete.me.uk/2005/03/iso8601.html
function _getDateFromIso(string) {
  try {
    var aDate = new Date();
    var regexp = "([0-9]{4})(-([0-9]{2})(-([0-9]{2})" +
      "(T([0-9]{2}):([0-9]{2})(:([0-9]{2})(\\.([0-9]+))?)?" +
      "(Z|(([-+])([0-9]{2}):([0-9]{2})))?)?)?)?";
    var d = string.match(new RegExp(regexp));

    var offset = 0;
    var date = new Date(d[1], 0, 1);

    if (d[3]) { date.setMonth(d[3] - 1); }
    if (d[5]) { date.setDate(d[5]); }
    if (d[7]) { date.setHours(d[7]); }
    if (d[8]) { date.setMinutes(d[8]); }
    if (d[10]) { date.setSeconds(d[10]); }
    if (d[12]) { date.setMilliseconds(Number("0." + d[12]) * 1000); }
    if (d[14]) {
      offset = (Number(d[16]) * 60) + Number(d[17]);
      offset *= ((d[15] == '-') ? 1 : -1);
    }

    offset -= date.getTimezoneOffset();
    var time = (Number(date) /*+ (offset * 60 * 1000)*/);
    return aDate.setTime(Number(time));
  } catch (e) {
    return;
  }
}