const SHIFT_TEMPLATES = {
  morning: { label: "午前", start: "10:00", end: "13:00" },
  afternoon: { label: "午後", start: "13:00", end: "17:00" },
  fullday: { label: "1日", start: "10:00", end: "17:00" },
  unavailable: { label: "勤務不可", start: null, end: null },
};
const MORNING_RANGE = { start: "10:00", end: "13:00" };
const AFTERNOON_RANGE = { start: "13:00", end: "17:00" };
const HOLIDAY_API_URL = "https://holidays-jp.github.io/api/v1/date.json";
const API_DEFAULT_BASE_URL = "http://localhost:3001";
const API_DEFAULT_ERROR_MESSAGE =
  "サーバーとの通信に失敗しました。時間をおいて再度お試しください。";
const apiBaseUrl =
  getMetaContent("pa-shift-api-base-url") ||
  window.PA_SHIFT_API_BASE_URL ||
  API_DEFAULT_BASE_URL;
const apiKey =
  getMetaContent("pa-shift-api-key") || window.PA_SHIFT_API_KEY || "dev-api-key";
const normalizedApiBaseUrl = apiBaseUrl.replace(/\/$/, "");

let submissionEntries = [];
let holidayMap = {};
let specialDayEntries = [];
let specialDayMap = {};
let paNames = [];

const monthPicker = document.getElementById("monthPicker");
const calendarContainer = document.getElementById("calendar");
const form = document.getElementById("shiftForm");
const formStatus = document.getElementById("formStatus");
const studentNameSelect = document.getElementById("studentName");
const adminTableWrapper = document.getElementById("adminTableWrapper");
const adminRefreshButton = document.getElementById("refreshAdmin");
const adminNameFilter = document.getElementById("adminNameFilter");
const adminMonthInput = document.getElementById("adminMonth");
const exportConfirmedButton = document.getElementById(
  "exportConfirmedShifts"
);
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");
const adminSubtabButtons = document.querySelectorAll(".admin-subtab-button");
const adminSubtabPanels = document.querySelectorAll(".admin-subtab-panel");
const specialDayForm = document.getElementById("specialDayForm");
const specialDayDateInput = document.getElementById("specialDayDate");
const specialDayNoteInput = document.getElementById("specialDayNote");
const specialDayList = document.getElementById("specialDayList");
const specialDayStatus = document.getElementById("specialDayStatus");
const paNameForm = document.getElementById("paNameForm");
const paNameInput = document.getElementById("paNameInput");
const paNameStatus = document.getElementById("paNameStatus");
const paNameList = document.getElementById("paNameList");

const template = document.getElementById("shiftRowTemplate");

function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"]`);
  return meta?.content?.trim() || "";
}

function buildApiUrl(path) {
  if (!path.startsWith("/")) {
    return `${normalizedApiBaseUrl}/${path}`;
  }
  return `${normalizedApiBaseUrl}${path}`;
}

