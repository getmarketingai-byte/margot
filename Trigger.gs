/**
 * Trigger entry points and trigger-management helpers.
 * Keeping these functions in one file makes Apps Script trigger setup easier.
 */

/**
 * Master TimeMap: updates Travel drive events, Sleep blocks, then TimeMap/Gym blocks.
 */
async function update_Master_TimeMap() {
  updateTravelDriveEvents(0, SCHEDULING_WINDOW, { maxRuntimeMs: MAX_RUNTIME_COMBINED_PHASE_MS });
  await addEvents_Sleep(0, SCHEDULING_WINDOW, { useQuotaBudget: true, maxRuntimeMs: MAX_RUNTIME_COMBINED_PHASE_MS });
  addEvents_TimeMapBlocks(0, SCHEDULING_WINDOW, { maxRuntimeMs: MAX_RUNTIME_COMBINED_PHASE_MS });
}

/** Runs only Travel drive events update (quota-aware in Travel.gs). */
function update_Master_TimeMap_Travel() {
  updateTravelDriveEvents(0, SCHEDULING_WINDOW, { maxRuntimeMs: MAX_RUNTIME_PER_RUN_MS });
}

/** Runs only Sleep block updates with calendar-create quota budgeting. */
async function update_Master_TimeMap_Sleep() {
  await addEvents_Sleep(0, SCHEDULING_WINDOW, { useQuotaBudget: true, maxRuntimeMs: MAX_RUNTIME_PER_RUN_MS });
}

/**
 * Runs Travel drive events for one chunk of the scheduling window. Use to stay under execution time limit:
 * e.g. trigger update_Master_TimeMap_Travel_Chunk(0) and update_Master_TimeMap_Travel_Chunk(1) 5 min apart.
 * @param {number} chunkIndex - 0 = first TRAVEL_DAYS_PER_CHUNK days, 1 = next TRAVEL_DAYS_PER_CHUNK, etc.
 */
function update_Master_TimeMap_Travel_Chunk(chunkIndex) {
  var offset = (chunkIndex || 0) * TRAVEL_DAYS_PER_CHUNK;
  var count = Math.min(TRAVEL_DAYS_PER_CHUNK, SCHEDULING_WINDOW - offset);
  if (count <= 0) return;
  updateTravelDriveEvents(offset, count, { maxRuntimeMs: MAX_RUNTIME_PER_RUN_MS });
}

/**
 * Runs Sleep updates for one chunk of the scheduling window. Use only if single-run Sleep approaches execution limit:
 * e.g. trigger update_Master_TimeMap_Sleep_Chunk(0) and update_Master_TimeMap_Sleep_Chunk(1) 5-10 min apart.
 * @param {number} chunkIndex - 0 = first SLEEP_DAYS_PER_CHUNK days, 1 = next SLEEP_DAYS_PER_CHUNK, etc.
 */
async function update_Master_TimeMap_Sleep_Chunk(chunkIndex) {
  var offset = (chunkIndex || 0) * SLEEP_DAYS_PER_CHUNK;
  var count = Math.min(SLEEP_DAYS_PER_CHUNK, SCHEDULING_WINDOW - offset);
  if (count <= 0) return;
  await addEvents_Sleep(offset, count, { useQuotaBudget: true, maxRuntimeMs: MAX_RUNTIME_PER_RUN_MS });
}

/**
 * Runs TimeMap/Gym updates for one chunk of the scheduling window to avoid execution timeout:
 * e.g. trigger update_Master_TimeMap_TimeMapBlocks_Chunk(0) and update_Master_TimeMap_TimeMapBlocks_Chunk(1) 5-10 min apart.
 * @param {number} chunkIndex - 0 = first TIMEMAP_DAYS_PER_CHUNK days, 1 = next TIMEMAP_DAYS_PER_CHUNK, etc.
 */
function update_Master_TimeMap_TimeMapBlocks_Chunk(chunkIndex) {
  var offset = (chunkIndex || 0) * TIMEMAP_DAYS_PER_CHUNK;
  var count = Math.min(TIMEMAP_DAYS_PER_CHUNK, SCHEDULING_WINDOW - offset);
  if (count <= 0) return;
  addEvents_TimeMapBlocks(offset, count, { maxRuntimeMs: MAX_RUNTIME_PER_RUN_MS });
}

