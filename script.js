const NAMES = ["森", "鄭", "長谷川", "片山", "劉", "黄", "中野", "ショーン", "王", "李", "松岡", "郭"];
const SPECIAL_DAYS = {
  // YYYY-MM-DD: note
  "2023-11-02": "在留期間更新〆切",
  "2023-11-10": "授業振替日",
  "2023-11-20": "期末試験",
  "2023-11-23": "勤労感謝の日(休館)",
  "2023-11-27": "補講日",
};
const SHIFT_TEMPLATES = {
  morning: { label: "午前", start: "10:00", end: "13:00" },
  afternoon: { label: "午後", start: "13:00", end: "17:00" },
  fullday: { label: "1日", start: "10:00", end: "17:00" },
  unavailable: { label: "勤務不可", start: null, end: null },
};
const HOLIDAY_API_URL = "https://holidays-jp.github.io/api/v1/date.json";
let holidayMap = {};

const monthPicker = document.getElementById("monthPicker");
const calendarContainer = document.getElementById("calendar");
const form = document.getElementById("shiftForm");
const formStatus = document.getElementById("formStatus");
const studentNameSelect = document.getElementById("studentName");
const adminTableWrapper = document.getElementById("adminTableWrapper");
const adminRefreshButton = document.getElementById("refreshAdmin");
const adminNameFilter = document.getElementById("adminNameFilter");
const adminMonthInput = document.getElementById("adminMonth");

const template = document.getElementById("shiftRowTemplate");

init();

async function init() {
  populateNameSelects();
  const now = new Date();
  const currentMonthValue = formatMonthInput(now);
  monthPicker.value = currentMonthValue;
  adminMonthInput.value = currentMonthValue;
  await loadHolidayData();
  renderCalendar();
  form.addEventListener("submit", handleSubmit);
  monthPicker.addEventListener("change", renderCalendar);
  adminRefreshButton.addEventListener("click", renderAdminTable);
  adminMonthInput.addEventListener("change", renderAdminTable);
  adminNameFilter.addEventListener("change", renderAdminTable);
  renderAdminTable();
}

function populateNameSelects() {
  studentNameSelect.innerHTML = NAMES.map(
    (name) => `<option value="${name}">${name}</option>`
  ).join("");

  adminNameFilter.innerHTML = NAMES.map(
    (name) => `<option value="${name}" selected>${name}</option>`
  ).join("");
}

function renderCalendar() {
  const { year, month } = parseMonthInput(monthPicker.value);
  const weekdays = getWeekdays(year, month);
  calendarContainer.innerHTML = "";

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
    const specialNote = SPECIAL_DAYS[dateKey];
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

    const toggleCustomTime = () => {
      const isOther = shiftSelect.value === "other";
      customStart.disabled = !isOther;
      customEnd.disabled = !isOther;
      customTimeWrapper.hidden = !isOther;
      customTimeWrapper.classList.toggle("is-visible", isOther);
    };

    toggleCustomTime();
    shiftSelect.addEventListener("change", toggleCustomTime);

    calendarContainer.appendChild(clone);
  });
}

function populateTimeOptions(select) {
  select.innerHTML = "";
  const times = generateTimeSlots(9, 19, 30);
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

  return rows
    .map((row) => {
      const date = row.dataset.date;
      const monthKey = row.dataset.monthKey;
      const shiftSelect = row.querySelector(".shift-select");
      const customStart = row.querySelector(".custom-start");
      const customEnd = row.querySelector(".custom-end");
      const shiftType = shiftSelect.value;

      if (!shiftType) return null;

      if (shiftType === "other") {
        if (customStart.value >= customEnd.value) {
          throw new Error(
            `${formatDisplayDateFromKey(date)} の時間帯を確認してください`
          );
        }
        return {
          name,
          date,
          monthKey,
          shiftType,
          start: customStart.value,
          end: customEnd.value,
        };
      }

      const template = SHIFT_TEMPLATES[shiftType];
      return {
        name,
        date,
        monthKey,
        shiftType,
        start: template.start,
        end: template.end,
      };
    })
    .filter(Boolean);
}

function loadSubmissions() {
  try {
    return JSON.parse(localStorage.getItem("pa-shifts") ?? "[]");
  } catch (error) {
    console.error("Failed to parse submissions", error);
    return [];
  }
}

function saveSubmissions(data) {
  localStorage.setItem("pa-shifts", JSON.stringify(data));
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
        <th>1日 (10:00-17:00)</th>
        <th>その他</th>
        <th>勤務不可</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");

  weekdays.forEach((date) => {
    const dateKey = formatDateKey(date);
    const row = document.createElement("tr");
    const holidayName = getHolidayName(dateKey);
    const specialNote = SPECIAL_DAYS[dateKey];
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

    ["morning", "afternoon", "fullday", "other", "unavailable"].forEach(
      (type) => {
        const cell = document.createElement("td");
        const items = grouped[dateKey]?.[type] ?? [];
        if (items.length) {
          cell.innerHTML = items
            .map((entry) => {
              if (type === "other") {
                return `<div>${entry.name} (${entry.start}〜${entry.end})</div>`;
              }
              return `<div>${entry.name}</div>`;
            })
            .join("");
        } else {
          cell.innerHTML = "<span style='color:#94a3b8'>--</span>";
        }
        row.appendChild(cell);
      }
    );

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  adminTableWrapper.appendChild(table);
}

function groupByDate(entries) {
  return entries.reduce((acc, entry) => {
    if (!acc[entry.date]) {
      acc[entry.date] = {
        morning: [],
        afternoon: [],
        fullday: [],
        other: [],
        unavailable: [],
      };
    }
    acc[entry.date][entry.shiftType].push(entry);
    return acc;
  }, {});
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

function getHolidayName(dateKey) {
  return holidayMap[dateKey] ?? null;
}
