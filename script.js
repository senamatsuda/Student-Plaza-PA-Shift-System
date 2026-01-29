const SHIFT_TEMPLATES = {
  morning: { label: "午前", start: "10:00", end: "13:00" },
  afternoon: { label: "午後", start: "13:00", end: "17:00" },
  fullday: { label: "1日", start: "10:00", end: "17:00" },
  unavailable: { label: "勤務不可", start: null, end: null },
};
const MORNING_RANGE = { start: "10:00", end: "13:00" };
const AFTERNOON_RANGE = { start: "13:00", end: "17:00" };
const HOLIDAY_API_URL = "https://holidays-jp.github.io/api/v1/date.json";
const DEFAULT_PA_NAMES = [
  { id: 1, name: "森" },
  { id: 2, name: "松田" },
  { id: 3, name: "劉" },
  { id: 4, name: "中野" },
  { id: 5, name: "長谷川" },
  { id: 6, name: "片山" },
  { id: 7, name: "王" },
  { id: 8, name: "李" },
  { id: 9, name: "穆" },
  { id: 10, name: "張" },
  { id: 11, name: "黄" },
  { id: 12, name: "鄭" },
  { id: 13, name: "ショーン" },
];
const LOCAL_STORAGE_KEYS = {
  names: "paShiftNames",
  specialDays: "paShiftSpecialDays",
  submissions: "paShiftSubmissions",
  confirmedShifts: "paShiftConfirmedShifts",
  workdayAvailability: "paShiftWorkdayAvailability",
};
const ID_COUNTER_KEYS = {
  names: "paShiftNamesNextId",
  specialDays: "paShiftSpecialDaysNextId",
};
const STORAGE_ERROR_MESSAGE =
  "ブラウザに保存できませんでした。ストレージ設定を確認してください。";
const storageBackend = createStorageBackend();
const isEphemeralStorage = storageBackend.type !== "localStorage";
const remoteSyncClient = createRemoteSyncClient();
const REMOTE_KEEPALIVE_INTERVAL_MS = 14 * 60 * 1000;
const remoteSyncState = { lastPull: null, lastPush: null, isConnected: false };
let remotePushTimeoutId = null;
let remotePushInFlight = false;
let remoteKeepAliveTimerId = null;

let submissionEntries = [];
let holidayMap = {};
let specialDayEntries = [];
let specialDayMap = {};
let paNames = [];
let confirmedShiftMap = {};
let workdayAvailabilityEntries = [];
let workdayAvailabilityMap = {};

const monthPicker = document.getElementById("monthPicker");
const calendarContainer = document.getElementById("calendar");
const form = document.getElementById("shiftForm");
const formStatus = document.getElementById("formStatus");
const studentNameSelect = document.getElementById("studentName");
const adminTableWrapper = document.getElementById("adminTableWrapper");
const confirmedSummaryWrapper = document.getElementById(
  "confirmedSummaryWrapper"
);
const autoArrangeButton = document.getElementById("autoArrangeShifts");
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
const workdayAvailabilityList = document.getElementById(
  "workdayAvailabilityList"
);
const workdayAvailabilityStatus = document.getElementById(
  "workdayAvailabilityStatus"
);
const workdayAvailabilityMonth = document.getElementById(
  "workdayAvailabilityMonth"
);
const workdayAvailabilityMonthSelect = document.getElementById(
  "workdayAvailabilityMonthSelect"
);
const paNameForm = document.getElementById("paNameForm");
const paNameInput = document.getElementById("paNameInput");
const paNameStatus = document.getElementById("paNameStatus");
const paNameList = document.getElementById("paNameList");
const syncStatus = document.getElementById("syncStatus");
const submitButton = form?.querySelector("button[type=\"submit\"]");

const RENDER_UNAVAILABLE_MESSAGE =
  "Render と接続できないため、シフトを提出できません。";

const template = document.getElementById("shiftRowTemplate");
const WORKDAY_MONTH_OPTION_COUNT = 12;

let selectedWorkdayAvailabilityMonth = "";

function createStorageBackend() {
  try {
    const storage = window.localStorage;
    const testKey = "__pa_shift_storage_test__";
    storage.setItem(testKey, "ok");
    storage.removeItem(testKey);
    return {
      type: "localStorage",
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    };
  } catch (error) {
    console.warn(
      "localStorage is unavailable. Falling back to in-memory storage.",
      error
    );
    const memoryStore = {};
    return {
      type: "memory",
      getItem: (key) =>
        Object.prototype.hasOwnProperty.call(memoryStore, key)
          ? memoryStore[key]
          : null,
      setItem: (key, value) => {
        memoryStore[key] = value;
      },
      removeItem: (key) => {
        delete memoryStore[key];
      },
    };
  }
}

function storageGetItem(key) {
  try {
    return storageBackend.getItem(key);
  } catch (error) {
    console.warn("Failed to read storage", error);
    return null;
  }
}

function storageSetItem(key, value) {
  try {
    storageBackend.setItem(key, value);
  } catch (error) {
    console.error("Failed to write storage", error);
    throw new Error(STORAGE_ERROR_MESSAGE);
  }
}

function readStorageArray(key, fallback = []) {
  const raw = storageGetItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    console.warn("Failed to parse stored data", error);
    return fallback;
  }
}

function writeStorageArray(key, value) {
  storageSetItem(key, JSON.stringify(value));
}

function loadConfirmedShiftMap() {
  const raw = storageGetItem(LOCAL_STORAGE_KEYS.confirmedShifts);
  if (!raw) {
    confirmedShiftMap = {};
    return;
  }
  try {
    confirmedShiftMap = sanitizeConfirmedShiftMap(JSON.parse(raw));
  } catch (error) {
    console.warn("Failed to parse confirmed shift data", error);
    confirmedShiftMap = {};
  }
}

