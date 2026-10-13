const SLOT_RANGES = {
  morning: { start: "10:00", end: "13:00" },
  afternoon: { start: "13:00", end: "17:00" },
};

// Previous-month differences should influence the result without outweighing
// the current month's balance. At most one afternoon slot (4 hours) is carried
// forward, and only 25% of the previous-month difference is applied.
export const PREVIOUS_MONTH_HOURS_WEIGHT = 0.25;
export const PREVIOUS_MONTH_MAX_COMPENSATION_HOURS = 4;

function timeToMinutes(time) {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getSlotRange(slot) {
  return SLOT_RANGES[slot] || null;
}

export function calculateAssignedHoursForSlotItem(item) {
  const slotRange = getSlotRange(item?.slot);
  if (!slotRange) return 0;

  const slotStart = timeToMinutes(slotRange.start);
  const slotEnd = timeToMinutes(slotRange.end);
  const entryStart = timeToMinutes(item.start);
  const entryEnd = timeToMinutes(item.end);

  if (
    [slotStart, slotEnd, entryStart, entryEnd].some((value) => value == null)
  ) {
    return 0;
  }

  const overlapStart = Math.max(slotStart, entryStart);
  const overlapEnd = Math.min(slotEnd, entryEnd);
  return Math.max(0, overlapEnd - overlapStart) / 60;
}

export function itemCoversFullSlot(item) {
  const slotRange = getSlotRange(item?.slot);
  if (!slotRange) return false;

  const slotStart = timeToMinutes(slotRange.start);
  const slotEnd = timeToMinutes(slotRange.end);
  const entryStart = timeToMinutes(item.start);
  const entryEnd = timeToMinutes(item.end);

  if (
    [slotStart, slotEnd, entryStart, entryEnd].some((value) => value == null)
  ) {
    return false;
  }

  return entryStart <= slotStart && entryEnd >= slotEnd;
}

function calculatePreviousMonthCompensation(previousHours, highestPreviousHours) {
  const difference = Math.max(0, highestPreviousHours - previousHours);
  return Math.min(
    difference * PREVIOUS_MONTH_HOURS_WEIGHT,
    PREVIOUS_MONTH_MAX_COMPENSATION_HOURS
  );
}

export function selectCandidateForSlot(
  candidates,
  {
    confirmedHours = {},
    previousMonthHours = {},
    previousSlotName = "",
    previousDayNames = [],
  } = {}
) {
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const fullSlotCandidates = candidates.filter(itemCoversFullSlot);
  let eligibleCandidates = fullSlotCandidates.length
    ? fullSlotCandidates
    : [...candidates];

  // If the slot can still be covered in full, prefer splitting morning and
  // afternoon between two people instead of assigning one person all day.
  if (previousSlotName) {
    const differentPersonCandidates = eligibleCandidates.filter(
      (item) => item.name !== previousSlotName
    );
    if (differentPersonCandidates.length) {
      eligibleCandidates = differentPersonCandidates;
    }
  }

  // Avoid assigning someone on consecutive calendar days when another
  // full-slot candidate remains available.
  const previousDayNameSet = new Set(previousDayNames);
  if (previousDayNameSet.size) {
    const nonConsecutiveCandidates = eligibleCandidates.filter(
      (item) => !previousDayNameSet.has(item.name)
    );
    if (nonConsecutiveCandidates.length) {
      eligibleCandidates = nonConsecutiveCandidates;
    }
  }

  const highestPreviousHours = Math.max(
    0,
    ...eligibleCandidates.map((item) => previousMonthHours[item.name] || 0)
  );

  eligibleCandidates.sort((a, b) => {
    const assignedHoursA = calculateAssignedHoursForSlotItem(a);
    const assignedHoursB = calculateAssignedHoursForSlotItem(b);
    const projectedHoursA = (confirmedHours[a.name] || 0) + assignedHoursA;
    const projectedHoursB = (confirmedHours[b.name] || 0) + assignedHoursB;
    const previousHoursA = previousMonthHours[a.name] || 0;
    const previousHoursB = previousMonthHours[b.name] || 0;
    const scoreA =
      projectedHoursA -
      calculatePreviousMonthCompensation(previousHoursA, highestPreviousHours);
    const scoreB =
      projectedHoursB -
      calculatePreviousMonthCompensation(previousHoursB, highestPreviousHours);

    if (scoreA !== scoreB) return scoreA - scoreB;
    if (projectedHoursA !== projectedHoursB) {
      return projectedHoursA - projectedHoursB;
    }
    if (previousHoursA !== previousHoursB) {
      return previousHoursA - previousHoursB;
    }
    return a.name.localeCompare(b.name, "ja");
  });

  return eligibleCandidates[0];
}
