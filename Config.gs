/**
 * Global configuration for Calendar automations.
 * Keep all user-tunable constants in this file.
 */

// Calendars and scheduling window.
const TIMEMAP_CALENDAR_ID = "1a1a44068207e09221d980c6c0ee587bc86587f680f862e56ba0bf6a8e47e020@group.calendar.google.com";
const WORK_CALENDAR_ID = "070pmqum2gcm69ekmog6fvkmtk@group.calendar.google.com";
const GYM_EVENT_CALENDAR_ID = "e2cded7a7d9b7ab233db56e5fbf138f413a2c7b9a68e45cfe58af95f432f9f5f@group.calendar.google.com";
const SLEEP_CALENDAR_ID = "496baca0d033db4062ef3acd672aa7ba22cc505bad94b3920b2bd2358c25d610@group.calendar.google.com";
const TRAVEL_CALENDAR_ID = "c6511974498db2a541c354a55443df76cbee6a1ba88e943c898e013768e05a12@group.calendar.google.com";
const SCHEDULING_WINDOW = 60; // days

// Calendar exclusion list when scanning commitments/busy windows.
const CALENDARS_TO_EXCLUDE = ["Travel", "Waverley Valley Scout Group - Shared Calendar", "WV SCOUTS", "Travel Time", "Sleep", "Birthdays", "TimeMaps", "SkedPal Task Zones", "SkedPal", "Waverley Valley Equipment Booking", "Victoria Holidays", "MSC Sailing Calendar", "melbourne Weather", "lewisdavidr53@gmail.com", "Formula 1", "ScoutHall-1-Main Hall/Kitchen (80)", "https://events.terrain.scouts.com.au/calendar-feeds/b2985cbe-a853-394b-9920-77cdb37b575c/36a95f57-b798-43fc-9513-d8ac4cbe35fb"];

// Shared gym constants.
const GYM_TITLE = "Gym";
const GYM_LOCATION_SUBSTRING = "Snap Fitness 24/7 Ashburton";
const GYM_DRIVE_MINUTES = 10;
const GYM_RUN_MINUTES = 30;
const GYM_EARLIEST_START_HOUR = 6;
const GYM_EARLIEST_START_MINUTE = 0;
const GYM_LATEST_END_HOUR = 20;
const GYM_LATEST_END_MINUTE = 0;
const GYM_RUN_TO_TITLE = "[Run] to Gym";
const GYM_RUN_HOME_TITLE = "[Run] Home";
const GYM_DRIVE_TO_TITLE = "[Drive] To: Gym";
const GYM_DRIVE_HOME_TITLE = "[Drive] Home";

// Gym preferred-time configuration (window order matters).
const GYM_PREFERRED_EXACT_START_HOUR = 11;
const GYM_PREFERRED_EXACT_START_MINUTE = 30;
const GYM_PREFERRED_WINDOW_1_START_HOUR = 11;
const GYM_PREFERRED_WINDOW_1_START_MINUTE = 0;
const GYM_PREFERRED_WINDOW_1_END_HOUR = 15;
const GYM_PREFERRED_WINDOW_1_END_MINUTE = 30;
const GYM_PREFERRED_WINDOW_2_END_HOUR = 9;
const GYM_PREFERRED_WINDOW_2_END_MINUTE = 0;
// Linear gym scaling by daily free time (minutes inside gym window).
const GYM_FREE_MINUTES_FULL = 360;
const GYM_FREE_MINUTES_MIN = 120;

