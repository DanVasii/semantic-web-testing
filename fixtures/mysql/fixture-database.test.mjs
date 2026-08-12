import { describe, expect, it } from "vitest";

import { validateAppointmentPayload } from "./fixture-database.mjs";

describe("MySQL fixture payload", () => {
  it("normalizes a valid appointment and hashes the customer password", () => {
    const value = validateAppointmentPayload({
      customerName: " Ana Popescu ",
      customerEmail: " Client@Example.Test ",
      customerPassword: "secret",
      newsletter: true,
      customerPlan: "premium",
      service: "semantic",
      appointmentDate: "2027-08-15",
      appointmentTime: "10:30",
    });

    expect(value).toMatchObject({
      customerName: "Ana Popescu",
      customerEmail: "client@example.test",
      newsletter: true,
      customerPlan: "premium",
      service: "semantic",
      appointmentDate: "2027-08-15",
      appointmentTime: "10:30",
    });
    expect(value.passwordHash).toMatch(/^[a-f0-9]{64}$/);
    expect(value.passwordHash).not.toContain("secret");
  });

  it("rejects invalid email, service, date and time values", () => {
    expect(() =>
      validateAppointmentPayload({
        customerName: "Ana",
        customerEmail: "invalid",
        service: "semantic",
      }),
    ).toThrow("Email");
    expect(() =>
      validateAppointmentPayload({
        customerName: "Ana",
        customerEmail: "client@example.test",
        service: "unknown",
      }),
    ).toThrow("Serviciul");
    expect(() =>
      validateAppointmentPayload({
        customerName: "Ana",
        customerEmail: "client@example.test",
        service: "semantic",
        appointmentDate: "15.08.2027",
      }),
    ).toThrow("Data");
    expect(() =>
      validateAppointmentPayload({
        customerName: "Ana",
        customerEmail: "client@example.test",
        service: "semantic",
        appointmentTime: "10.30",
      }),
    ).toThrow("Ora");
    expect(() =>
      validateAppointmentPayload({
        customerName: "",
        customerEmail: "client@example.test",
        service: "semantic",
      }),
    ).toThrow("Numele");
  });
});
