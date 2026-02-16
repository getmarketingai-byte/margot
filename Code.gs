/**
 * Google Apps Script: Calendar automations (timemaps, work, sleep, pay period).
 * Enable Calendar Advanced Service: Resources > Advanced Google services > Calendar API.
 * For getFlightData(): set script property AVIATION_STACK_API_KEY in Project properties.
 */
const TIMEMAP_CALENDAR_ID = "1a1a44068207e09221d980c6c0ee587bc86587f680f862e56ba0bf6a8e47e020@group.calendar.google.com";
const WORK_CALENDAR_ID = "070pmqum2gcm69ekmog6fvkmtk@group.calendar.google.com";
const SLEEP_CALENDAR_ID = "496baca0d033db4062ef3acd672aa7ba22cc505bad94b3920b2bd2358c25d610@group.calendar.google.com";
const SCHEDULING_WINDOW = 60; // days
const ASSUME_NICEWEATHER_BEYOND_FORCAST = false;
const WORK_OFFICE_IS_INSIDE = false; // add inside map to office time
const BEYOND_FORCAST_IS_INSIDE = true; // add inside event for days beyond forecast (both inside and outside tasks)
const SPLIT_TIMEMAPS_BY_DAYS = true;

// Rate limiting and buffer constants
const RATE_LIMIT_SLEEP_MS = 3000;
const RATE_LIMIT_EVERY_N_EVENTS = 3;
const SUMMARY_EVENT_DURATION_MINUTES = 5;
const WORK_NONWORK_BUFFER_MINUTES = 60;

// Pay Period variables
const REFERENCE_PAY_PERIOD_START = new Date('2023-11-16T00:00:00');
const MIN_WORK_HOURS_ENABLE = false;
const MIN_WORKING_MINUTES_PER_FORTNIGHT = 1 * 60;
const WORK_REMAINING_HOUR_EVENT_STATUS_FREE = true; // true = free, false = busy
const HOURLY_RATE = 50;
const PAY_PERIOD = 14; // days

// Sleep variables
const SLEEP_DURATION = 7.5; //hours  
const SLEEP_BEGIN = 20;
const SLEEP_END = 12;
const SLEEP_IDEAL_WAKE_UP_HRS = 6;
const SLEEP_IDEAL_WAKE_UP_MIN = 00

//melbounre
//const LOCATION_LAT = -37.840935
//const LOCATION_LONG = 144.946457

//Ashwood - home
const LOCATION_LAT = -37.910156
const LOCATION_LONG = 145.107420

