const form = document.querySelector('[data-testid="fixture-form"]');
const submitButton = document.querySelector('[data-testid="fixture-submit"]');
const databaseStatus = document.querySelector("#fixture-database-status");
const smtpStatus = document.querySelector("#fixture-smtp-status");
const appointmentsBody = document.querySelector("#fixture-appointments-body");
const refreshButton = document.querySelector("#refresh-appointments");
const appointmentDate = document.querySelector("#appointment-date");
const appointmentTime = document.querySelector("#appointment-time");

if (
  !(form instanceof HTMLFormElement) ||
  !(submitButton instanceof HTMLButtonElement) ||
  !(databaseStatus instanceof HTMLElement) ||
  !(smtpStatus instanceof HTMLElement) ||
  !(appointmentsBody instanceof HTMLElement) ||
  !(refreshButton instanceof HTMLButtonElement) ||
  !(appointmentDate instanceof HTMLInputElement) ||
  !(appointmentTime instanceof HTMLInputElement)
) {
  throw new Error("Fixture MySQL is missing required elements.");
}

const API_ORIGIN =
  window.location.port === "4174"
    ? window.location.origin
    : "http://127.0.0.1:4174";

const setStatus = (value, variant = "neutral") => {
  databaseStatus.textContent = value;
  databaseStatus.dataset.status = variant;
};

const setSmtpStatus = (value, variant = "neutral") => {
  smtpStatus.textContent = value;
  smtpStatus.dataset.status = variant;
};

const request = async (path, options) => {
  const response = await fetch(`${API_ORIGIN}${path}`, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : "API-ul fixture a răspuns cu eroare.",
    );
  }
  return body;
};

const renderAppointments = (appointments) => {
  appointmentsBody.replaceChildren();
  if (appointments.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "Nicio programare salvată.";
    row.append(cell);
    appointmentsBody.append(row);
    return;
  }
  for (const appointment of appointments) {
    const row = document.createElement("tr");
    for (const value of [
      appointment.id,
      appointment.customerEmail,
      appointment.customerPlan,
      appointment.service,
      appointment.appointmentDate ?? "—",
      appointment.appointmentTime ?? "—",
    ]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    appointmentsBody.append(row);
  }
};

const loadAppointments = async () => {
  const body = await request("/api/appointments?limit=10");
  renderAppointments(body.appointments);
};

const loadHealth = async () => {
  setSmtpStatus("SMTP · checking connection...", "loading");
  try {
    const health = await request("/api/health");
    setStatus(
      `connected · ${health.database} · ${health.counts.appointments} programări`,
      "success",
    );
    if (health.smtp?.status === "connected") {
      setSmtpStatus(
        `SMTP · connected · ${health.smtp.host}:${health.smtp.port}`,
        "success",
      );
    } else if (health.smtp?.status === "error") {
      setSmtpStatus(`SMTP · connection failed · ${health.smtp.error}`, "error");
    } else if (health.smtp?.status === "disabled") {
      setSmtpStatus("SMTP · disabled · configurează .env.fixture", "neutral");
    } else {
      setSmtpStatus(
        "SMTP · status unavailable · repornește API-ul fixture",
        "neutral",
      );
    }
    await loadAppointments();
  } catch {
    setStatus("database API unavailable on 127.0.0.1:4174", "error");
    setSmtpStatus("SMTP · API unavailable", "error");
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  setStatus("saving appointment...", "loading");
  const data = new FormData(form);
  try {
    const body = await request("/api/appointments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerName: data.get("customer_name"),
        customerEmail: data.get("customer_email"),
        customerPassword: data.get("customer_password"),
        newsletter: data.get("newsletter") === "on",
        customerPlan: data.get("customer_plan"),
        service: data.get("service"),
        appointmentDate: appointmentDate.value,
        appointmentTime: appointmentTime.value,
      }),
    });
    const emailResult =
      body.email !== null && typeof body.email === "object"
        ? body.email
        : { status: "unknown" };
    const emailStatus =
      emailResult.status === "sent"
        ? "email sent"
        : emailResult.status === "failed"
          ? `email failed: ${
              typeof emailResult.error === "string"
                ? emailResult.error
                : "unknown SMTP error"
            }`
          : emailResult.status === "disabled"
            ? "SMTP disabled"
            : "email status unavailable";
    setStatus(
      `saved · appointment #${body.appointment.appointmentId} · ${emailStatus}`,
      emailResult.status === "failed" ? "error" : "success",
    );
    if (emailResult.status === "sent") {
      setSmtpStatus("SMTP · connected · email sent", "success");
    } else if (emailResult.status === "failed") {
      setSmtpStatus(`SMTP · send failed · ${emailResult.error}`, "error");
    }
    await loadAppointments();
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "appointment save failed",
      "error",
    );
  } finally {
    submitButton.disabled = false;
  }
});

refreshButton.addEventListener("click", () => {
  setStatus("refreshing...", "loading");
  void loadHealth();
});

void loadHealth();
