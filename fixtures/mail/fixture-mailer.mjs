import nodemailer from "nodemailer";

const text = (value) => (typeof value === "string" ? value.trim() : "");

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const parsePort = (value) => {
  const port = Number(value || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SEMANTIC_FIXTURE_SMTP_PORT nu este valid.");
  }
  return port;
};

const parseSecure = (value, port) => {
  if (value === undefined || value.trim() === "") return port === 465;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    "SEMANTIC_FIXTURE_SMTP_SECURE trebuie să fie true sau false.",
  );
};

export const readFixtureSmtpConfig = (environment = process.env) => {
  const host = text(environment.SEMANTIC_FIXTURE_SMTP_HOST);
  if (host.length === 0) return null;

  const port = parsePort(environment.SEMANTIC_FIXTURE_SMTP_PORT);
  const user = text(environment.SEMANTIC_FIXTURE_SMTP_USER);
  const password = text(environment.SEMANTIC_FIXTURE_SMTP_PASSWORD);
  const from =
    text(environment.SEMANTIC_FIXTURE_SMTP_FROM) ||
    (user.length > 0 ? `Fixture rezervări <${user}>` : "");

  if (user.length === 0 || password.length === 0 || from.length === 0) {
    throw new Error(
      "SMTP fixture necesită host, utilizator, parolă și expeditor.",
    );
  }

  return {
    host,
    port,
    secure: parseSecure(environment.SEMANTIC_FIXTURE_SMTP_SECURE, port),
    user,
    password,
    from,
  };
};

export const buildAppointmentEmail = (appointment) => {
  const customerName = text(appointment.customerName);
  const customerEmail = text(appointment.customerEmail);
  if (customerName.length === 0 || customerEmail.length === 0) {
    throw new Error("Programarea nu conține numele și adresa destinatarului.");
  }

  const date = text(appointment.appointmentDate) || "data aleasă";
  const time = text(appointment.appointmentTime) || "ora aleasă";
  const safeName = escapeHtml(customerName);
  const safeDate = escapeHtml(date);
  const safeTime = escapeHtml(time);

  return {
    to: customerEmail,
    subject: "Am primit rezervarea ta",
    text: `Bună, ${customerName}!\n\nAm primit rezervarea ta pentru ${date}, ora ${time}.\nÎți mulțumim!`,
    html: `<!doctype html>
<html lang="ro">
  <body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#242424">
    <div style="max-width:560px;margin:24px auto;padding:32px;background:#ffffff;border-radius:12px">
      <h1 style="margin:0 0 20px;color:#d65f24;font-size:24px">Bună, ${safeName}!</h1>
      <p style="font-size:16px;line-height:1.6">Am primit rezervarea ta pentru <strong>${safeDate}</strong>, ora <strong>${safeTime}</strong>.</p>
      <p style="font-size:16px;line-height:1.6">Îți mulțumim! Te așteptăm cu drag.</p>
    </div>
  </body>
</html>`,
  };
};

export const createFixtureMailer = (
  environment = process.env,
  createTransport = nodemailer.createTransport,
) => {
  const config = readFixtureSmtpConfig(environment);
  if (config === null) {
    return {
      configured: false,
      verifyConnection: async () => ({ status: "disabled" }),
      sendAppointmentConfirmation: async () => ({ status: "disabled" }),
    };
  }

  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 8_000,
  });

  return {
    configured: true,
    verifyConnection: async () => {
      await transport.verify();
      return {
        status: "connected",
        host: config.host,
        port: config.port,
      };
    },
    sendAppointmentConfirmation: async (appointment) => {
      const result = await transport.sendMail({
        from: config.from,
        ...buildAppointmentEmail(appointment),
      });
      return {
        status: "sent",
        messageId: result.messageId,
      };
    },
  };
};