function persistConfirmedShiftMap() {
  try {
    storageSetItem(
      LOCAL_STORAGE_KEYS.confirmedShifts,
      JSON.stringify(confirmedShiftMap)
    );
    scheduleRemotePush();
  } catch (error) {
    console.error("Failed to persist confirmed shifts", error);
  }
}

function updateConfirmedShiftState(monthKey, entryKey, isConfirmed) {
  if (!monthKey || !entryKey) return;
  if (!confirmedShiftMap[monthKey]) {
    if (!isConfirmed) {
      return;
    }
    confirmedShiftMap[monthKey] = {};
  }
  if (isConfirmed) {
    confirmedShiftMap[monthKey][entryKey] = true;
  } else {
    delete confirmedShiftMap[monthKey][entryKey];
    if (!Object.keys(confirmedShiftMap[monthKey]).length) {
      delete confirmedShiftMap[monthKey];
    }
  }
  persistConfirmedShiftMap();
}

function sanitizeConfirmedShiftMap(data) {
  if (!data || typeof data !== "object") {
    return {};
  }
  return Object.entries(data).reduce((acc, [monthKey, entries]) => {
    if (!entries || typeof entries !== "object") {
      return acc;
    }
    const sanitizedEntries = Object.entries(entries).reduce(
      (entryAcc, [entryKey, value]) => {
        if (value) {
          entryAcc[entryKey] = true;
        }
        return entryAcc;
      },
      {}
    );
    if (Object.keys(sanitizedEntries).length) {
      acc[monthKey] = sanitizedEntries;
    }
    return acc;
  }, {});
}

function getNextStorageId(type) {
  const key = ID_COUNTER_KEYS[type];
  if (!key) {
    return Date.now();
  }
  const current = Number(storageGetItem(key)) || 1;
  const nextValue = current + 1;
  storageSetItem(key, String(nextValue));
  return current;
}

