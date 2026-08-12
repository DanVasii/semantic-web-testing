import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createFixtureMailer } from "../fixtures/mail/fixture-mailer.mjs";
import {
  createFixturePool,
  fixtureHealth,
  listAppointments,
  resetFixtureData,
  saveAppointment,
} from "../fixtures/mysql/fixture-database.mjs";

const environmentPath = resolve(".env.fixture");
if (existsSync(environmentPath)) {
  process.loadEnvFile(environmentPath);
}

const HOST = "127.0.0.1";
const PORT = 4174;
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  `http://${HOST}:${PORT}`,
]);
const pool = createFixturePool();
let mailer;
try {
  mailer = createFixtureMailer();
} catch (error) {
  const configurationError =
    error instanceof Error
      ? error.message
      : "Configurația SMTP nu este validă.";
  mailer = {
    configured: true,
    verifyConnection: async () => ({
      status: "error",
      error: configurationError,
    }),
    sendAppointmentConfirmation: async () => {
      throw new Error(configurationError);
    },
  };
}

const getSmtpHealth = async () => {
  try {
    return await mailer.verifyConnection();
  } catch (error) {
    return {
      status: "error",
      error:
        error instanceof Error
          ? error.message
          : "Conexiunea SMTP nu a putut fi verificată.",
    };
  }
};

const sendJson = (response, status, value, origin) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...(origin !== undefined && ALLOWED_ORIGINS.has(origin)
      ? { "access-control-allow-origin": origin, vary: "origin" }
      : {}),
  });
  response.end(body);
};

const readJson = async (request) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) {
      throw new Error("Payload-ul fixture este prea mare.");
    }
  }
  return body.length === 0 ? {} : JSON.parse(body);
};

const server = createServer(async (request, response) => {
  const origin =
    typeof request.headers.origin === "string"
      ? request.headers.origin
      : undefined;
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      ...(origin !== undefined && ALLOWED_ORIGINS.has(origin)
        ? { "access-control-allow-origin": origin, vary: "origin" }
        : {}),
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(
        response,
        200,
        {
          ...(await fixtureHealth(pool)),
          smtp: await getSmtpHealth(),
        },
        origin,
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/appointments") {
      sendJson(
        response,
        200,
        {
          appointments: await listAppointments(
            pool,
            url.searchParams.get("limit"),
          ),
        },
        origin,
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/appointments") {
      const appointment = await saveAppointment(pool, await readJson(request));
      let email;
      try {
        email = await mailer.sendAppointmentConfirmation(appointment);
      } catch (error) {
        email = {
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Trimiterea e-mailului a eșuat.",
        };
      }
      sendJson(response, 201, { appointment, email }, origin);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/reset") {
      await resetFixtureData(pool);
      sendJson(response, 200, { status: "reset" }, origin);
      return;
    }
    sendJson(response, 404, { error: "Ruta fixture nu există." }, origin);
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? "Payload JSON invalid."
        : error instanceof Error &&
            !("code" in error) &&
            error.message.length < 300
          ? error.message
          : "Operația MySQL fixture a eșuat.";
    sendJson(response, 400, { error: message }, origin);
  }
});

const shutdown = async () => {
  server.close();
  await pool.end();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

server.listen(PORT, HOST, () => {
  process.stdout.write(`MySQL fixture API ready at http://${HOST}:${PORT}\n`);
});
