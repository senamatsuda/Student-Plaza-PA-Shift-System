const DEFAULT_NAMES = [
  "森",
  "松田",
  "劉",
  "長谷川",
  "中野",
  "片山",
  "黄",
  "ショーン",
  "繆",
  "張",
  "王",
  "李",
  "鄭",
];
const DEFAULT_SPECIAL_DAYS = [
  { date: "2023-11-02", note: "在留期間更新〆切" },
  { date: "2023-11-10", note: "授業振替日" },
  { date: "2023-11-20", note: "期末試験" },
  { date: "2023-11-23", note: "勤労感謝の日(休館)" },
  { date: "2023-11-27", note: "補講日" },
];
const SHIFT_TEMPLATES = {
  morning: { label: "午前", start: "10:00", end: "13:00" },
  afternoon: { label: "午後", start: "13:00", end: "17:00" },
  fullday: { label: "1日", start: "10:00", end: "17:00" },
  unavailable: { label: "勤務不可", start: null, end: null },
};
const MORNING_RANGE = { start: "10:00", end: "13:00" };
const AFTERNOON_RANGE = { start: "13:00", end: "17:00" };
const HOLIDAY_API_URL = "https://holidays-jp.github.io/api/v1/date.json";
const SPECIAL_DAY_STORAGE_KEY = "pa-special-days";
const NAME_STORAGE_KEY = "pa-name-list";
const SUBMISSION_STORAGE_KEY = "pa-shifts";
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

init();

async function init() {
  initializePaNames();
  const now = new Date();
  const currentMonthValue = formatMonthInput(now);
  monthPicker.value = currentMonthValue;
  adminMonthInput.value = currentMonthValue;
  setupTabs();
  setupAdminSubtabs();
  await loadHolidayData();
  initializeSpecialDays();
  renderCalendar();
  form.addEventListener("submit", handleSubmit);
  monthPicker.addEventListener("change", renderCalendar);
  studentNameSelect.addEventListener("change", renderCalendar);
  adminRefreshButton.addEventListener("click", renderAdminTable);
  adminMonthInput.addEventListener("change", renderAdminTable);
  adminNameFilter.addEventListener("change", renderAdminTable);
  if (adminTableWrapper) {
    adminTableWrapper.addEventListener("click", handleAdminTableClick);
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

function initializePaNames() {
  paNames = loadPaNames();
  if (!paNames.length) {
    paNames = [...DEFAULT_NAMES];
    savePaNames();
  }
  populateNameSelects();
  renderPaNameList();
}

function loadPaNames() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NAME_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((name) => String(name).trim())
      .filter((name) => name.length > 0);
  } catch (error) {
    console.warn("Failed to load names", error);
    return [];
  }
}

function savePaNames() {
  localStorage.setItem(NAME_STORAGE_KEY, JSON.stringify(paNames));
}

function populateNameSelects() {
  const previousStudent = studentNameSelect.value;
  const previousAdminSelection = new Set(
    Array.from(adminNameFilter.selectedOptions).map((option) => option.value)
  );

  studentNameSelect.innerHTML = paNames
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("");
  if (paNames.includes(previousStudent)) {
    studentNameSelect.value = previousStudent;
  }

  adminNameFilter.innerHTML = paNames
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

  const savedEntries = loadSubmissions().filter(
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

function handleSubmit(event) {
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

  const existing = loadSubmissions();
  const monthKey = entries[0].monthKey;
  const filtered = existing.filter(
    (entry) => !(entry.name === name && entry.monthKey === monthKey)
  );
  const nextData = [...filtered, ...entries];
  saveSubmissions(nextData);
  formStatus.textContent = "提出しました";
  formStatus.style.color = "#0f7b6c";
  renderAdminTable();
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

function loadSubmissions() {
  try {
    return JSON.parse(localStorage.getItem(SUBMISSION_STORAGE_KEY) ?? "[]");
  } catch (error) {
    console.error("Failed to parse submissions", error);
    return [];
  }
}

function saveSubmissions(data) {
  localStorage.setItem(SUBMISSION_STORAGE_KEY, JSON.stringify(data));
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
  const submissions = loadSubmissions().filter(
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

function formatEntryLabel(entry, includeTime = false) {
  if (includeTime && entry.start && entry.end) {
    return `${entry.name} (${entry.start}〜${entry.end})`;
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

function initializeSpecialDays() {
  specialDayEntries = loadSpecialDayEntries();
  if (!specialDayEntries.length) {
    specialDayEntries = [...DEFAULT_SPECIAL_DAYS];
    saveSpecialDayEntries();
  }
  rebuildSpecialDayMap();
  renderSpecialDayList();
}

function loadSpecialDayEntries() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SPECIAL_DAY_STORAGE_KEY) ?? "[]"
    );
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => entry?.date && entry?.note)
      .map((entry) => ({ date: entry.date, note: entry.note }));
  } catch (error) {
    console.warn("Failed to load special days", error);
    return [];
  }
}

function saveSpecialDayEntries() {
  localStorage.setItem(
    SPECIAL_DAY_STORAGE_KEY,
    JSON.stringify(specialDayEntries)
  );
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
    removeButton.textContent = "削除";

    item.append(meta, removeButton);
    fragment.appendChild(item);
  });
  specialDayList.appendChild(fragment);
}

