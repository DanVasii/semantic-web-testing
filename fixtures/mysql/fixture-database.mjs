import { createHash } from "node:crypto";

import { createPool } from "mysql2/promise";

export const FIXTURE_MYSQL_CONFIG = {
  host: "127.0.0.1",
  port: 3306,
  database: "semantic_fixture",
  user: "root",
  password: "",
};

const text = (value) => (typeof value === "string" ? value.trim() : "");

export const validateAppointmentPayload = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Payload-ul programării trebuie să fie un obiect.");
  }
  const email = text(value.customerEmail).toLowerCase();
  if (
    email.length === 0 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Email-ul clientului nu este valid.");
  }
  const customerName = text(value.customerName);
  if (customerName.length === 0 || customerName.length > 120) {
    throw new Error(
      "Numele clientului trebuie să aibă între 1 și 120 de caractere.",
    );
  }
  const password =
    typeof value.customerPassword === "string" ? value.customerPassword : "";
  if (password.length > 256) {
    throw new Error("Parola fixture poate avea maximum 256 de caractere.");
  }
  const customerPlan =
    value.customerPlan === "premium" ? "premium" : "standard";
  const service = text(value.service);
  if (!["semantic"].includes(service)) {
    throw new Error("Serviciul fixture nu este valid.");
  }
  const appointmentDate = text(value.appointmentDate);
  if (
    appointmentDate.length > 0 &&
    !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)
  ) {
    throw new Error("Data programării nu este validă.");
  }
  const appointmentTime = text(value.appointmentTime);
  if (appointmentTime.length > 0 && !/^\d{2}:\d{2}$/.test(appointmentTime)) {
    throw new Error("Ora programării nu este validă.");
  }
  return {
    customerName,
    customerEmail: email,
    passwordHash: createHash("sha256").update(password).digest("hex"),
    newsletter: value.newsletter === true,
    customerPlan,
    service,
    appointmentDate: appointmentDate || null,
    appointmentTime: appointmentTime || null,
  };
};

export const createFixturePool = () =>
  createPool({
    ...FIXTURE_MYSQL_CONFIG,
    connectionLimit: 4,
    enableKeepAlive: false,
  });

export const saveAppointment = async (pool, input) => {
  const payload = validateAppointmentPayload(input);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [customerResult] = await connection.execute(
      `INSERT INTO customers (
         email, password_hash, newsletter, customer_plan
       ) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         password_hash = VALUES(password_hash),
         newsletter = VALUES(newsletter),
         customer_plan = VALUES(customer_plan)`,
      [
        payload.customerEmail,
        payload.passwordHash,
        payload.newsletter,
        payload.customerPlan,
      ],
    );
    const customerId = Number(customerResult.insertId);
    const [appointmentResult] = await connection.execute(
      `INSERT INTO appointments (
         customer_id, service_code, appointment_date, appointment_time
       ) VALUES (?, ?, ?, ?)`,
      [
        customerId,
        payload.service,
        payload.appointmentDate,
        payload.appointmentTime,
      ],
    );
    const appointmentId = Number(appointmentResult.insertId);
    await connection.execute(
      `INSERT INTO appointment_events (
         appointment_id, event_type, event_payload_json
       ) VALUES (?, 'created', ?)`,
      [
        appointmentId,
        JSON.stringify({
          service: payload.service,
          appointmentDate: payload.appointmentDate,
          appointmentTime: payload.appointmentTime,
        }),
      ],
    );
    await connection.commit();
    return {
      appointmentId,
      customerId,
      customerName: payload.customerName,
      customerEmail: payload.customerEmail,
      appointmentDate: payload.appointmentDate,
      appointmentTime: payload.appointmentTime,
      service: payload.service,
      status: "created",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const listAppointments = async (pool, limit = 10) => {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
  const [rows] = await pool.query(
    `SELECT
       a.id,
       c.email AS customerEmail,
       c.customer_plan AS customerPlan,
       a.service_code AS service,
       DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointmentDate,
       TIME_FORMAT(a.appointment_time, '%H:%i') AS appointmentTime,
       a.status,
       DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
     FROM appointments a
     INNER JOIN customers c ON c.id = a.customer_id
     ORDER BY a.id DESC
     LIMIT ?`,
    [safeLimit],
  );
  return rows;
};

export const fixtureHealth = async (pool) => {
  const [rows] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM customers) AS customers,
       (SELECT COUNT(*) FROM appointments) AS appointments,
       (SELECT COUNT(*) FROM booking_slots) AS bookingSlots`,
  );
  return {
    status: "ready",
    database: FIXTURE_MYSQL_CONFIG.database,
    counts: rows[0] ?? {},
  };
};

export const resetFixtureData = async (pool) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM appointment_events");
    await connection.query("DELETE FROM appointments");
    await connection.query("DELETE FROM customers");
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
