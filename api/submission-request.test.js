import assert from "node:assert/strict";
import test from "node:test";
import { validateSubmissionRequest } from "./submission-request.js";

test("validates and canonicalizes a monthly submission", () => {
  const result = validateSubmissionRequest({
    name: " 松田 ",
    monthKey: "2026-09",
    entries: [
      {
        date: "2026-09-02",
        shiftType: "morning",
        start: "00:00",
        end: "23:59",
      },
      {
        date: "2026-09-01",
        shiftType: "other",
        start: "11:00",
        end: "15:30",
      },
    ],
  });

  assert.equal(result.name, "松田");
  assert.deepEqual(result.entries, [
    {
      name: "松田",
      date: "2026-09-01",
      monthKey: "2026-09",
      shiftType: "other",
      start: "11:00",
      end: "15:30",
    },
    {
      name: "松田",
      date: "2026-09-02",
      monthKey: "2026-09",
      shiftType: "morning",
      start: "10:00",
      end: "13:00",
    },
  ]);
});

test("rejects dates outside the requested month", () => {
  assert.throws(
    () =>
      validateSubmissionRequest({
        name: "松田",
        monthKey: "2026-09",
        entries: [{ date: "2026-10-01", shiftType: "unavailable" }],
      }),
    /対象月と日付/
  );
});

test("rejects duplicate dates", () => {
  assert.throws(
    () =>
      validateSubmissionRequest({
        name: "松田",
        monthKey: "2026-09",
        entries: [
          { date: "2026-09-01", shiftType: "morning" },
          { date: "2026-09-01", shiftType: "afternoon" },
        ],
      }),
    /重複/
  );
});

test("rejects invalid custom time ranges", () => {
  assert.throws(
    () =>
      validateSubmissionRequest({
        name: "松田",
        monthKey: "2026-09",
        entries: [
          {
            date: "2026-09-01",
            shiftType: "other",
            start: "16:00",
            end: "15:00",
          },
        ],
      }),
    /時間帯/
  );
});