function handleSpecialDaySubmit(event) {
  event.preventDefault();
  const date = specialDayDateInput.value;
  const note = specialDayNoteInput.value.trim();
  if (!date || !note) {
    updateSpecialDayStatus("日付とメモを入力してください", "#b42318");
    return;
  }
  const existingIndex = specialDayEntries.findIndex(
    (entry) => entry.date === date
  );
  const payload = { date, note };
  if (existingIndex >= 0) {
    specialDayEntries[existingIndex] = payload;
  } else {
    specialDayEntries.push(payload);
  }
  saveSpecialDayEntries();
  rebuildSpecialDayMap();
  renderSpecialDayList();
  renderCalendar();
  renderAdminTable();
  updateSpecialDayStatus(existingIndex >= 0 ? "更新しました" : "追加しました");
  specialDayForm.reset();
}

function handleSpecialDayListClick(event) {
  const button = event.target.closest("[data-action='remove']");
  if (!button) return;
  const { date } = button.dataset;
  specialDayEntries = specialDayEntries.filter((entry) => entry.date !== date);
  saveSpecialDayEntries();
  rebuildSpecialDayMap();
  renderSpecialDayList();
  renderCalendar();
  renderAdminTable();
  updateSpecialDayStatus("削除しました");
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
  paNames.forEach((name, index) => {
    const item = document.createElement("li");
    item.className = "pa-name-item";
    item.dataset.index = String(index);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "pa-name-field";
    input.value = name;

    const actions = document.createElement("div");
    actions.className = "pa-name-actions";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.dataset.paNameAction = "save";
    saveButton.dataset.index = String(index);
    saveButton.textContent = "保存";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.dataset.paNameAction = "remove";
    removeButton.dataset.index = String(index);
    removeButton.textContent = "削除";

    actions.append(saveButton, removeButton);
    item.append(input, actions);
    fragment.appendChild(item);
  });
  paNameList.appendChild(fragment);
}

function handlePaNameSubmit(event) {
  event.preventDefault();
  if (!paNameInput) return;
  const newName = paNameInput.value.trim();
  if (!newName) {
    updatePaNameStatus("名前を入力してください", "#b42318");
    return;
  }
  if (paNames.includes(newName)) {
    updatePaNameStatus("同じ名前が既にあります", "#b42318");
    return;
  }
  paNames.push(newName);
  savePaNames();
  populateNameSelects();
  renderPaNameList();
  updatePaNameStatus("追加しました");
  paNameForm.reset();
  renderAdminTable();
}

function handlePaNameListClick(event) {
  const actionButton = event.target.closest("[data-pa-name-action]");
  if (!actionButton) return;
  const index = Number(actionButton.dataset.index);
  if (Number.isNaN(index)) return;
  const action = actionButton.dataset.paNameAction;
  const item = actionButton.closest(".pa-name-item");
  if (!item) return;
  const input = item.querySelector(".pa-name-field");
  if (!input) return;

  if (action === "remove") {
    paNames.splice(index, 1);
    savePaNames();
    populateNameSelects();
    renderPaNameList();
    updatePaNameStatus("削除しました");
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
      (name, idx) => idx !== index && name === updated
    );
    if (isDuplicate) {
      updatePaNameStatus("同じ名前が既にあります", "#b42318");
      return;
    }
    paNames[index] = updated;
    savePaNames();
    populateNameSelects();
    renderPaNameList();
    updatePaNameStatus("更新しました");
    renderAdminTable();
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
