const MONTH_NAMES = [
  "ianuarie",
  "februarie",
  "martie",
  "aprilie",
  "mai",
  "iunie",
  "iulie",
  "august",
  "septembrie",
  "octombrie",
  "noiembrie",
  "decembrie",
];

const MIN_YEAR = 2024;
const MAX_YEAR = 2032;

const calendar = document.querySelector("#booking-calendar");
const heading = document.querySelector("#calendar-heading");
const previousButton = document.querySelector("#calendar-previous-month");
const nextButton = document.querySelector("#calendar-next-month");
const yearSelect = document.querySelector("#calendar-year");
const selectedInput = document.querySelector("#appointment-date");
const selectionStatus = document.querySelector("#calendar-selection");

if (
  !(calendar instanceof HTMLElement) ||
  !(heading instanceof HTMLElement) ||
  !(previousButton instanceof HTMLButtonElement) ||
  !(nextButton instanceof HTMLButtonElement) ||
  !(yearSelect instanceof HTMLSelectElement) ||
  !(selectedInput instanceof HTMLInputElement) ||
  !(selectionStatus instanceof HTMLElement)
) {
  throw new Error("Fixture calendar is missing required elements.");
}

let visibleYear = 2026;
let visibleMonth = 6;
let selectedDate = "";

const twoDigits = (value) => String(value).padStart(2, "0");

const dateValue = (year, month, day) =>
  `${year}-${twoDigits(month + 1)}-${twoDigits(day)}`;

const clearSelection = () => {
  selectedDate = "";
  selectedInput.value = "";
  selectionStatus.textContent = "Nicio zi selectată";
};

const selectDay = (button, day) => {
  selectedDate = dateValue(visibleYear, visibleMonth, day);
  selectedInput.value = selectedDate;
  selectionStatus.textContent = `Data selectată: ${day} ${MONTH_NAMES[visibleMonth]} ${visibleYear} (${selectedDate})`;
  for (const candidate of calendar.querySelectorAll(".calendar-day")) {
    const selected = candidate === button;
    candidate.classList.toggle("calendar-day--selected", selected);
    candidate.setAttribute("aria-selected", String(selected));
  }
};

const renderCalendar = () => {
  heading.textContent = `${MONTH_NAMES[visibleMonth]} ${visibleYear}`;
  yearSelect.value = String(visibleYear);
  previousButton.disabled = visibleYear === MIN_YEAR && visibleMonth === 0;
  nextButton.disabled = visibleYear === MAX_YEAR && visibleMonth === 11;
  calendar.replaceChildren();

  const firstWeekday =
    (new Date(Date.UTC(visibleYear, visibleMonth, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(
    Date.UTC(visibleYear, visibleMonth + 1, 0),
  ).getUTCDate();

  for (let cell = 0; cell < 42; cell += 1) {
    const day = cell - firstWeekday + 1;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.setAttribute("role", "gridcell");

    if (day < 1 || day > daysInMonth) {
      button.classList.add("calendar-day--outside");
      button.disabled = true;
      button.tabIndex = -1;
      button.setAttribute("aria-hidden", "true");
      calendar.append(button);
      continue;
    }

    const value = dateValue(visibleYear, visibleMonth, day);
    button.textContent = String(day);
    button.dataset.date = value;
    button.dataset.testid = `calendar-day-${value}`;
    button.setAttribute(
      "aria-label",
      `${day} ${MONTH_NAMES[visibleMonth]} ${visibleYear}`,
    );
    button.setAttribute("aria-selected", String(selectedDate === value));
    if (selectedDate === value) {
      button.classList.add("calendar-day--selected");
    }
    button.addEventListener("click", () => selectDay(button, day));
    calendar.append(button);
  }
};

previousButton.addEventListener("click", () => {
  if (visibleMonth === 0) {
    visibleMonth = 11;
    visibleYear -= 1;
  } else {
    visibleMonth -= 1;
  }
  clearSelection();
  renderCalendar();
});

nextButton.addEventListener("click", () => {
  if (visibleMonth === 11) {
    visibleMonth = 0;
    visibleYear += 1;
  } else {
    visibleMonth += 1;
  }
  clearSelection();
  renderCalendar();
});

yearSelect.addEventListener("change", () => {
  visibleYear = Number(yearSelect.value);
  clearSelection();
  renderCalendar();
});

renderCalendar();