async function apiRequest(path, options = {}) {
  const headers = {
    "x-api-key": apiKey,
    ...(options.headers || {}),
  };
  const hasBody = options.body && !(options.body instanceof FormData);
  if (hasBody && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(buildApiUrl(path), {
    ...options,
    headers,
  });
  if (!response.ok) {
    let message = `${API_DEFAULT_ERROR_MESSAGE} (status: ${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) {
        message = data.error;
      }
    } catch (error) {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

init().catch((error) => {
  console.error("Failed to initialize application", error);
  if (formStatus) {
    formStatus.textContent = API_DEFAULT_ERROR_MESSAGE;
    formStatus.style.color = "#b42318";
  }
});

async function init() {
  await initializePaNames();
  const now = new Date();
  const currentMonthValue = formatMonthInput(now);
  monthPicker.value = currentMonthValue;
  adminMonthInput.value = currentMonthValue;
  setupTabs();
  setupAdminSubtabs();
  await loadHolidayData();
  await initializeSpecialDays();
  await refreshSubmissions();
  renderCalendar();
  form.addEventListener("submit", handleSubmit);
  monthPicker.addEventListener("change", renderCalendar);
  studentNameSelect.addEventListener("change", renderCalendar);
  if (adminRefreshButton) {
    adminRefreshButton.addEventListener("click", handleAdminRefresh);
  }
  adminMonthInput.addEventListener("change", renderAdminTable);
  adminNameFilter.addEventListener("change", renderAdminTable);
  if (adminTableWrapper) {
    adminTableWrapper.addEventListener("click", handleAdminTableClick);
  }
  if (exportConfirmedButton) {
    exportConfirmedButton.addEventListener(
      "click",
      handleExportConfirmedShifts
    );
  }
  if (specialDayForm) {
    specialDayForm.addEventListener("submit", handleSpecialDaySubmit);
  }
  if (specialDayList) {
    specialDayList.addEventListener("click", handleSpecialDayListClick);
  }
  if (paNameForm) {
    paNameForm.addEventListener("submit", handlePaNameSubmit);
  }
  if (paNameList) {
    paNameList.addEventListener("click", handlePaNameListClick);
  }
  renderAdminTable();
}

async function initializePaNames() {
  await refreshPaNames();
  populateNameSelects();
  renderPaNameList();
}

async function refreshPaNames() {
  try {
    const response = await apiRequest("/names", { method: "GET" });
    paNames = Array.isArray(response) ? response : [];
  } catch (error) {
    console.error("Failed to load names", error);
    paNames = [];
    updatePaNameStatus(error.message, "#b42318");
  }
}

function populateNameSelects() {
  const previousStudent = studentNameSelect.value;
  const previousAdminSelection = new Set(
    Array.from(adminNameFilter.selectedOptions).map((option) => option.value)
  );

  if (!paNames.length) {
    studentNameSelect.innerHTML =
      '<option value="" selected disabled>PAメンバーが登録されていません</option>';
    adminNameFilter.innerHTML = "";
    return;
  }

  const nameList = paNames.map((entry) => entry.name);

  studentNameSelect.innerHTML = nameList
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("");
  if (nameList.includes(previousStudent)) {
    studentNameSelect.value = previousStudent;
  }

  adminNameFilter.innerHTML = nameList
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("");
  const shouldSelectAll = previousAdminSelection.size === 0;
  let hasSelected = false;
  Array.from(adminNameFilter.options).forEach((option) => {
    const selectOption =
      shouldSelectAll || previousAdminSelection.has(option.value);
    option.selected = selectOption;
    if (selectOption) {
      hasSelected = true;
    }
  });
  if (!hasSelected) {
    Array.from(adminNameFilter.options).forEach((option) => {
      option.selected = true;
    });
  }
}

function renderCalendar() {
  const { year, month } = parseMonthInput(monthPicker.value);
  const monthKey = formatMonthKey(year, month);
  const selectedName = studentNameSelect.value;
  const weekdays = getWeekdays(year, month);
  calendarContainer.innerHTML = "";

  if (!selectedName) {
    calendarContainer.innerHTML =
      '<p class="calendar-empty">PAメンバーを登録してください</p>';
    return;
  }

  const savedEntries = submissionEntries.filter(
    (entry) => entry.name === selectedName && entry.monthKey === monthKey
  );
  const savedEntryMap = savedEntries.reduce((acc, entry) => {
    acc[entry.date] = entry;
    return acc;
  }, {});

  if (formStatus) {
    if (savedEntries.length) {
      formStatus.textContent = `${selectedName}さんの提出済みデータを読み込みました`;
      formStatus.style.color = "#0f7b6c";
    } else if (!formStatus.textContent.startsWith("提出")) {
      formStatus.textContent = "";
    }
  }

  weekdays.forEach((date) => {
    const dateKey = formatDateKey(date);
    const clone = template.content.firstElementChild.cloneNode(true);
    const dayLabel = clone.querySelector(".shift-row__day");
    const noteLabel = clone.querySelector(".shift-row__note");
    const shiftSelect = clone.querySelector(".shift-select");
    const customStart = clone.querySelector(".custom-start");
    const customEnd = clone.querySelector(".custom-end");
    const customTimeWrapper = clone.querySelector(".custom-time");

    clone.dataset.date = dateKey;
    clone.dataset.monthKey = formatMonthKey(year, month);

    dayLabel.textContent = formatDisplayDate(date);
    const holidayName = getHolidayName(dateKey);
    const specialNote = specialDayMap[dateKey];
    const noteTexts = [];
    if (holidayName) {
      noteTexts.push(`${holidayName}（祝日）`);
    }
    if (specialNote) {
      noteTexts.push(specialNote);
      clone.classList.add("special-day");
    }
    noteLabel.textContent = noteTexts.join(" / ");
    noteLabel.hidden = noteTexts.length === 0;
    const isHoliday = Boolean(holidayName);
    if (isHoliday) {
      clone.classList.add("is-holiday");
      shiftSelect.disabled = true;
      shiftSelect.innerHTML = `<option value="">祝日</option>`;
      customStart.disabled = true;
      customEnd.disabled = true;
      clone.setAttribute("aria-disabled", "true");
    }

    populateTimeOptions(customStart);
    populateTimeOptions(customEnd);
    customStart.value = "10:00";
    customEnd.value = "17:00";

    const savedEntry = savedEntryMap[dateKey];

    const toggleCustomTime = () => {
      const isOther = shiftSelect.value === "other";
      customStart.disabled = !isOther;
      customEnd.disabled = !isOther;
      customTimeWrapper.hidden = !isOther;
      customTimeWrapper.classList.toggle("is-visible", isOther);
    };

    if (savedEntry && !isHoliday) {
      shiftSelect.value = savedEntry.shiftType;
      if (savedEntry.shiftType === "other") {
        if (savedEntry.start) {
          customStart.value = savedEntry.start;
        }
        if (savedEntry.end) {
          customEnd.value = savedEntry.end;
        }
      }
    }

    toggleCustomTime();
    shiftSelect.addEventListener("change", toggleCustomTime);

    calendarContainer.appendChild(clone);
  });
}

function populateTimeOptions(select) {
  select.innerHTML = "";
  const times = generateTimeSlots(10, 17, 30);
  times.forEach((time) => {
    const option = document.createElement("option");
    option.value = time;
    option.textContent = time;
    select.appendChild(option);
  });
}

function generateTimeSlots(startHour, endHour, stepMinutes) {
  const slots = [];
  const totalMinutes = (endHour - startHour) * 60;
  for (let i = 0; i <= totalMinutes; i += stepMinutes) {
    const date = new Date();
    date.setHours(startHour, i, 0, 0);
    slots.push(
      `${String(date.getHours()).padStart(2, "0")}:${String(
        date.getMinutes()
      ).padStart(2, "0")}`
    );
  }
  return slots;
}

async function handleSubmit(event) {
  event.preventDefault();
  const name = studentNameSelect.value;
  let entries;
  try {
    entries = collectEntries();
  } catch (error) {
    formStatus.textContent = error.message;
    formStatus.style.color = "#b42318";
    return;
  }

  if (!entries.length) {
    formStatus.textContent = "シフトを選択してください";
    formStatus.style.color = "#b42318";
    return;
  }

  const monthKey = entries[0]?.monthKey;
  try {
    await apiRequest("/submissions", {
      method: "POST",
      body: JSON.stringify({ name, monthKey, entries }),
    });
    formStatus.textContent = "提出しました";
    formStatus.style.color = "#0f7b6c";
    await refreshSubmissions();
    renderCalendar();
    renderAdminTable();
  } catch (error) {
    console.error("Failed to submit shifts", error);
    const message = error?.message || API_DEFAULT_ERROR_MESSAGE;
    formStatus.textContent = message;
    formStatus.style.color = "#b42318";
    window.alert(message);
  }
}

function collectEntries() {
  const rows = Array.from(calendarContainer.querySelectorAll(".shift-row"));
  const name = studentNameSelect.value;
  const entries = [];

  rows.forEach((row) => {
    const date = row.dataset.date;
    const monthKey = row.dataset.monthKey;
    const shiftSelect = row.querySelector(".shift-select");
    const customStart = row.querySelector(".custom-start");
    const customEnd = row.querySelector(".custom-end");
    const isDisabled =
      shiftSelect.disabled || row.getAttribute("aria-disabled") === "true";

    if (isDisabled) {
      return;
    }

    const shiftType = shiftSelect.value;
    if (!shiftType) {
      throw new Error(
        `${formatDisplayDateFromKey(date)} の勤務帯を選択してください`
      );
    }

    if (shiftType === "other") {
      if (customStart.value >= customEnd.value) {
        throw new Error(
          `${formatDisplayDateFromKey(date)} の時間帯を確認してください`
        );
      }
      entries.push({
        name,
        date,
        monthKey,
        shiftType,
        start: customStart.value,
        end: customEnd.value,
      });
      return;
    }

    const template = SHIFT_TEMPLATES[shiftType];
    entries.push({
      name,
      date,
      monthKey,
      shiftType,
      start: template.start,
      end: template.end,
    });
  });

  return entries;
}

async function refreshSubmissions() {
  try {
    const response = await apiRequest("/submissions", { method: "GET" });
    submissionEntries = Array.isArray(response) ? response : [];
  } catch (error) {
    console.error("Failed to load submissions", error);
    submissionEntries = [];
    if (formStatus) {
      formStatus.textContent = error.message;
      formStatus.style.color = "#b42318";
    }
  }
}

function renderAdminTable() {
  const { year, month } = parseMonthInput(
    adminMonthInput.value || monthPicker.value
  );
  const monthKey = formatMonthKey(year, month);
  const filters = Array.from(adminNameFilter.selectedOptions).map(
    (option) => option.value
  );
  const weekdays = getWeekdays(year, month);
  const submissions = submissionEntries.filter(
    (entry) => entry.monthKey === monthKey && (filters.length === 0 || filters.includes(entry.name))
  );

  const grouped = groupByDate(submissions);
  adminTableWrapper.innerHTML = "";

  if (!weekdays.length) {
    adminTableWrapper.textContent = "対象月の平日が見つかりません";
    return;
  }

  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width: 160px">日付</th>
        <th>午前 (10:00-13:00)</th>
        <th>午後 (13:00-17:00)</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");

  weekdays.forEach((date) => {
    const dateKey = formatDateKey(date);
    const row = document.createElement("tr");
    const holidayName = getHolidayName(dateKey);
    const specialNote = specialDayMap[dateKey];
    if (holidayName) {
      row.classList.add("is-holiday");
    }
    if (specialNote) {
      row.classList.add("special-day");
    }
    row.dataset.dateKey = dateKey;
    row.dataset.displayDate = formatDisplayDate(date);
    row.dataset.holidayName = holidayName || "";
    row.dataset.specialNote = specialNote || "";

    const metaCell = document.createElement("td");
    const badgeHtml = [
      holidayName ? `<div class="badge badge--holiday">${holidayName}（祝日）</div>` : "",
      specialNote ? `<div class="badge">${specialNote}</div>` : "",
    ].join("");
    metaCell.innerHTML = `<div>
      <div>${formatDisplayDate(date)}</div>
      ${badgeHtml}
    </div>`;
    row.appendChild(metaCell);

    const dayEntries = grouped[dateKey] ?? createEmptyEntryGroup();
    const columnConfigs = [
      {
        slotKey: "morning",
        items: buildSlotItems(dayEntries, MORNING_RANGE, "morning"),
      },
      {
        slotKey: "afternoon",
        items: buildSlotItems(dayEntries, AFTERNOON_RANGE, "afternoon"),
      },
    ];

    columnConfigs.forEach(({ items, slotKey }) => {
      const cell = document.createElement("td");
      if (items.length) {
        const fragment = document.createDocumentFragment();
        items.forEach((item) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "admin-slot-entry";
          button.textContent = item.label;
          button.dataset.date = item.date;
          button.dataset.slot = slotKey;
          button.dataset.name = item.name;
          button.dataset.label = item.label;
          button.setAttribute("aria-pressed", "false");
          fragment.appendChild(button);
        });
        cell.appendChild(fragment);
      } else {
        cell.innerHTML = "<span style='color:#94a3b8'>--</span>";
      }
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  adminTableWrapper.appendChild(table);
}

async function handleAdminRefresh() {
  if (!adminRefreshButton) {
    await refreshSubmissions();
    renderAdminTable();
    return;
  }
  const originalLabel = adminRefreshButton.textContent;
  adminRefreshButton.disabled = true;
  adminRefreshButton.textContent = "更新中...";
  try {
    await refreshSubmissions();
    renderAdminTable();
  } finally {
    adminRefreshButton.disabled = false;
    adminRefreshButton.textContent = originalLabel;
  }
}

function groupByDate(entries) {
  return entries.reduce((acc, entry) => {
    if (!acc[entry.date]) {
      acc[entry.date] = createEmptyEntryGroup();
    }
    acc[entry.date][entry.shiftType].push(entry);
    return acc;
  }, {});
}

function createEmptyEntryGroup() {
  return {
    morning: [],
    afternoon: [],
    fullday: [],
    other: [],
    unavailable: [],
  };
}

function buildSlotItems(entries, range, slotKey) {
  const items = [];
  const pushEntry = (entry, includeTime = false) => {
    items.push({
      label: formatEntryLabel(entry, includeTime),
      name: entry.name,
      date: entry.date,
    });
  };
  entries[slotKey].forEach((entry) => {
    pushEntry(entry);
  });
  entries.fullday.forEach((entry) => {
    pushEntry(entry);
  });
  entries.other.forEach((entry) => {
    if (timeRangesOverlap(entry.start, entry.end, range.start, range.end)) {
      pushEntry(entry, true);
    }
  });
  return items;
}

function handleAdminTableClick(event) {
  const entryButton = event.target.closest(".admin-slot-entry");
  if (!entryButton) return;
  const isConfirmed = entryButton.classList.toggle("is-confirmed");
  entryButton.setAttribute("aria-pressed", String(isConfirmed));
}

async function handleExportConfirmedShifts() {
  if (!window.html2canvas) {
    window.alert("画像出力機能の読み込みに失敗しました。ページを再読み込みしてください。");
    return;
  }
  const tableExists =
    adminTableWrapper && adminTableWrapper.querySelector(".admin-table");
  if (!tableExists) {
    window.alert("シフト表が見つかりません。対象月を確認してください。");
    return;
  }
  const exportData = collectConfirmedShiftData();
  if (!exportData.rows.length) {
    window.alert("出力できるデータがありません。");
    return;
  }
  const originalLabel = exportConfirmedButton.textContent;
  exportConfirmedButton.disabled = true;
  exportConfirmedButton.textContent = "出力中...";
  let sheet;
  try {
    sheet = buildExportSheet(exportData);
    document.body.appendChild(sheet);
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (error) {
        console.warn("Font loading wait failed", error);
      }
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const canvas = await window.html2canvas(sheet, {
      backgroundColor: "#ffffff",
      scale: window.devicePixelRatio > 1 ? 2 : 1.5,
    });
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${exportData.fileName}.png`;
    link.click();
  } catch (error) {
    console.error("Failed to export confirmed shifts", error);
    window.alert("出力中にエラーが発生しました。時間をおいて再度お試しください。");
  } finally {
    if (sheet && sheet.parentNode) {
      sheet.remove();
    }
    exportConfirmedButton.disabled = false;
    exportConfirmedButton.textContent = originalLabel;
  }
}

function collectConfirmedShiftData() {
  const { year, month } = parseMonthInput(
    adminMonthInput.value || monthPicker.value
  );
  const label = formatMonthLabel(year, month);
  const tableRows = Array.from(
    adminTableWrapper ? adminTableWrapper.querySelectorAll("tbody tr") : []
  );
  const rowMap = new Map();

  tableRows.forEach((row) => {
    const dateKey = row.dataset.dateKey;
    if (!dateKey) return;
    const baseRow = {
      dateKey,
      displayDate: row.dataset.displayDate || formatDisplayDateFromKey(dateKey),
      notes: row.dataset.specialNote || "",
      slots: { morning: [], afternoon: [] },
      holidayName: row.dataset.holidayName || "",
    };

    row
      .querySelectorAll(".admin-slot-entry.is-confirmed")
      .forEach((button) => {
        const slotKey = button.dataset.slot;
        const labelText = button.dataset.label || button.textContent.trim();
        if (!slotKey || !labelText || !baseRow.slots[slotKey]) return;
        baseRow.slots[slotKey].push(labelText);
      });

    rowMap.set(dateKey, baseRow);
  });

  const monthDates = getAllMonthDates(year, month);
  const rows = monthDates.map((date) => {
    const dateKey = formatDateKey(date);
    const existing = rowMap.get(dateKey);
    const holidayName = getHolidayName(dateKey) || existing?.holidayName || "";
    const specialNote = existing?.notes || specialDayMap[dateKey] || "";
    const noteParts = [];
    if (holidayName) {
      noteParts.push(holidayName);
    }
    if (specialNote) {
      noteParts.push(specialNote);
    }
    return {
      dateKey,
      displayDate: existing?.displayDate || formatDisplayDate(date),
      notes: noteParts.join(" / "),
      isHoliday: Boolean(holidayName),
      isWeekend: isWeekendDate(date),
      slots: {
        morning: existing ? [...existing.slots.morning] : [],
        afternoon: existing ? [...existing.slots.afternoon] : [],
      },
    };
  });

  return {
    rows,
    label,
    fileName: `確定シフト_${label.replace(/[^0-9]/g, "")}`,
  };
}

function buildExportSheet(exportData) {
  const wrapper = document.createElement("section");
  wrapper.className = "export-sheet";
  wrapper.setAttribute("aria-hidden", "true");
  const heading = document.createElement("div");
  heading.className = "export-sheet__heading";
  heading.innerHTML = `
    <div>
      <div class="export-sheet__title">${exportData.label} シフト確定表</div>
      <div class="export-sheet__subtitle">学生プラザ3F 留学交流グループ</div>
    </div>
    <div class="export-sheet__time-note">午前：10:00-13:00 ／ 午後：13:00-17:00</div>
  `;
  wrapper.appendChild(heading);

  const table = document.createElement("table");
  table.className = "export-sheet__table";
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>日付</th>
      <th>備考</th>
      <th>午前 (10:00-13:00)</th>
      <th>午後 (13:00-17:00)</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  exportData.rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.isHoliday || row.isWeekend) {
      tr.classList.add("is-holiday");
    }
    const dateCell = document.createElement("td");
    dateCell.className = "export-sheet__date";
    dateCell.textContent = row.displayDate;
    const noteCell = document.createElement("td");
    noteCell.textContent = row.notes;
    const morningCell = document.createElement("td");
    fillSlotCell(morningCell, row.slots.morning);
    const afternoonCell = document.createElement("td");
    fillSlotCell(afternoonCell, row.slots.afternoon);

    tr.appendChild(dateCell);
    tr.appendChild(noteCell);
    tr.appendChild(morningCell);
    tr.appendChild(afternoonCell);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
}

