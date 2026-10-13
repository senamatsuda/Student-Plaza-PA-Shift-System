import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAssignedHoursForSlotItem,
  selectCandidateForSlot,
} from "./shift-allocation.mjs";

const item = (overrides = {}) => ({
  name: "A",
  slot: "morning",
  start: "10:00",
  end: "13:00",
  shiftType: "morning",
  ...overrides,
});

test("a full-slot candidate is preferred over a partial candidate", () => {
  const selected = selectCandidateForSlot([
    item({ name: "Partial", start: "10:00", end: "12:00", shiftType: "other" }),
    item({ name: "Full" }),
  ]);

  assert.equal(selected.name, "Full");
});

test("afternoon is assigned to a different person when possible", () => {
  const selected = selectCandidateForSlot(
    [
      item({ name: "Morning person", slot: "afternoon", start: "13:00", end: "17:00" }),
      item({ name: "Other person", slot: "afternoon", start: "13:00", end: "17:00" }),
    ],
    {
      confirmedHours: { "Morning person": 0, "Other person": 4 },
      previousSlotName: "Morning person",
    }
  );

  assert.equal(selected.name, "Other person");
});

test("full-slot coverage wins over splitting the day between two people", () => {
  const selected = selectCandidateForSlot(
    [
      item({ name: "Morning person", slot: "afternoon", start: "13:00", end: "17:00" }),
      item({ name: "Partial alternative", slot: "afternoon", start: "13:00", end: "15:00" }),
    ],
    { previousSlotName: "Morning person" }
  );

  assert.equal(selected.name, "Morning person");
});

test("consecutive morning shifts are avoided when another person is available", () => {
  const selected = selectCandidateForSlot(
    [item({ name: "Worked yesterday" }), item({ name: "Rested yesterday" })],
    {
      confirmedHours: { "Worked yesterday": 0, "Rested yesterday": 6 },
      previousDayNames: ["Worked yesterday"],
    }
  );

  assert.equal(selected.name, "Rested yesterday");
});

test("a previous-day worker remains eligible when nobody else covers the full slot", () => {
  const selected = selectCandidateForSlot(
    [
      item({ name: "Worked yesterday" }),
      item({
        name: "Partial alternative",
        start: "10:00",
        end: "12:00",
        shiftType: "other",
      }),
    ],
    { previousDayNames: ["Worked yesterday"] }
  );

  assert.equal(selected.name, "Worked yesterday");
});

test("current-month total hours are balanced instead of slot counts", () => {
  const selected = selectCandidateForSlot(
    [item({ name: "A" }), item({ name: "B" })],
    { confirmedHours: { A: 7, B: 3 } }
  );

  assert.equal(selected.name, "B");
});

test("lower previous-month hours provide a bounded current-month advantage", () => {
  const selected = selectCandidateForSlot(
    [item({ name: "Lower previous" }), item({ name: "Higher previous" })],
    {
      confirmedHours: { "Lower previous": 4, "Higher previous": 2 },
      previousMonthHours: { "Lower previous": 0, "Higher previous": 16 },
    }
  );

  assert.equal(selected.name, "Lower previous");
});

test("previous-month compensation cannot outweigh a gap larger than four hours", () => {
  const selected = selectCandidateForSlot(
    [item({ name: "Lower previous" }), item({ name: "Higher previous" })],
    {
      confirmedHours: { "Lower previous": 10, "Higher previous": 2 },
      previousMonthHours: { "Lower previous": 0, "Higher previous": 40 },
    }
  );

  assert.equal(selected.name, "Higher previous");
});

test("custom time counts only the overlap with its slot", () => {
  assert.equal(
    calculateAssignedHoursForSlotItem(
      item({ slot: "afternoon", start: "12:00", end: "14:30", shiftType: "other" })
    ),
    1.5
  );
});