async function Update_InsideTimemap() //rolls daylight and nice weather into one timemap.
{
  var timemap_cal = CalendarApp.getCalendarById(TIMEMAP_CALENDAR_ID);
    var startDate = new Date();
  startDate.setHours(0, 0, 0);

  var endDate = new Date();
  endDate.setHours(23, 59, 0);
  endDate.setDate(startDate.getDate() + SCHEDULING_WINDOW);

  Update_InvertedTimemap(timemap_cal, startDate, endDate, "[Outside]", "[Inside]");
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
  if (ASSUME_NICEWEATHER_BEYOND_FORCAST) {
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
  await clean_timeMapCal(timemap_cal, '[Outside]', startDate, endDate);
  //var niceWeather_events  =  timemap_cal.getEvents(startDate, endDate, {search: '[Outside]'});
  for (var k in tempEventList) {
    await AddUpdateTimeMapEvent(timemap_cal, tempEventList[k].niceweather_start, tempEventList[k].niceweather_stop, "[Outside]");

  }
  Update_InvertedTimemap(timemap_cal, startDate, endDate, "[Outside]", "[Inside]");
  if (WORK_OFFICE_IS_INSIDE) {
    await BlindAdd_TimeMapEvents_from_EventArr(timemap_cal, timemap_cal.getEvents(startDate, endDate, { search: "[Work_Office]" }), "[Inside]");
  }
  if (BEYOND_FORCAST_IS_INSIDE) {
    if (ASSUME_NICEWEATHER_BEYOND_FORCAST) {
    
      var j = 0;
      var notFound = true;
      while (notFound) {
        if (tempEventList[j].source == "SUN") {
          notFound = false;
          var sDate = tempEventList[j - 1].niceweather_stop;
        }
        j++;
      }
      console.log(endDate.getDate());
      await BlindAdd_TimeMapEvents_from_EventArr(timemap_cal, timemap_cal.getEvents(sDate, endDate, { search: "[Outside]" }), "[Inside]");
    }
  }
  return 0;
}

function update_Master_TimeMap()
{
  //calculate_travel_time();
  addEvents_Sleep();
}


function updateWorkEventTask() {

  updateWorkEvents();
  addEvents_WorkingHoursTotals();
  
  return;
}

async function wipeAllCalendars() {
  wipeWorkCalendar();
  wipeTimeMapCalendar();
}

async function wipeWorkCalendar() {
  wipeCalendar(WORK_CALENDAR_ID);
}

async function wipeTimeMapCalendar() {
  wipeCalendar(TIMEMAP_CALENDAR_ID);
}

async function wipeCalendar(CALENDAR_ID) {
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




function isNiceWeather(weatherData) {

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

function addDays(date, days) {
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
  await clean_timeMapCal(timemap_cal, '[Work_Office]', now, endDate);

  const events = await work_cal.getEvents(now, endDate);

  for (let i in events) {
    if (!(events[i].isAllDayEvent()) && !events[i].getTitle().includes('[MIN')) { await timemap_cal.createEvent("[Work_Office]", events[i].getStartTime(), events[i].getEndTime()); }
  }
  //Update_NonWorkTimemap(timemap_cal, now, endDate);

}

//------------------------------------------------------WORK IN PROGRESS-----------------------------------
/**
 * Adds [SLEEP] blocks to the sleep calendar for the scheduling window.
 * Optionally pass calsToInclude to override default calendar names (not yet used).
 */
async function addEvents_Sleep() {
  var calsToInclude = ["mlewis89@gmail.com", "Lewis, Mark Calendar (Canvas)", "Work", "skittles@waverleyvalleyscouts.org.au", "Mark Lewis's Facebook events", "skittles - onlinemeetings"];

  var sleep_cal = CalendarApp.getCalendarById(SLEEP_CALENDAR_ID);
  var now = new Date();
  var endDate = new Date();
  endDate.setHours(23, 59, 0);
  endDate.setDate(now.getDate() + SCHEDULING_WINDOW);
  await clean_timeMapCal(sleep_cal, '[SLEEP]', now, endDate);

  var calendars = [];
  for (var i in calsToInclude) {
    var byName = CalendarApp.getCalendarsByName(calsToInclude[i]);
    for (var j in byName) {
      calendars.push(byName[j]);
    }
  }

  var startTime = new Date();
  var endTime = new Date();
  endTime.setHours(23, 59, 0);
  endTime.setDate(startTime.getDate() + SCHEDULING_WINDOW);
  var events = [];

  for (var i in calendars) {
    var calEvents = calendars[i].getEvents(startTime, endTime);
    events = events.concat(calEvents);
  }

  //sort events array  by start time
  events.sort((a, b) => {
    return a.getStartTime() - b.getStartTime();
  });
  var sleepEvents = [];

  for (var i = 0; i <= SCHEDULING_WINDOW; i++) {
    var sEvent = {};
    if (0) // late night
    {
      sEvent.start = eventEndTime;
      sEvent.end = sEvent.start + SLEEP_DURATION;
    } else if (0) //early morning start
    {
      //sEvent.end =  eventStartTime;
      //sEvent.start = sEvent.end - SLEEP_DURATION;  
    }
    else {
      var end = new Date();
      end.setDate(end.getDate() + parseInt(i));
      end.setHours(SLEEP_IDEAL_WAKE_UP_HRS, SLEEP_IDEAL_WAKE_UP_MIN, 0);
      sEvent.end = end;

      var start = new Date(end.getTime() - (SLEEP_DURATION * 60 * 60 * 1000));
      sEvent.start = start;


    }
    sleep_cal.createEvent("[SLEEP]", sEvent.start, sEvent.end);
    if (i % RATE_LIMIT_EVERY_N_EVENTS === 0) {
      Utilities.sleep(RATE_LIMIT_SLEEP_MS);
    }
    sleepEvents.push(sEvent);
  }

  // TODO: use events to avoid placing sleep over existing commitments (late night / early morning logic)
  //get events
  //var SLEEP_DURATION = 8; //hours  
  //var SLEEP_BEGIN = 20;
  //var SLEEP_END = 9;
  //var PREFERED_WAKE_UP = 7;

  //loop while in scheduling window

  //if sleep period is free of events
  //add event ending at preferred wake up
  //else
  //get start and end of sleep block
  //determine best time block
  //create sleep event
}

function getCurrentPayPeriodDates(d) {
  if (typeof d === 'undefined') {
    var d = new Date();
  }


  // calculate start of pay period
  var start_of_current_PayPeriod = new Date(REFERENCE_PAY_PERIOD_START);
  var payStart = Math.floor(((d - REFERENCE_PAY_PERIOD_START) / 1000 / 60 / 60 / 24) / PAY_PERIOD); // how many pay periods between reference and now
  start_of_current_PayPeriod = addDays(start_of_current_PayPeriod, PAY_PERIOD * payStart);
  start_of_current_PayPeriod.setHours(0, 0, 0);

  // calulate end of pay period
  var end_of_current_PayPeriod = new Date(start_of_current_PayPeriod);
  end_of_current_PayPeriod = addDays(end_of_current_PayPeriod, PAY_PERIOD - 1);
  end_of_current_PayPeriod.setHours(23, 59, 0);

  return { payPeriodStart: start_of_current_PayPeriod, payPeriodEnd: end_of_current_PayPeriod };
}

async function addEvents_WorkingHoursTotals() {
  //get dates for current fortnight
  var d = new Date();
  do {
    var payDates = getCurrentPayPeriodDates(d);
    var start_of_current_FN = payDates.payPeriodStart;
    var end_of_current_FN = payDates.payPeriodEnd;

    //get array of work events within fortnight
    var work_cal = await CalendarApp.getCalendarById(WORK_CALENDAR_ID);
    await clean_timeMapCal(work_cal, ['[MIN HOURS ACHIEVED]', '[MIN HOURS NOT MET]', '[MIN HOURS]', "[TOTAL HOURS]", "[END OF PAY CYCLE]"], start_of_current_FN, end_of_current_FN);
    var workevents = work_cal.getEvents(start_of_current_FN, end_of_current_FN);

    //get total hours in current fortnight
    var totalDuration = 0;
    var durationArr = [];
    for (var i in workevents) {
      var duration = Math.ceil((workevents[i].getEndTime() - workevents[i].getStartTime()) / 1000 / 60);
      durationArr.push(duration)
      totalDuration += duration;
    }
    await createEventAndSetAvailabilityToFREE({ calendar: work_cal, title: "[END OF PAY CYCLE] hrs:" + Math.ceil(totalDuration / 60) + " ~$" + (totalDuration / 60 * HOURLY_RATE), startTime: new Date(end_of_current_FN.getTime() - 1000 * 60 * SUMMARY_EVENT_DURATION_MINUTES), endTime: end_of_current_FN });


    if (MIN_WORK_HOURS_ENABLE) {
      // if total is greater than threshold - add event hrs achieved
      if (totalDuration >= MIN_WORKING_MINUTES_PER_FORTNIGHT) {
        var overflow = totalDuration - MIN_WORKING_MINUTES_PER_FORTNIGHT;
        var j = durationArr.length - 1;
        // find event where hours go over threshold
        do {
          overflow = overflow - durationArr[j];
          j--;
        } while (overflow > 0);
        var startTime = new Date(workevents[j + 1].getStartTime().getTime() + Math.abs(overflow) * 60 * 1000);
        var endTime = new Date(startTime.getTime() + 1000 * 60 * SUMMARY_EVENT_DURATION_MINUTES);
        await work_cal.createEvent("[MIN HOURS ACHIEVED] " + Math.ceil(MIN_WORKING_MINUTES_PER_FORTNIGHT / 60) + "Hours worked!", startTime, endTime);

      }
      //else add events for hours remaining
      else {
        //var startTime = new Date (workevents[workevents.length-1].getEndTime().getTime());
        //var endTime = new Date(startTime.getTime() + 1000*60*5); //duration 5 minutes

        var Remaining_minutes = (MIN_WORKING_MINUTES_PER_FORTNIGHT - totalDuration);
        var Remaining_hours = Math.ceil(Remaining_minutes / 60);
        var RemainingDays = Math.ceil(Remaining_minutes / 60 / 8);


        for (var i = 0; i < RemainingDays; i++) {
          // set end time (i.e. need to add event on this day)
          if (i == 0) {
            var endTime = new Date(end_of_current_FN.getTime());
          }
          else {
            var endTime = new Date(endTime.getTime() - ((1000 * 60 * 60 * 24)));
          }
          if (endTime.getDay() == 0) //if sunday skip to friday
          {
            endTime.setTime(endTime.getTime() - 2 * 24 * 60 * 60 * 1000);
          } else if (endTime.getDay() == 6) {
            endTime.setTime(endTime.getTime() - 24 * 60 * 60 * 1000);
          }
          endTime.setHours(17);
          endTime.setMinutes(0);
          endTime.setSeconds(0);

          let next_Remaining_minutes = 0;
          if (Remaining_minutes / 60 > 8) {
            var startTime = new Date(endTime.getTime() - 8 * 60 * 60 * 1000);
            next_Remaining_minutes = Remaining_minutes - 8 * 60;
          }
          else {
            var startTime = new Date(endTime.getTime() - Remaining_minutes * 60 * 1000);
            next_Remaining_minutes = 0;
          }
          /*let newEvent = await work_cal.createEvent("[MIN HOURS NOT MET] "+Remaining_minutes/60 + "hr Remaining", startTime, endTime);
          if(WORK_REMAINING_HOUR_EVENT_STATUS_FREE)
          {
            //use Avanced callenderAPI to set event to 'free'
            var eventId= newEvent.getId().slice(0,newEvent.getId().length-11);

          await Calendar.Events.patch({transparency: "transparent"},WORK_CALENDAR_ID,eventId); */

          if (WORK_REMAINING_HOUR_EVENT_STATUS_FREE) {
            await createEventAndSetAvailabilityToFREE({ calendar: work_cal, title: "[MIN HOURS NOT MET] " + Remaining_minutes / 60 + "hr Remaining", startTime: startTime, endTime: endTime });
          }

          Remaining_minutes = next_Remaining_minutes;

        }/*else
          {
            var startTime = new Date (workevents[workevents.length-1].getEndTime().getTime());
            var endTime = new Date(startTime.getTime() + 1000*60*5); //duration 5 minutes
            
          }*/

      }

      if (workevents.length > 0) {
        var startTime = new Date(workevents[workevents.length - 1].getEndTime().getTime());
      } else {
        var startTime = new Date(end_of_current_FN.getTime());

      }
      var endTime = new Date(startTime.getTime() + 1000 * 60 * SUMMARY_EVENT_DURATION_MINUTES);
    }
    d = Date_add_days(d, 15);
  } while (dateDifference(d, Date_add_days(new Date(), SCHEDULING_WINDOW), 'days') > 0)
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

function Date_add_days(date, numDays) {
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
function dateDifference(firstDate, secondDate, unit) {
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

function clean_used_timeMapCal() {
  var now = new Date();
  var endDate = new Date();
  endDate.setDate(now.getDate() + SCHEDULING_WINDOW);
  var timemap_calendar = CalendarApp.getCalendarById(TIMEMAP_CALENDAR_ID);
  var arr = ['[Outside]', '[Inside]', '[NiceWeather]', '[Daylight]', '[Not@work]', '[SLEEP]'];
  return clean_timeMapCal(timemap_calendar, arr, now, endDate);

}

function clean_timeMapCal(timemap_cal, arrEventNames, startDate, endDate) {
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

function Add_TimeMapEvents_from_EventArr(timemapCal, EventsArr, timeMapTitle) {
  for (var i in EventsArr) {
    var start = EventsArr[i].getStartTime();
    var end = EventsArr[i].getEndTime();
    AddUpdateTimeMapEvent(timemapCal, EventsArr[i].getStartTime(), EventsArr[i].getEndTime(), timeMapTitle);
  }
}

function BlindAdd_TimeMapEvents_from_EventArr(timemapCal, EventsArr, timeMapTitle) {
  for (var i in EventsArr) {
    BlindAddTimeMapEvent(timemapCal, EventsArr[i].getStartTime(), EventsArr[i].getEndTime(), timeMapTitle);
    if (i % RATE_LIMIT_EVERY_N_EVENTS === 0) {
      Utilities.sleep(RATE_LIMIT_SLEEP_MS);
    }
  }
}






/**
 * Fetches flight data from Aviation Stack API.
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


var URL_FETCH_MAX_RETRIES = 3;
var URL_FETCH_RETRY_DELAY_MS = 2000;

/**
 * Fetches URL with simple retries on failure.
 */
function fetchWithRetry(url) {
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
 * Fetches hourly weather from Open-Meteo and returns array of { time, ...hourly, NiceWeather }.
 * Source: https://open-meteo.com/en/docs
 */
async function get_WeatherData() {
  var apiUrl = "https://api.open-meteo.com/v1/forecast?latitude=" + LOCATION_LAT + "&longitude=" + LOCATION_LONG + "&hourly=temperature_2m,relativehumidity_2m,precipitation_probability,windspeed_10m,uv_index,is_day&timezone=Australia%2FSydney&forecast_days=10";
  try {
    var response = fetchWithRetry(apiUrl);
    var json = response.getContentText();
    var data = JSON.parse(json);
  } catch (e) {
    console.error('get_WeatherData failed: ' + e.message);
    throw e;
  }

  var newData = [];
  for (var i in data.hourly.time) {
    var timeData = {};
    for (var j in data.hourly) {
      if (j === "time") {
        timeData[j] = new Date(getDateFromIso(data.hourly[j][i]));
      } else {
        timeData[j] = data.hourly[j][i];
      }
    }
    timeData['NiceWeather'] = isNiceWeather(timeData);
    newData.push(timeData);
  }
  return newData;
}

function Update_NonWorkTimemap(timemap_cal, startDate, endDate) {
  return Update_InvertedTimemap(timemap_cal, startDate, endDate, '[Work_Office]', '[Not@work]', WORK_NONWORK_BUFFER_MINUTES);
}


async function Update_InvertedTimemap(timemap_cal, startDate, endDate, OrigTimemap, InvertedTimemap, buffer) {
  if (buffer === undefined) {
    var buffer = 0;
  }

  await clean_timeMapCal(timemap_cal, InvertedTimemap, startDate, endDate);
  var Main_events = await timemap_cal.getEvents(startDate, endDate, { search: OrigTimemap });



  //var Inverted_events  =  timemap_cal.getEvents(startDate, endDate, {search: InvertedTimemap});
  //for (var i in Main_events)
  var i = 0;
  do {


    if (Main_events.length == 0) {
      var start = startDate;
      var end = endDate;
    }
    else if (i == 0) {
      var start = startDate;
      //var end = Main_events[i].getStartTime();
      var end = new Date(Main_events[i].getStartTime().getTime() - buffer * 60 * 1000);
    }
    else if (i < Main_events.length - 1) {
      //var start = Main_events[parseInt(i,10)-1].getEndTime();
      var start = new Date(Main_events[parseInt(i, 10) - 1].getEndTime().getTime() + buffer * 60 * 1000);
      //var end = Main_events[parseInt(i,10)].getStartTime();
      var end = new Date(Main_events[parseInt(i, 10)].getStartTime().getTime() - buffer * 60 * 1000);
    }
    else if (i == Main_events.length - 1) {
      //var start = Main_events[i].getEndTime();
      var start = new Date(Main_events[i].getEndTime().getTime() + buffer * 60 * 1000);
      var end = endDate;
    }
    if (SPLIT_TIMEMAPS_BY_DAYS) {
      if (start.getDate() == end.getDate()) {
        var duration = 0;
      }
      else {
        var duration = Math.ceil((end.getTime() - start.getTime()) / 1000 / 60 / 60 / 24);
      }


      //var duration = (end.getTime() - start.getTime()
      if (duration == 0) {
        await AddUpdateTimeMapEvent(timemap_cal, start, end, InvertedTimemap);
      }
      else {
        for (var z = 0; z <= duration; z++) {
          if (z == 0) {
            var s = new Date(start);
            var e = new Date(start);
            e.setHours(23, 59, 59);
            await AddUpdateTimeMapEvent(timemap_cal, s, e, InvertedTimemap);
          }
          else if (z == duration) {
            var e = new Date(end);
            var s = new Date(end);
            s.setHours(0, 0, 0);
            await AddUpdateTimeMapEvent(timemap_cal, s, e, InvertedTimemap);

          }
          else {
            var s = new Date(start.getTime() + z * 1000 * 60 * 60 * 24);
            var e = new Date(start.getTime() + z * 1000 * 60 * 60 * 24);
            s.setHours(0, 0, 0);
            e.setHours(23, 59, 59);
            await AddUpdateTimeMapEvent(timemap_cal, s, e, InvertedTimemap);
          }
        }
      }
    }
    else {
      await AddUpdateTimeMapEvent(timemap_cal, start, end, InvertedTimemap);
    }
    i++;
  } while (i <= Main_events.length)
  return;
}

function BlindAddTimeMapEvent(timemap_cal, start, end, eventName) {
  if (start.valueOf() < end.valueOf()) {
    timemap_cal.createEvent(eventName, start, end);
  }
  return;
}

function AddUpdateTimeMapEvent(timemap_cal, start, end, eventName) {
  if (start.valueOf() < end.valueOf()) {
    var existing_events = timemap_cal.getEvents(start, end, { search: eventName });
    //if event exists on this day- check/update times
    //if no event create event
    if (existing_events.length == 1) {
      if (existing_events[0].getStartTime() != start || existing_events[0].getEndTime() != end) {
        existing_events[0].deleteEvent();
        timemap_cal.createEvent(eventName, start, end);
      }
    }
    else if (existing_events.length > 1) {
      for (var j in existing_events) {
        existing_events[j].deleteEvent();
      }
      timemap_cal.createEvent(eventName, start, end);
    }
    else {
      timemap_cal.createEvent(eventName, start, end);
    }
  }
  return;
}

function add_daylightEvent(cal, date) {
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
    var response = fetchWithRetry(url);
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

//var dt = new Date(getDateFromIso("2012-08-03T23:00:26-05:00"));

// http://delete.me.uk/2005/03/iso8601.html
function getDateFromIso(string) {
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