// TimeMap titles and duration profile.
const TIMEMAP_1_TITLE = "[1-Needle-Mover]";
const TIMEMAP_2_TITLE = "[2-Execute]";
const TIMEMAP_3_TITLE = "[3-Ops/Future]";
const TIMEMAP_4_TITLE = "[4-Play]";
const TIMEMAP_GYM_TITLE = "[gym]";
const TIMEMAP_ERRANDS_TITLE = "[Errands]";
const TIMEMAP_SCOUTHALL_TITLE = "[@scouthall]";
const TIMEMAP_MORNING_ROUTINE_TITLE = "[MorningRoutine]";
const TIMEMAP_SHUTDOWN_ROUTINE_TITLE = "[ShutdownRoutine]";
const TIMEMAP_MORNING_ROUTINE_MINUTES = 30;
const TIMEMAP_SHUTDOWN_ROUTINE_MINUTES = 30;
const TIMEMAP_1_HOURS = 4;
const TIMEMAP_2_HOURS = 4;
const TIMEMAP_3_HOURS = 4;
const TIMEMAP_4_HOURS = 4;
const TIMEMAP_MIN_1_HOURS = 2;
const TIMEMAP_MIN_2_HOURS = 2;
const TIMEMAP_MIN_3_HOURS = 2;
const TIMEMAP_MIN_4_HOURS = 2;
const TIMEMAP_MIN_BLOCK_MINUTES = 30;
const TIMEMAP_ERRANDS_WINDOW_MINUTES = 60;
const TIMEMAP_SCOUTHALL_BUFFER_MINUTES = 60;
const TIMEMAP_SCOUTHALL_LOCATION_MATCH = "waverleyvalley scout group";
const TIMEMAP_TREAT_SKEDPAL_AS_BUSY = true;
const GYM_SOURCE_SKEDPAL = true;
const TIMEMAP_DEBUG_NO_WRITES = false;

// Sleep configuration.
const SLEEP_DURATION_HOURS = 8;
const SLEEP_BEGIN = 20; // hour (0-23) start of "normal sleep" window
const SLEEP_END = 12; // hour (0-23) end of "normal sleep" window (next day)
const SLEEP_IDEAL_WAKE_UP_HRS = 7;
const SLEEP_IDEAL_WAKE_UP_MIN = 0;
/** Minutes before earliest outbound [Drive] To: start to set wake (prep, breakfast). */
const SLEEP_BUFFER_BEFORE_LEAVE_MINUTES = 60;
/**
 * Minutes after [Drive] Home ends before sleep may start (wind-down; not straight to bed).
 * Applied on top of the drive end time, then SLEEP_TRAVEL_BUFFER_ROUND_MINUTES (if > 0).
 */
const SLEEP_BUFFER_AFTER_DRIVE_HOME_MINUTES = 60;
/** Round travel-adjusted times (wake-from-leave, earliest sleep after home) to nearest N minutes; 0 = no rounding. */
const SLEEP_TRAVEL_BUFFER_ROUND_MINUTES = 15;
const SLEEP_MIN_BLOCK_HOURS = 4;
const SLEEP_EVENT_TAG = "[SLEEP]";
const SLEEP_OVERRIDE_TAG = "[OVERRIDE]";
const SLEEP_EXTPROP_AUTO_START = "sleepAutoStart";
const SLEEP_EXTPROP_AUTO_END = "sleepAutoEnd";
const SLEEP_DRIVE_OUTBOUND_PREFIX = "[Drive] To:";
const SLEEP_DRIVE_HOME_TITLE = "[Drive] Home";
const SLEEP_IGNORE_TITLE = "Gym";
const SLEEP_IGNORE_LOCATION_SUBSTRING = "Snap Fitness 24/7 Ashburton";
const SLEEP_MULTIDAY_HOURS = 24;

// Travel configuration.
const TRAVEL_VIRTUAL_LOCATION_SUBSTRINGS = ["microsoft teams meeting", "teams meeting", "zoom", "google meet", "meet - ", "webex", "video call", "ringcentral", "gotomeeting", "skype", "facetime", "meet.google", "teams.microsoft", "zoom.us"];
const TRAVEL_ARRIVE_MINUTES_BEFORE = 15;
const TRAVEL_MIN_HOME_MINUTES = 30;
const TRAVEL_DRIVE_EVENT_TAG = "[Drive]";
const TRAVEL_MAPS_SLEEP_MS = 300;
const TRAVEL_MAPS_SLEEP_EVERY_N = 2;
const TRAVEL_FALLBACK_DURATION_MINUTES = 60;
const TRAVEL_LEG_STATE_PREFIX = "TRAVEL_LEG_STATE_";

