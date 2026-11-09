import assert from "node:assert/strict";
import test from "node:test";
import { isUsFederalHoliday, usFederalHolidayKeys } from "./usHolidays.js";
import { spokenFor, UNAVAILABLE_SPOKEN } from "./unavailableVoice.js";
import {
  isQuietHoursActive,
  quietHoursVoice,
  parseQuietDays,
  localIsoWeekday,
  calendarDayKey,
} from "./api.js";

test("US federal holidays include fixed + floating days (2026)", () => {
  const keys = usFederalHolidayKeys(2026);
  assert.ok(keys.has("2026-01-01")); // New Year's (Thu)
  assert.ok(keys.has("2026-01-19")); // MLK 3rd Mon
  assert.ok(keys.has("2026-02-16")); // Presidents'
  assert.ok(keys.has("2026-05-25")); // Memorial
  assert.ok(keys.has("2026-06-19")); // Juneteenth
  assert.ok(keys.has("2026-07-03")); // July 4 observed (Sat → Fri)
  assert.ok(keys.has("2026-09-07")); // Labor
  assert.ok(keys.has("2026-10-12")); // Columbus / Indigenous Peoples'
  assert.ok(keys.has("2026-11-11")); // Veterans
  assert.ok(keys.has("2026-11-26")); // Thanksgiving
  assert.ok(keys.has("2026-12-25")); // Christmas
  assert.equal(isUsFederalHoliday("2026-07-03"), true);
  assert.equal(isUsFederalHoliday("2026-07-04"), false); // observed Fri instead
  assert.equal(isUsFederalHoliday("2026-08-20"), false);
});

test("School quiet hours: Mon–Fri only, skip federal holidays", () => {
  const school = {
    quiet_start: "08:00",
    quiet_end: "15:30",
    quiet_tz: "America/Chicago",
    quiet_days: "1,2,3,4,5",
    skip_holidays: 1,
    schedule_preset: "school",
  };
  // Wednesday 2026-08-19 15:00 UTC = 10:00 CDT — school day
  const wed = new Date("2026-08-19T15:00:00.000Z");
  assert.equal(calendarDayKey(wed, "America/Chicago"), "2026-08-19");
  assert.equal(localIsoWeekday(wed, "America/Chicago"), 3);
  assert.equal(isQuietHoursActive(school, wed), true);
  assert.equal(quietHoursVoice(school), "school");

  // Saturday same clock — not school
  const sat = new Date("2026-08-22T15:00:00.000Z");
  assert.equal(localIsoWeekday(sat, "America/Chicago"), 6);
  assert.equal(isQuietHoursActive(school, sat), false);

  // MLK Day 2026-01-19 Monday 10:00 CT — holiday skip
  const mlk = new Date("2026-01-19T16:00:00.000Z");
  assert.equal(calendarDayKey(mlk, "America/Chicago"), "2026-01-19");
  assert.equal(isUsFederalHoliday("2026-01-19"), true);
  assert.equal(isQuietHoursActive(school, mlk), false);

  // Same MLK Monday with skip off → blocked
  assert.equal(isQuietHoursActive({ ...school, skip_holidays: 0 }, mlk), true);
});

test("parseQuietDays and bedtime voice for overnight custom", () => {
  assert.deepEqual([...parseQuietDays("1,2,3,4,5")!].sort(), [1, 2, 3, 4, 5]);
  assert.equal(parseQuietDays(null), null);
  assert.equal(
    quietHoursVoice({ schedule_preset: "custom", quiet_start: "21:00", quiet_end: "07:00" }),
    "bedtime"
  );
  assert.equal(
    quietHoursVoice({ schedule_preset: "custom", quiet_start: "09:00", quiet_end: "15:00" }),
    "quiet"
  );
});

test("spoken unavailable phrases are stable", () => {
  assert.equal(
    spokenFor("school", "callee"),
    "They're at school right now. Please try again later."
  );
  assert.equal(
    spokenFor("bedtime", "callee"),
    "They're not available until tomorrow. Please try again then."
  );
  assert.equal(
    spokenFor("timeout", "callee"),
    "They're in a timeout right now. Please try again later."
  );
  assert.equal(
    spokenFor("quiet", "callee"),
    "They're in Quiet Time right now. Please try again later."
  );
  assert.match(spokenFor("offline", "caller"), /isn.?t reachable/i);
  assert.match(spokenFor("busy", "callee"), /another call/i);
  assert.match(UNAVAILABLE_SPOKEN.offline.caller, /PhoneHome/i);
  assert.ok(UNAVAILABLE_SPOKEN.paused.caller.includes("Timeout"));
  assert.ok(UNAVAILABLE_SPOKEN.timeout.caller.includes("Timeout"));
});
