const SHIFT_TEMPLATES = {
  morning: { start: "10:00", end: "13:00" },
  afternoon: { start: "13:00", end: "17:00" },
  fullday: { start: "10:00", end: "17:00" },
  unavailable: { start: null, end: null },
};

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSubmissionRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("提出データが正しくありません。");
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const monthKey =
    typeof payload.monthKey === "string" ? payload.monthKey.trim() : "";

  if (!name || name.length > 50) {
    throw new Error("PA名を確認してください。");
  }
  if (!MONTH_KEY_PATTERN.test(monthKey)) {
    throw new Error("対象月を確認してください。");
  }
  if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
    throw new Error("シフトを選択してください。");
  }
  if (payload.entries.length > 31) {
    throw new Error("提出できる日数を超えています。");
  }

  const seenDates = new Set();
  const entries = payload.entries.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("シフトデータが正しくありません。");
    }

    const date = typeof entry.date === "string" ? entry.date : "";
    const shiftType =
      typeof entry.shiftType === "string" ? entry.shiftType : "";

    if (
      !DATE_PATTERN.test(date) ||
      date.slice(0, 7) !== monthKey ||
      !isValidCalendarDate(date)
    ) {
      throw new Error("対象月と日付が一致していません。");
    }
    if (seenDates.has(date)) {
      throw new Error("同じ日付が重複しています。");
    }
    seenDates.add(date);

    if (shiftType === "other") {
      const start = typeof entry.start === "string" ? entry.start : "";
      const end = typeof entry.end === "string" ? entry.end : "";
      if (
        !TIME_PATTERN.test(start) ||
        !TIME_PATTERN.test(end) ||
        start < "10:00" ||
        end > "17:00" ||
        start >= end
      ) {
        throw new Error(`${date} の時間帯を確認してください。`);
      }
      return { name, date, monthKey, shiftType, start, end };
    }

    const template = SHIFT_TEMPLATES[shiftType];
    if (!template) {
      throw new Error(`${date} の勤務帯を確認してください。`);
    }

    return {
      name,
      date,
      monthKey,
      shiftType,
      start: template.start,
      end: template.end,
    };
  });

  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { name, monthKey, entries };
}

function isValidCalendarDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