// Trigger/runtime chunking.
const MAX_RUNTIME_PER_RUN_MS = 5 * 60 * 1000;
const MAX_RUNTIME_COMBINED_PHASE_MS = 2 * 60 * 1000;
const TRAVEL_DAYS_PER_CHUNK = 30;
const SLEEP_DAYS_PER_CHUNK = 30;
const TIMEMAP_DAYS_PER_CHUNK = Math.ceil(SCHEDULING_WINDOW / 2);

// Timemap: behaviour beyond weather forecast and for office.
/** Use sunrise–sunset for [Outside] on days beyond the weather forecast (assume nice weather). */
const USE_SUNRISE_SUNSET_FOR_OUTSIDE_BEYOND_FORECAST = false;
/** Add [Work_Office] events to the [Inside] timemap as well. */
const ADD_WORK_OFFICE_TO_INSIDE_TIMEMAP = false;
/** For days beyond the weather forecast, create both [Inside] and [Outside] slots (outside from sunrise–sunset). */
const EXTEND_INSIDE_AND_OUTSIDE_BEYOND_FORECAST = true;
const SPLIT_TIMEMAPS_BY_DAYS = true;
const RATE_LIMIT_SLEEP_MS = 3000;
const RATE_LIMIT_EVERY_N_EVENTS = 3;
const SYNC_THROTTLE_EVERY_N = 8;
const SYNC_THROTTLE_MS = 200;
const SUMMARY_EVENT_DURATION_MINUTES = 5;
const WORK_NONWORK_BUFFER_MINUTES = 60;

// Quota tuning.
const IS_WORKSPACE_ACCOUNT = false; // true for Google Workspace (higher quotas), false for consumer/gmail
const MAPS_DIRECTION_DAILY_LIMIT = IS_WORKSPACE_ACCOUNT ? 10000 : 1000;
const CALENDAR_EVENTS_CREATED_DAILY_LIMIT = IS_WORKSPACE_ACCOUNT ? 10000 : 5000;
const SCRIPT_RUNTIME_LIMIT_MINUTES = 6;
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUOTA_BURST_TARGET_FRACTION = 0.75;
const QUOTA_BACKOFF_START_FRACTION = 0.75;
const QUOTA_BACKOFF_SOFT_STOP_FRACTION = 0.95;
const QUOTA_BACKOFF_MID_REMAINING_FRACTION = 0.25;
const QUOTA_BACKOFF_LOW_REMAINING_FRACTION = 0.10;
const QUOTA_STATE_PREFIX = "QUOTA_STATE_";
const QUOTA_SERVICE_MAPS_DIRECTION = "MAPS_DIRECTION";
const QUOTA_SERVICE_CALENDAR_CREATES = "CALENDAR_CREATES";
const TRAVEL_RECHECK_STALE_MS = 3 * 24 * 60 * 60 * 1000;

// Open-Meteo cache controls.
const OPENMETEO_CACHE_DATE_KEY = "OPENMETEO_LAST_FETCH_DATE";
const OPENMETEO_CACHE_PREFIX = "OPENMETEO_RAW_";
const OPENMETEO_CACHE_CHUNK_SIZE = 8000;
const OPENMETEO_CACHE_TIMEZONE = "Australia/Melbourne";
const OPENMETEO_CACHE_MAX_AGE_DAYS = 2;
const OPENMETEO_429_RETRY_DELAY_MS = 90000;

// Pay-period and location constants.
const REFERENCE_PAY_PERIOD_START = new Date("2023-11-16T00:00:00");
const MIN_WORK_HOURS_ENABLE = false;
const MIN_WORKING_MINUTES_PER_FORTNIGHT = 1 * 60;
const WORK_REMAINING_HOUR_EVENT_STATUS_FREE = true;
const HOURLY_RATE = 50;
const PAY_PERIOD = 14;
const LOCATION_LAT = -37.910156;
const LOCATION_LONG = 145.107420;