/**
 * Optional helper to move from single combined trigger to split Travel/Sleep triggers.
 * Run once from Apps Script editor to recreate triggers with current cadence values.
 */
function setup_MasterTimeMap_SplitTriggers() {
  var handlersToReplace = {
    update_Master_TimeMap: true,
    update_Master_TimeMap_Travel: true,
    update_Master_TimeMap_Sleep: true,
    update_Master_TimeMap_TimeMapBlocks: true,
    update_Master_TimeMap_Travel_Chunk: true,
    update_Master_TimeMap_Sleep_Chunk: true,
    update_Master_TimeMap_TimeMapBlocks_Chunk: true
  };
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (handlersToReplace[fn]) ScriptApp.deleteTrigger(triggers[i]);
  }
  // Apps Script does not expose exact minute offsets for everyHours triggers; creation time sets natural staggering.
  ScriptApp.newTrigger("update_Master_TimeMap_Travel").timeBased().everyHours(2).create();
  ScriptApp.newTrigger("update_Master_TimeMap_Sleep").timeBased().everyHours(2).create();
  ScriptApp.newTrigger("update_Master_TimeMap_TimeMapBlocks").timeBased().everyHours(2).create();
}

/** Manual runner: updates work overlays and pay-cycle summary events. */
function updateWorkEventTask() {
  updateWorkEvents();
  addEvents_WorkingHoursTotals();
}

/** Manual runner: wipe both managed calendars. */
async function wipeAllCalendars() {
  wipeWorkCalendar();
  wipeTimeMapCalendar();
}

/** Manual runner: wipe future events on work calendar. */
async function wipeWorkCalendar() {
  _wipeCalendar(WORK_CALENDAR_ID);
}

/** Manual runner: wipe future events on timemap calendar. */
async function wipeTimeMapCalendar() {
  _wipeCalendar(TIMEMAP_CALENDAR_ID);
}

/** Manual runner: clear common generated timemap tags across the scheduling window. */
function clean_used_timeMapCal() {
  var now = new Date();
  var endDate = new Date();
  endDate.setDate(now.getDate() + SCHEDULING_WINDOW);
  var timemap_calendar = CalendarApp.getCalendarById(TIMEMAP_CALENDAR_ID);
  var arr = ['[Outside]', '[Inside]', '[NiceWeather]', '[Daylight]', '[Not@work]', '[SLEEP]', TIMEMAP_1_TITLE, TIMEMAP_2_TITLE, TIMEMAP_3_TITLE, TIMEMAP_4_TITLE, TIMEMAP_ERRANDS_TITLE, TIMEMAP_SCOUTHALL_TITLE];
  return _clean_timeMapCal(timemap_calendar, arr, now, endDate);
}

/**
 * Manual utility: fetches flight data from Aviation Stack API.
 * Set script property AVIATION_STACK_API_KEY in File > Project properties > Script properties.
 */
function getFlightData() {
  var props = PropertiesService.getScriptProperties();
  var flightAPIkey = props.getProperty('AVIATION_STACK_API_KEY');
  if (!flightAPIkey) {
    console.warn('AVIATION_STACK_API_KEY not set in Script properties. Skipping getFlightData.');
    return null;
  }
  var url = 'https://api.aviationstack.com/v1/flights?access_key=' + flightAPIkey;
  try {
    var response = UrlFetchApp.fetch(url);
    var json = response.getContentText();
    var data = JSON.parse(json);
    console.log(data);
    return data;
  } catch (e) {
    console.error('getFlightData failed: ' + e.message);
    return null;
  }
}

/** Manual runner: wipe all future events on the Sleep calendar (no tag filter). */
function wipeSleepCalendar() {
  _wipeCalendarFutureEvents(SLEEP_CALENDAR_ID);
}

/** Manual runner: wipe all future events on the Travel calendar (no tag filter). */
function wipeTravelCalendar() {
  _wipeCalendarFutureEvents(TRAVEL_CALENDAR_ID);
}

/**
 * Manual diagnostic: log gym-like events for tuning matching rules.
 * View output in Executions > run > Logs.
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