function syncStorageCounter(type, items) {
  const key = ID_COUNTER_KEYS[type];
  if (!key) {
    return;
  }
  const maxId = items.reduce((max, entry) => {
    const value = Number(entry.id);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  const current = Number(storageGetItem(key)) || 1;
  const nextValue = Math.max(current, maxId + 1);
  storageSetItem(key, String(nextValue));
}

init().catch((error) => {
  console.error("Failed to initialize application", error);
  if (formStatus) {
    formStatus.textContent = STORAGE_ERROR_MESSAGE;
    formStatus.style.color = "#b42318";
  }
});

async function init() {
  if (remoteSyncClient) {
    setRemoteConnectionStatus(false);
    await syncRemoteDataFromServer();
    startRemoteKeepAlive();
  } else {
    remoteSyncState.isConnected = true;
    updateSyncStatus(
      "リモートAPIが設定されていないため、このブラウザ内にのみデータが保存されます。",
      "warning"
    );
    updateSubmitAvailability();
  }

  await initializePaNames();
  const nextMonthDate = getNextMonthDate();
  const nextMonthValue = formatMonthInput(nextMonthDate);
  monthPicker.value = nextMonthValue;
  adminMonthInput.value = nextMonthValue;
  setupTabs();
  setupAdminSubtabs();
  await loadHolidayData();
  await initializeSpecialDays();
  await initializeWorkdayAvailability();
  await refreshSubmissions();
  loadConfirmedShiftMap();
  renderCalendar();
  if (isEphemeralStorage && formStatus) {
    formStatus.textContent =
      "注意: このブラウザではデータが一時的にしか保存されません。";
    formStatus.style.color = "#b54708";
  }
  form.addEventListener("submit", handleSubmit);
  monthPicker.addEventListener("change", renderCalendar);
  studentNameSelect.addEventListener("change", renderCalendar);
  if (autoArrangeButton) {
    autoArrangeButton.addEventListener("click", handleAutoArrange);
  }
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
  if (workdayAvailabilityList) {
    workdayAvailabilityList.addEventListener(
      "change",
      handleWorkdayAvailabilityChange
    );
  }
  if (workdayAvailabilityMonthSelect) {
    workdayAvailabilityMonthSelect.addEventListener(
      "change",
      handleWorkdayAvailabilityMonthChange
    );
  }
  if (paNameForm) {
    paNameForm.addEventListener("submit", handlePaNameSubmit);
  }
  if (paNameList) {
    paNameList.addEventListener("click", handlePaNameListClick);
  }
  window.addEventListener("online", handleOnlineStatusChange);
  window.addEventListener("offline", handleOfflineStatusChange);
  renderAdminTable();
}

async function initializePaNames() {
  await refreshPaNames();
  populateNameSelects();
  renderPaNameList();
}

async function refreshPaNames() {
  const storedRaw = storageGetItem(LOCAL_STORAGE_KEYS.names);
  const stored = readStorageArray(LOCAL_STORAGE_KEYS.names);

  const normalizedDefaults = DEFAULT_PA_NAMES.map((entry, index) => ({
    id: Number.isFinite(Number(entry.id)) ? Number(entry.id) : index + 1,
    name: entry.name?.trim() || "",
  })).filter((entry) => Boolean(entry.name));

  const normalizedStored = stored
    .map((entry, index) => {
      const id = Number(entry.id);
      return {
        id: Number.isFinite(id) ? id : index + 1,
        name: entry.name?.trim() || "",
      };
    })
    .filter((entry) => Boolean(entry.name));

  let nextId = Math.max(
    0,
    ...normalizedDefaults
      .map((entry) => entry.id)
      .filter((id) => Number.isFinite(Number(id))),
    ...normalizedStored
      .map((entry) => entry.id)
      .filter((id) => Number.isFinite(Number(id)))
  );

  const mergedByName = new Map();
  normalizedDefaults.forEach((entry) => {
    mergedByName.set(entry.name, { ...entry });
  });

  normalizedStored.forEach((entry) => {
    const existing = mergedByName.get(entry.name);
    if (existing) {
      const id = Number.isFinite(entry.id) ? entry.id : existing.id;
      mergedByName.set(entry.name, { id, name: entry.name });
      return;
    }
    const id = Number.isFinite(entry.id) ? entry.id : ++nextId;
    mergedByName.set(entry.name, { id, name: entry.name });
  });

  paNames = Array.from(mergedByName.values());
  paNames.sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const serialized = JSON.stringify(paNames);
  if (serialized !== storedRaw) {
    persistPaNames();
  }

  syncStorageCounter("names", paNames);
}

function persistPaNames() {
  writeStorageArray(LOCAL_STORAGE_KEYS.names, paNames);
  scheduleRemotePush();
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
    const isAvailable = resolveWorkdayAvailability(dateKey, holidayName);
    const specialNote = specialDayMap[dateKey];
    const noteTexts = [];
    if (holidayName) {
      noteTexts.push(`${holidayName}（祝日）`);
    }
    if (!holidayName && !isAvailable) {
      noteTexts.push("出勤なし");
    }
    if (specialNote) {
      noteTexts.push(specialNote);
      clone.classList.add("special-day");
    }
    const disableRow = (label) => {
      shiftSelect.disabled = true;
      shiftSelect.innerHTML = `<option value="">${label}</option>`;
      customStart.disabled = true;
      customEnd.disabled = true;
      clone.setAttribute("aria-disabled", "true");
    };

    noteLabel.textContent = noteTexts.join(" / ");
    noteLabel.hidden = noteTexts.length === 0;
    const isHoliday = Boolean(holidayName);
    if (isHoliday) {
      clone.classList.add("is-holiday");
      disableRow("祝日");
    } else if (!isAvailable) {
      clone.classList.add("is-unavailable-day");
      disableRow("出勤なし");
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

    if (savedEntry && !isHoliday && isAvailable) {
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
  if (remoteSyncClient) {
    const canSubmit = await ensureRemoteConnection();
    if (!canSubmit) {
      formStatus.textContent = RENDER_UNAVAILABLE_MESSAGE;
      formStatus.style.color = "#b42318";
      return;
    }
  }
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
    saveSubmissionEntries(name, monthKey, entries);
    formStatus.textContent = "提出しました";
    formStatus.style.color = "#0f7b6c";
    await refreshSubmissions();
    renderCalendar();
    renderAdminTable();
  } catch (error) {
    console.error("Failed to submit shifts", error);
    const message = error?.message || STORAGE_ERROR_MESSAGE;
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
  const stored = readStorageArray(LOCAL_STORAGE_KEYS.submissions);
  submissionEntries = stored.filter((entry) =>
    Boolean(
      entry &&
        typeof entry.name === "string" &&
        typeof entry.date === "string" &&
        typeof entry.monthKey === "string" &&
        typeof entry.shiftType === "string"
    )
  );
}

function saveSubmissionEntries(name, monthKey, entries) {
  submissionEntries = submissionEntries.filter(
    (entry) => !(entry.name === name && entry.monthKey === monthKey)
  );
  submissionEntries.push(...entries);
  persistSubmissions();
}

function persistSubmissions() {
  writeStorageArray(LOCAL_STORAGE_KEYS.submissions, submissionEntries);
  scheduleRemotePush();
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
  const confirmedEntries = confirmedShiftMap[monthKey] || {};
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
      const slotContainer = document.createElement("div");
      slotContainer.className = "admin-slot-items";

      if (items.length) {
        items.forEach((item) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "admin-slot-entry";
          button.textContent = item.label;
          button.dataset.date = item.date;
          button.dataset.slot = item.slot || slotKey;
          button.dataset.name = item.name;
          button.dataset.label = item.label;
          button.dataset.monthKey = monthKey;
          const entryKey = buildConfirmedEntryKey(item);
          button.dataset.entryKey = entryKey;
          const isConfirmed = Boolean(confirmedEntries[entryKey]);
          if (isConfirmed) {
            button.classList.add("is-confirmed");
          }
          button.setAttribute("aria-pressed", String(isConfirmed));
          slotContainer.appendChild(button);
        });
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "admin-slot-placeholder";
        placeholder.textContent = "--";
        slotContainer.appendChild(placeholder);
      }

      cell.appendChild(slotContainer);
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  adminTableWrapper.appendChild(table);

  renderConfirmedSummaryTable();
}

function renderConfirmedSummaryTable() {
  if (!confirmedSummaryWrapper) return;

  const { year, month } = parseMonthInput(
    adminMonthInput.value || monthPicker.value
  );
  const monthKey = formatMonthKey(year, month);
  const summaryRows = buildConfirmedSummary(monthKey);

  confirmedSummaryWrapper.innerHTML = "";

  if (!summaryRows.length) {
    confirmedSummaryWrapper.textContent = "確定済みのシフトがありません。";
    return;
  }

  const table = document.createElement("table");
  table.className = "admin-table admin-table--summary";
  table.innerHTML = `
    <thead>
      <tr>
        <th>名前</th>
        <th>午前</th>
        <th>午後</th>
        <th>合計</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  summaryRows.forEach((row) => {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.textContent = row.name;
    const morningCell = document.createElement("td");
    morningCell.textContent = row.morning;
    const afternoonCell = document.createElement("td");
    afternoonCell.textContent = row.afternoon;
    const totalCell = document.createElement("td");
    totalCell.textContent = row.total;
    tr.appendChild(nameCell);
    tr.appendChild(morningCell);
    tr.appendChild(afternoonCell);
    tr.appendChild(totalCell);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  confirmedSummaryWrapper.appendChild(table);
}

function buildConfirmedSummary(monthKey) {
  const entries = confirmedShiftMap[monthKey];
  if (!entries) return [];

  const counts = {};

  Object.keys(entries).forEach((entryKey) => {
    const parsed = parseConfirmedEntryKey(entryKey);
    if (!parsed) return;
    if (parsed.slot !== "morning" && parsed.slot !== "afternoon") return;
    const targetName = parsed.name || "(名前未設定)";
    if (!counts[targetName]) {
      counts[targetName] = { name: targetName, morning: 0, afternoon: 0 };
    }
    counts[targetName][parsed.slot] += 1;
  });

  return Object.values(counts)
    .map((row) => ({ ...row, total: row.morning + row.afternoon }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function parseConfirmedEntryKey(entryKey) {
  if (!entryKey) return null;
  const [date, slot, name, label, start, end, shiftType] = entryKey.split("|");
  if (!date || !slot || !name) {
    return null;
  }
  return { date, slot, name, label, start, end, shiftType };
}

async function handleAutoArrange() {
  if (!autoArrangeButton) return;

  const { year, month } = parseMonthInput(
    adminMonthInput.value || monthPicker.value
  );
  const monthKey = formatMonthKey(year, month);
  const weekdays = getWeekdays(year, month);

  if (!weekdays.length) {
    window.alert("対象月の平日が見つかりません");
    return;
  }

  const originalLabel = autoArrangeButton.textContent;
  autoArrangeButton.disabled = true;
  autoArrangeButton.textContent = "自動作成中...";

  try {
    await refreshSubmissions();
    const { slotEntries, availabilityCount } = buildSlotEntriesForMonth(
      monthKey,
      weekdays
    );

    const hasCandidates = slotEntries.some((slot) => slot.items.length);
    if (!hasCandidates) {
      window.alert("提出データがないため自動で組めませんでした");
      return;
    }

    const autoConfirmNames = new Set(
      Object.entries(availabilityCount)
        .filter(([, count]) => count > 0 && count <= 3)
        .map(([name]) => name)
    );

    confirmedShiftMap[monthKey] = {};
    const slotConfirmed = new Set();
    const confirmedCounts = {};
    const confirmItem = (item) => {
      const entryKey = buildConfirmedEntryKey(item);
      confirmedShiftMap[monthKey][entryKey] = true;
      slotConfirmed.add(`${item.date}|${item.slot}`);
      confirmedCounts[item.name] = (confirmedCounts[item.name] || 0) + 1;
    };

    slotEntries.forEach((slot) => {
      slot.items.forEach((item) => {
        if (autoConfirmNames.has(item.name)) {
          confirmItem(item);
        }
      });
    });

    slotEntries.forEach((slot) => {
      const slotKey = `${slot.dateKey}|${slot.slotKey}`;
      if (slotConfirmed.has(slotKey)) {
        return;
      }
      const candidates = slot.items.filter(
        (item) => !autoConfirmNames.has(item.name)
      );
      if (!candidates.length) {
        return;
      }

      candidates.sort((a, b) => {
        const countA = confirmedCounts[a.name] || 0;
        const countB = confirmedCounts[b.name] || 0;
        if (countA !== countB) return countA - countB;
        const availabilityA = availabilityCount[a.name] || 0;
        const availabilityB = availabilityCount[b.name] || 0;
        if (availabilityA !== availabilityB) return availabilityA - availabilityB;
        return a.name.localeCompare(b.name, "ja");
      });

      confirmItem(candidates[0]);
    });

    persistConfirmedShiftMap();
    renderAdminTable();
    window.alert(
      "自動でシフトを組みました。必要に応じてAdminページで調整してください。"
    );
  } catch (error) {
    console.error("Failed to auto-arrange shifts", error);
    window.alert("自動シフト組み立てに失敗しました。入力データを確認してください。");
  } finally {
    autoArrangeButton.disabled = false;
    autoArrangeButton.textContent = originalLabel;
  }
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

function buildSlotEntriesForMonth(monthKey, weekdays) {
  const submissions = submissionEntries.filter((entry) =>
    entry.monthKey === monthKey
  );
  const grouped = groupByDate(submissions);
  const slotEntries = [];

  weekdays.forEach((date) => {
    const dateKey = formatDateKey(date);
    const dayEntries = grouped[dateKey] ?? createEmptyEntryGroup();
    slotEntries.push({
      dateKey,
      slotKey: "morning",
      items: buildSlotItems(dayEntries, MORNING_RANGE, "morning"),
    });
    slotEntries.push({
      dateKey,
      slotKey: "afternoon",
      items: buildSlotItems(dayEntries, AFTERNOON_RANGE, "afternoon"),
    });
  });

  const availabilityCount = {};
  slotEntries.forEach((slot) => {
    slot.items.forEach((item) => {
      availabilityCount[item.name] = (availabilityCount[item.name] || 0) + 1;
    });
  });

  return { slotEntries, availabilityCount };
}

function buildSlotItems(entries, range, slotKey) {
  const items = [];
  const pushEntry = (entry, label) => {
    items.push({
      label,
      name: entry.name,
      date: entry.date,
      slot: slotKey,
      start: entry.start || "",
      end: entry.end || "",
      shiftType: entry.shiftType || "",
    });
  };
  entries[slotKey].forEach((entry) => {
    pushEntry(entry, entry.name);
  });
  entries.fullday.forEach((entry) => {
    pushEntry(entry, entry.name);
  });
  entries.other.forEach((entry) => {
    const overlap = calculateTimeOverlapRange(
      entry.start,
      entry.end,
      range.start,
      range.end
    );
    if (!overlap) {
      return;
    }
    const coversFullSlot = entryCoversSlotRange(entry, range);
    const label = coversFullSlot
      ? entry.name
      : `${entry.name}(${overlap.start}-${overlap.end})`;
    pushEntry(entry, label);
  });
  return items;
}

function buildConfirmedEntryKey(item) {
  return [
    item.date,
    item.slot,
    item.name,
    item.label,
    item.start || "",
    item.end || "",
    item.shiftType || "",
  ].join("|");
}

function handleAdminTableClick(event) {
  const entryButton = event.target.closest(".admin-slot-entry");
  if (!entryButton) return;
  const isConfirmed = entryButton.classList.toggle("is-confirmed");
  entryButton.setAttribute("aria-pressed", String(isConfirmed));
  updateConfirmedShiftState(
    entryButton.dataset.monthKey,
    entryButton.dataset.entryKey,
    isConfirmed
  );
  renderConfirmedSummaryTable();
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
      <div class="export-sheet__title">${exportData.label} シフト表</div>
      <div class="export-sheet__subtitle">学生プラザ3F PA</div>
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

function minutesToTimeString(minutes) {
  if (!Number.isFinite(minutes)) return "";
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function calculateTimeOverlapRange(startA, endA, startB, endB) {
  const startMinutesA = timeToMinutes(startA);
  const endMinutesA = timeToMinutes(endA);
  const startMinutesB = timeToMinutes(startB);
  const endMinutesB = timeToMinutes(endB);
  if (
    [startMinutesA, endMinutesA, startMinutesB, endMinutesB].some(
      (value) => value == null
    )
  ) {
    return null;
  }
  const overlapStart = Math.max(startMinutesA, startMinutesB);
  const overlapEnd = Math.min(endMinutesA, endMinutesB);
  if (overlapStart >= overlapEnd) {
    return null;
  }
  return {
    start: minutesToTimeString(overlapStart),
    end: minutesToTimeString(overlapEnd),
  };
}

function entryCoversSlotRange(entry, slotRange) {
  const entryStart = timeToMinutes(entry.start);
  const entryEnd = timeToMinutes(entry.end);
  const slotStart = timeToMinutes(slotRange.start);
  const slotEnd = timeToMinutes(slotRange.end);
  if (
    [entryStart, entryEnd, slotStart, slotEnd].some((value) => value == null)
  ) {
    return false;
  }
  return entryStart <= slotStart && entryEnd >= slotEnd;
}

function timeToMinutes(time) {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
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

function getNextMonthDate(baseDate = new Date()) {
  return new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);
}

function formatMonthInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseMonthInput(value) {
  if (!value) {
    return parseMonthInput(formatMonthInput(getNextMonthDate()));
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
  const stored = readStorageArray(LOCAL_STORAGE_KEYS.specialDays);
  specialDayEntries = stored
    .map((entry, index) => {
      const id = Number(entry.id);
      return {
        id: Number.isFinite(id) ? id : index + 1,
        date: entry.date,
        note: entry.note?.trim() || "",
      };
    })
    .filter((entry) => Boolean(entry.date && entry.note));
  syncStorageCounter("specialDays", specialDayEntries);
  rebuildSpecialDayMap();
}

function persistSpecialDays() {
  writeStorageArray(LOCAL_STORAGE_KEYS.specialDays, specialDayEntries);
  scheduleRemotePush();
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
      existing.note = note;
    } else {
      const id = getNextStorageId("specialDays");
      specialDayEntries.push({ id, date, note });
    }
    persistSpecialDays();
    await refreshSpecialDays();
    renderSpecialDayList();
    renderCalendar();
    renderAdminTable();
    updateSpecialDayStatus(existing ? "更新しました" : "追加しました");
    specialDayForm.reset();
  } catch (error) {
    console.error("Failed to save special day", error);
    updateSpecialDayStatus(error.message || STORAGE_ERROR_MESSAGE, "#b42318");
  }
}

async function handleSpecialDayListClick(event) {
  const button = event.target.closest("[data-action='remove']");
  if (!button) return;
  const { id } = button.dataset;
  if (!id) return;
  try {
    specialDayEntries = specialDayEntries.filter(
      (entry) => String(entry.id) !== String(id)
    );
    persistSpecialDays();
    await refreshSpecialDays();
    renderSpecialDayList();
    renderCalendar();
    renderAdminTable();
    updateSpecialDayStatus("削除しました");
  } catch (error) {
    console.error("Failed to remove special day", error);
    updateSpecialDayStatus(error.message || STORAGE_ERROR_MESSAGE, "#b42318");
  }
}

function updateSpecialDayStatus(message, color = "#0f7b6c") {
  if (!specialDayStatus) return;
  specialDayStatus.textContent = message;
  specialDayStatus.style.color = color;
}

async function initializeWorkdayAvailability() {
  await refreshWorkdayAvailability();
  buildWorkdayAvailabilityMonthOptions();
  const defaultMonth = formatMonthInput(getNextMonthDate());
  setSelectedWorkdayAvailabilityMonth(defaultMonth);
}

async function refreshWorkdayAvailability() {
  const stored = readStorageArray(LOCAL_STORAGE_KEYS.workdayAvailability);
  const byDate = new Map();
  stored.forEach((entry) => {
    if (!entry || typeof entry.date !== "string") {
      return;
    }
    const date = entry.date;
    byDate.set(date, { date, isAvailable: Boolean(entry.isAvailable) });
  });
  workdayAvailabilityEntries = Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  rebuildWorkdayAvailabilityMap();
}

function persistWorkdayAvailability() {
  writeStorageArray(
    LOCAL_STORAGE_KEYS.workdayAvailability,
    workdayAvailabilityEntries
  );
  scheduleRemotePush();
}

function rebuildWorkdayAvailabilityMap() {
  workdayAvailabilityMap = workdayAvailabilityEntries.reduce((acc, entry) => {
    acc[entry.date] = Boolean(entry.isAvailable);
    return acc;
  }, {});
}

function ensureWorkdayAvailabilityDefaults(year, month) {
  const weekdays = getWeekdays(year, month);
  if (!weekdays.length) return false;
  let changed = false;

  weekdays.forEach((date) => {
    const dateKey = formatDateKey(date);
    const holidayName = getHolidayName(dateKey);
    const defaultAvailable = !holidayName;
    const existingIndex = workdayAvailabilityEntries.findIndex(
      (entry) => entry.date === dateKey
    );

    if (existingIndex === -1) {
      workdayAvailabilityEntries.push({
        date: dateKey,
        isAvailable: defaultAvailable,
      });
      changed = true;
      return;
    }

    if (holidayName && workdayAvailabilityEntries[existingIndex].isAvailable) {
      workdayAvailabilityEntries[existingIndex].isAvailable = false;
      changed = true;
    }
  });

  if (changed) {
    rebuildWorkdayAvailabilityMap();
  }
  return changed;
}

function buildWorkdayAvailabilityMonthOptions() {
  if (!workdayAvailabilityMonthSelect) return;
  workdayAvailabilityMonthSelect.innerHTML = "";
  const baseDate = new Date();
  for (let offset = 1; offset <= WORKDAY_MONTH_OPTION_COUNT; offset += 1) {
    const date = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth() + offset,
      1
    );
    const option = document.createElement("option");
    option.value = formatMonthInput(date);
    option.textContent = formatMonthLabel(date.getFullYear(), date.getMonth());
    workdayAvailabilityMonthSelect.appendChild(option);
  }
}

function getSelectedWorkdayAvailabilityMonth() {
  if (workdayAvailabilityMonthSelect?.value) {
    return workdayAvailabilityMonthSelect.value;
  }
  if (selectedWorkdayAvailabilityMonth) {
    return selectedWorkdayAvailabilityMonth;
  }
  return formatMonthInput(getNextMonthDate());
}

function setSelectedWorkdayAvailabilityMonth(value) {
  if (!value) return;
  selectedWorkdayAvailabilityMonth = value;
  if (workdayAvailabilityMonthSelect) {
    workdayAvailabilityMonthSelect.value = value;
  }
  const { year, month } = parseMonthInput(value);
  const updated = ensureWorkdayAvailabilityDefaults(year, month);
  if (updated) {
    persistWorkdayAvailability();
  }
  renderWorkdayAvailability();
}

function resolveWorkdayAvailability(dateKey, holidayName) {
  if (holidayName) return false;
  if (workdayAvailabilityMap[dateKey] == null) {
    return true;
  }
  return Boolean(workdayAvailabilityMap[dateKey]);
}

function renderWorkdayAvailability() {
  if (!workdayAvailabilityList) return;
  const { year, month } = parseMonthInput(
    getSelectedWorkdayAvailabilityMonth()
  );
  const weekdays = getWeekdays(year, month);

  if (workdayAvailabilityMonth) {
    workdayAvailabilityMonth.textContent = `${formatMonthLabel(
      year,
      month
    )} (平日のみ)`;
  }

  workdayAvailabilityList.innerHTML = "";
  if (!weekdays.length) {
    workdayAvailabilityList.innerHTML =
      '<li class="workday-item">対象月の平日が見つかりません</li>';
    return;
  }

  const fragment = document.createDocumentFragment();
  weekdays.forEach((date) => {
    const dateKey = formatDateKey(date);
    const holidayName = getHolidayName(dateKey);
    const isHoliday = Boolean(holidayName);
    const isAvailable = resolveWorkdayAvailability(dateKey, holidayName);

    const item = document.createElement("li");
    item.className = "workday-item";
    if (isHoliday) {
      item.classList.add("is-holiday");
    } else if (!isAvailable) {
      item.classList.add("is-unavailable");
    }

    const meta = document.createElement("div");
    meta.className = "workday-item__meta";
    const dateText = document.createElement("span");
    dateText.className = "workday-item__date";
    dateText.textContent = formatDisplayDate(date);
    meta.appendChild(dateText);

    if (holidayName) {
      const note = document.createElement("span");
      note.className = "workday-item__note";
      note.textContent = `${holidayName}（祝日）`;
      meta.appendChild(note);
    }

    const status = document.createElement("span");
    status.className = "workday-item__status";
    status.textContent = isHoliday
      ? "祝日（勤務なし）"
      : isAvailable
        ? "出勤あり"
        : "出勤なし";
    meta.appendChild(status);

    const toggleWrapper = document.createElement("div");
    toggleWrapper.className = "workday-item__toggle";
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = isAvailable && !isHoliday;
    toggleInput.disabled = isHoliday;
    toggleInput.dataset.date = dateKey;
    toggleInput.setAttribute(
      "aria-label",
      `${formatDisplayDate(date)}を出勤ありにする`
    );
    const toggleText = document.createElement("span");
    toggleText.textContent = isAvailable && !isHoliday ? "あり" : "なし";
    toggle.append(toggleInput, toggleText);
    toggleWrapper.appendChild(toggle);

    item.append(meta, toggleWrapper);
    fragment.appendChild(item);
  });

  workdayAvailabilityList.appendChild(fragment);
}

function handleWorkdayAvailabilityMonthChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (!target.value) return;
  setSelectedWorkdayAvailabilityMonth(target.value);
  updateWorkdayAvailabilityStatus("");
}

function handleWorkdayAvailabilityChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== "checkbox") return;
  const dateKey = target.dataset.date;
  if (!dateKey) return;
  const holidayName = getHolidayName(dateKey);
  if (holidayName) return;
  try {
    updateWorkdayAvailability(dateKey, target.checked);
    updateWorkdayAvailabilityStatus("保存しました");
    renderWorkdayAvailability();
    renderCalendar();
  } catch (error) {
    console.error("Failed to update workday availability", error);
    updateWorkdayAvailabilityStatus(
      error?.message || STORAGE_ERROR_MESSAGE,
      "#b42318"
    );
  }
}

function updateWorkdayAvailability(dateKey, isAvailable) {
  const existing = workdayAvailabilityEntries.find(
    (entry) => entry.date === dateKey
  );
  if (existing) {
    existing.isAvailable = isAvailable;
  } else {
    workdayAvailabilityEntries.push({ date: dateKey, isAvailable });
  }
  rebuildWorkdayAvailabilityMap();
  persistWorkdayAvailability();
}

function updateWorkdayAvailabilityStatus(message, color = "#0f7b6c") {
  if (!workdayAvailabilityStatus) return;
  workdayAvailabilityStatus.textContent = message;
  workdayAvailabilityStatus.style.color = color;
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
    const id = getNextStorageId("names");
    paNames = [...paNames, { id, name: newName }];
    persistPaNames();
    await refreshPaNames();
    populateNameSelects();
    renderPaNameList();
    updatePaNameStatus("追加しました");
    paNameForm.reset();
    renderCalendar();
    renderAdminTable();
  } catch (error) {
    console.error("Failed to add PA name", error);
    updatePaNameStatus(error.message || STORAGE_ERROR_MESSAGE, "#b42318");
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
      paNames = paNames.filter((entry) => entry.id !== id);
      persistPaNames();
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
      target.name = updated;
      persistPaNames();
      await refreshPaNames();
      populateNameSelects();
      renderPaNameList();
      updatePaNameStatus("更新しました");
      renderCalendar();
      renderAdminTable();
    }
  } catch (error) {
    console.error("Failed to update PA name", error);
    updatePaNameStatus(error.message || STORAGE_ERROR_MESSAGE, "#b42318");
  }
}

function updatePaNameStatus(message, color = "#0f7b6c") {
  if (!paNameStatus) return;
  paNameStatus.textContent = message;
  paNameStatus.style.color = color;
}

function handleOnlineStatusChange() {
  if (!remoteSyncClient) return;
  setRemoteConnectionStatus(false);
  updateSyncStatus("オンラインになりました。最新の変更を保存します。");
  scheduleRemotePush();
}

function handleOfflineStatusChange() {
  if (!remoteSyncClient) return;
  setRemoteConnectionStatus(false);
  updateSyncStatus(
    "オフラインのため、接続が回復するまでブラウザ内にのみ保存されます。",
    "warning"
  );
}

async function syncRemoteDataFromServer() {
  if (!remoteSyncClient) return;
  updateSyncStatus("Render ストレージと同期しています...");
  try {
    const dataset = await remoteSyncClient.pull();
    if (dataset) {
      applyRemoteDataset(dataset);
    }
    setRemoteConnectionStatus(true);
    remoteSyncState.lastPull = new Date();
    updateSyncStatus(
      `Render と同期済み (${formatTimestamp(remoteSyncState.lastPull)})`
    );
  } catch (error) {
    console.error("Failed to fetch remote data", error);
    setRemoteConnectionStatus(false);
    updateSyncStatus(
      "リモートAPIに接続できません。接続が回復するまでローカル保存で動作します。",
      "error"
    );
  }
}

function scheduleRemotePush() {
  if (!remoteSyncClient) return;
  if (remotePushTimeoutId) {
    clearTimeout(remotePushTimeoutId);
  }
  remotePushTimeoutId = window.setTimeout(() => {
    remotePushTimeoutId = null;
    pushRemoteData().catch((error) => {
      console.error("Failed to sync remote data", error);
    });
  }, 800);
}

async function pushRemoteData() {
  if (!remoteSyncClient || remotePushInFlight) {
    return;
  }
  remotePushInFlight = true;
  updateSyncStatus("Render に保存しています...");
  try {
    await remoteSyncClient.push(collectLocalDataset());
    setRemoteConnectionStatus(true);
    remoteSyncState.lastPush = new Date();
    updateSyncStatus(
      `Render に保存しました (${formatTimestamp(remoteSyncState.lastPush)})`
    );
  } catch (error) {
    setRemoteConnectionStatus(false);
    updateSyncStatus(
      "リモートへの保存に失敗しました。ネットワーク状態を確認してください。",
      "error"
    );
    throw error;
  } finally {
    remotePushInFlight = false;
  }
}

function collectLocalDataset() {
  return {
    names: paNames,
    specialDays: specialDayEntries,
    submissions: submissionEntries,
    confirmedShifts: confirmedShiftMap,
    workdayAvailability: workdayAvailabilityEntries,
    counters: {
      namesNextId: getStorageCounterValue("names"),
      specialDaysNextId: getStorageCounterValue("specialDays"),
    },
  };
}

function applyRemoteDataset(dataset) {
  try {
    const namesFromRemote = Array.isArray(dataset.names) ? dataset.names : [];
    const shouldUseDefaultNames = namesFromRemote.length === 0;
    const namesToPersist = shouldUseDefaultNames ? DEFAULT_PA_NAMES : namesFromRemote;
    writeStorageArray(LOCAL_STORAGE_KEYS.names, namesToPersist);

    if (Array.isArray(dataset.specialDays)) {
      writeStorageArray(LOCAL_STORAGE_KEYS.specialDays, dataset.specialDays);
    }
    if (Array.isArray(dataset.submissions)) {
      writeStorageArray(LOCAL_STORAGE_KEYS.submissions, dataset.submissions);
    }
    if (dataset.confirmedShifts && typeof dataset.confirmedShifts === "object") {
      confirmedShiftMap = sanitizeConfirmedShiftMap(dataset.confirmedShifts);
      storageSetItem(
        LOCAL_STORAGE_KEYS.confirmedShifts,
        JSON.stringify(confirmedShiftMap)
      );
    }
    if (Array.isArray(dataset.workdayAvailability)) {
      writeStorageArray(
        LOCAL_STORAGE_KEYS.workdayAvailability,
        dataset.workdayAvailability
      );
    }

    const counters = dataset.counters || {};
    const namesNextId =
      counters.namesNextId != null
        ? counters.namesNextId
        : shouldUseDefaultNames
          ? calculateNextIdFromList(namesToPersist)
          : null;
    if (namesNextId != null) {
      storageSetItem(ID_COUNTER_KEYS.names, String(namesNextId));
    }
    if (counters.specialDaysNextId != null) {
      storageSetItem(
        ID_COUNTER_KEYS.specialDays,
        String(counters.specialDaysNextId)
      );
    }
  } catch (error) {
    console.error("Failed to apply remote dataset", error);
  }
}

function calculateNextIdFromList(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return 1;
  }
  const maxId = list.reduce((max, entry, index) => {
    const value = Number(entry?.id);
    if (Number.isFinite(value) && value > 0) {
      return Math.max(max, value);
    }
    return Math.max(max, index + 1);
  }, 0);
  return maxId + 1 || 1;
}

function getStorageCounterValue(type) {
  const key = ID_COUNTER_KEYS[type];
  if (!key) return 1;
  const stored = Number(storageGetItem(key));
  if (Number.isFinite(stored) && stored > 0) {
    return stored;
  }
  let list = [];
  if (type === "names") {
    list = paNames;
  } else if (type === "specialDays") {
    list = specialDayEntries;
  }
  const maxId = list.reduce((max, entry) => {
    const value = Number(entry.id);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return maxId + 1 || 1;
}

function updateSyncStatus(message, variant = "info") {
  if (!syncStatus) return;
  syncStatus.textContent = message;
  syncStatus.classList.remove("is-warning", "is-error");
  if (variant === "warning") {
    syncStatus.classList.add("is-warning");
  } else if (variant === "error") {
    syncStatus.classList.add("is-error");
  }
}

function updateSubmitAvailability() {
  if (!remoteSyncClient || !submitButton) return;
  const shouldDisable = !remoteSyncState.isConnected;
  submitButton.disabled = shouldDisable;
  submitButton.setAttribute("aria-disabled", String(shouldDisable));
  if (shouldDisable) {
    formStatus.textContent = RENDER_UNAVAILABLE_MESSAGE;
    formStatus.style.color = "#b42318";
  } else if (formStatus.textContent === RENDER_UNAVAILABLE_MESSAGE) {
    formStatus.textContent = "";
  }
}

function setRemoteConnectionStatus(isConnected) {
  remoteSyncState.isConnected = Boolean(isConnected);
  updateSubmitAvailability();
}

async function ensureRemoteConnection() {
  if (!remoteSyncClient) return true;
  if (remoteSyncState.isConnected) return true;
  try {
    await remoteSyncClient.ping();
    setRemoteConnectionStatus(true);
    return true;
  } catch (error) {
    console.warn("Remote connectivity check failed", error);
    setRemoteConnectionStatus(false);
    return false;
  }
}

function formatTimestamp(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function createRemoteSyncClient() {
  const config = window.PA_SHIFT_CONFIG || {};
  const baseUrl = (config.apiBaseUrl || "").trim();
  if (!baseUrl) {
    return null;
  }
  const timeout = Number(config.apiTimeoutMs) || 10000;
  const normalizedBase = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const headers = options.body
        ? { "Content-Type": "application/json", ...(options.headers || {}) }
        : options.headers;
      const response = await fetch(`${normalizedBase}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText || "Request failed");
      }
      if (response.status === 204) {
        return null;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async pull() {
      return request("/api/data");
    },
    async push(payload) {
      return request("/api/data", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async ping() {
      return request("/");
    },
  };
}

function startRemoteKeepAlive() {
  if (!remoteSyncClient || remoteKeepAliveTimerId) {
    return;
  }
  const runPing = async () => {
    try {
      await remoteSyncClient.ping();
      setRemoteConnectionStatus(true);
    } catch (error) {
      setRemoteConnectionStatus(false);
      console.warn("Remote keep-alive ping failed", error);
    }
  };
  runPing();
  remoteKeepAliveTimerId = window.setInterval(
    runPing,
    REMOTE_KEEPALIVE_INTERVAL_MS
  );
}

function getHolidayName(dateKey) {
  return holidayMap[dateKey] ?? null;
}