function fillSlotCell(cell, names) {
  if (!names.length) {
    cell.textContent = "";
    return;
  }
  cell.textContent = names.join("・");
}

function formatEntryLabel(entry, includeTime = false) {
  if (includeTime && entry.start && entry.end) {
    return `${entry.name} ${entry.start}〜${entry.end}`;
  }
  return entry.name;
}

function timeToMinutes(time) {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function timeRangesOverlap(startA, endA, startB, endB) {
  const startMinutesA = timeToMinutes(startA);
  const endMinutesA = timeToMinutes(endA);
  const startMinutesB = timeToMinutes(startB);
  const endMinutesB = timeToMinutes(endB);
  if (
    [startMinutesA, endMinutesA, startMinutesB, endMinutesB].some(
      (value) => value == null
    )
  ) {
    return false;
  }
  return startMinutesA < endMinutesB && endMinutesA > startMinutesB;
}

function getWeekdays(year, month) {
  const dates = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    const day = date.getDay();
    if (day >= 1 && day <= 5) {
      dates.push(new Date(date));
    }
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

function getAllMonthDates(year, month) {
  const dates = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    dates.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

function isWeekendDate(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function formatMonthInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseMonthInput(value) {
  if (!value) {
    return parseMonthInput(formatMonthInput(new Date()));
  }
  const [year, month] = value.split("-").map(Number);
  return { year, month: month - 1 };
}

function formatMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function formatDisplayDate(date) {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${date.getMonth() + 1}/${date.getDate()} (${weekdays[date.getDay()]})`;
}

function formatDisplayDateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return formatDisplayDate(new Date(year, month - 1, day));
}

function formatMonthLabel(year, month) {
  return `${year}年${String(month + 1).padStart(2, "0")}月`;
}

async function loadHolidayData() {
  if (Object.keys(holidayMap).length) {
    return holidayMap;
  }
  try {
    const response = await fetch(HOLIDAY_API_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch holidays: ${response.status}`);
    }
    holidayMap = await response.json();
  } catch (error) {
    console.warn("Failed to load Japanese holiday data", error);
    holidayMap = {};
  }
  return holidayMap;
}

function setupTabs() {
  if (!tabButtons.length) return;
  const defaultActive = document.querySelector(".tab-button.is-active");
  if (defaultActive) {
    setActiveTab(defaultActive.dataset.tabTarget, defaultActive);
  }
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tabTarget, button);
    });
  });
}

function setActiveTab(targetId, activeButton) {
  tabButtons.forEach((button) => {
    const isActive = button === activeButton;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  tabPanels.forEach((panel) => {
    const isActive = panel.id === targetId;
    panel.classList.toggle("is-active", isActive);
    panel.setAttribute("aria-hidden", String(!isActive));
  });
}

function setupAdminSubtabs() {
  if (!adminSubtabButtons.length) return;
  const defaultActive = document.querySelector(
    ".admin-subtab-button.is-active"
  );
  if (defaultActive) {
    setActiveAdminSubtab(defaultActive.dataset.subtabTarget, defaultActive);
  }
  adminSubtabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveAdminSubtab(button.dataset.subtabTarget, button);
    });
  });
}

function setActiveAdminSubtab(targetId, activeButton) {
  adminSubtabButtons.forEach((button) => {
    const isActive = button === activeButton;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  adminSubtabPanels.forEach((panel) => {
    const isActive = panel.id === targetId;
    panel.classList.toggle("is-active", isActive);
    panel.setAttribute("aria-hidden", String(!isActive));
  });
}

async function initializeSpecialDays() {
  await refreshSpecialDays();
  renderSpecialDayList();
}

async function refreshSpecialDays() {
  try {
    const response = await apiRequest("/special-days", { method: "GET" });
    specialDayEntries = Array.isArray(response) ? response : [];
  } catch (error) {
    console.error("Failed to load special days", error);
    specialDayEntries = [];
    updateSpecialDayStatus(error.message, "#b42318");
  }
  rebuildSpecialDayMap();
}

function rebuildSpecialDayMap() {
  specialDayMap = specialDayEntries.reduce((acc, entry) => {
    acc[entry.date] = entry.note;
    return acc;
  }, {});
}

function renderSpecialDayList() {
  if (!specialDayList) return;
  if (!specialDayEntries.length) {
    specialDayList.innerHTML =
      '<li class="special-day-empty">登録された特別日はありません</li>';
    return;
  }
  const sorted = [...specialDayEntries].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  specialDayList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  sorted.forEach((entry) => {
    const item = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "special-day-list__meta";
    const dateSpan = document.createElement("span");
    dateSpan.className = "special-day-list__date";
    dateSpan.textContent = formatDisplayDateFromKey(entry.date);
    const noteSpan = document.createElement("span");
    noteSpan.textContent = entry.note;
    meta.append(dateSpan, noteSpan);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "special-day-remove";
    removeButton.dataset.action = "remove";
    removeButton.dataset.date = entry.date;
    removeButton.dataset.id = String(entry.id);
    removeButton.textContent = "削除";

    item.append(meta, removeButton);
    fragment.appendChild(item);
  });
  specialDayList.appendChild(fragment);
}

async function handleSpecialDaySubmit(event) {
  event.preventDefault();
  const date = specialDayDateInput.value;
  const note = specialDayNoteInput.value.trim();
  if (!date || !note) {
    updateSpecialDayStatus("日付とメモを入力してください", "#b42318");
    return;
  }
  const existing = specialDayEntries.find((entry) => entry.date === date);
  try {
    if (existing) {
      await apiRequest(`/special-days/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ date, note }),
      });
    } else {
      await apiRequest("/special-days", {
        method: "POST",
        body: JSON.stringify({ date, note }),
      });
    }
    await refreshSpecialDays();
    renderSpecialDayList();
    renderCalendar();
    renderAdminTable();
    updateSpecialDayStatus(existing ? "更新しました" : "追加しました");
    specialDayForm.reset();
  } catch (error) {
    console.error("Failed to save special day", error);
    updateSpecialDayStatus(error.message || API_DEFAULT_ERROR_MESSAGE, "#b42318");
  }
}

async function handleSpecialDayListClick(event) {
  const button = event.target.closest("[data-action='remove']");
  if (!button) return;
  const { id } = button.dataset;
  if (!id) return;
  try {
    await apiRequest(`/special-days/${id}`, { method: "DELETE" });
    await refreshSpecialDays();
    renderSpecialDayList();
    renderCalendar();
    renderAdminTable();
    updateSpecialDayStatus("削除しました");
  } catch (error) {
    console.error("Failed to remove special day", error);
    updateSpecialDayStatus(error.message || API_DEFAULT_ERROR_MESSAGE, "#b42318");
  }
}

function updateSpecialDayStatus(message, color = "#0f7b6c") {
  if (!specialDayStatus) return;
  specialDayStatus.textContent = message;
  specialDayStatus.style.color = color;
}

function renderPaNameList() {
  if (!paNameList) return;
  paNameList.innerHTML = "";
  if (!paNames.length) {
    const empty = document.createElement("li");
    empty.className = "pa-name-empty";
    empty.textContent = "登録されている名前はありません";
    paNameList.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  paNames.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "pa-name-item";
    item.dataset.id = String(entry.id);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "pa-name-field";
    input.value = entry.name;

    const actions = document.createElement("div");
    actions.className = "pa-name-actions";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.dataset.paNameAction = "save";
    saveButton.dataset.id = String(entry.id);
    saveButton.textContent = "保存";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.dataset.paNameAction = "remove";
    removeButton.dataset.id = String(entry.id);
    removeButton.textContent = "削除";

    actions.append(saveButton, removeButton);
    item.append(input, actions);
    fragment.appendChild(item);
  });
  paNameList.appendChild(fragment);
}

async function handlePaNameSubmit(event) {
  event.preventDefault();
  if (!paNameInput) return;
  const newName = paNameInput.value.trim();
  if (!newName) {
    updatePaNameStatus("名前を入力してください", "#b42318");
    return;
  }
  if (paNames.some((entry) => entry.name === newName)) {
    updatePaNameStatus("同じ名前が既にあります", "#b42318");
    return;
  }
  try {
    await apiRequest("/names", {
      method: "POST",
      body: JSON.stringify({ name: newName }),
    });
    await refreshPaNames();
    populateNameSelects();
    renderPaNameList();
    updatePaNameStatus("追加しました");
    paNameForm.reset();
    renderCalendar();
    renderAdminTable();
  } catch (error) {
    console.error("Failed to add PA name", error);
    updatePaNameStatus(error.message || API_DEFAULT_ERROR_MESSAGE, "#b42318");
  }
}

async function handlePaNameListClick(event) {
  const actionButton = event.target.closest("[data-pa-name-action]");
  if (!actionButton) return;
  const id = Number(actionButton.dataset.id);
  if (Number.isNaN(id)) return;
  const action = actionButton.dataset.paNameAction;
  const item = actionButton.closest(".pa-name-item");
  if (!item) return;
  const input = item.querySelector(".pa-name-field");
  if (!input) return;
  const target = paNames.find((entry) => entry.id === id);
  if (!target) {
    updatePaNameStatus("選択されたPAが見つかりません", "#b42318");
    return;
  }

  try {
    if (action === "remove") {
      await apiRequest(`/names/${id}`, { method: "DELETE" });
      await refreshPaNames();
      populateNameSelects();
      renderPaNameList();
      updatePaNameStatus("削除しました");
      renderCalendar();
      renderAdminTable();
      return;
    }

    if (action === "save") {
      const updated = input.value.trim();
      if (!updated) {
        updatePaNameStatus("名前を入力してください", "#b42318");
        return;
      }
      const isDuplicate = paNames.some(
        (entry) => entry.id !== id && entry.name === updated
      );
      if (isDuplicate) {
        updatePaNameStatus("同じ名前が既にあります", "#b42318");
        return;
      }
      await apiRequest(`/names/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name: updated }),
      });
      await refreshPaNames();
      populateNameSelects();
      renderPaNameList();
      updatePaNameStatus("更新しました");
      renderCalendar();
      renderAdminTable();
    }
  } catch (error) {
    console.error("Failed to update PA name", error);
    updatePaNameStatus(error.message || API_DEFAULT_ERROR_MESSAGE, "#b42318");
  }
}

function updatePaNameStatus(message, color = "#0f7b6c") {
  if (!paNameStatus) return;
  paNameStatus.textContent = message;
  paNameStatus.style.color = color;
}

function getHolidayName(dateKey) {
  return holidayMap[dateKey] ?? null;
}
