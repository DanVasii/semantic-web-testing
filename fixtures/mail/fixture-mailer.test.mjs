import { describe, expect, it, vi } from "vitest";

import {
  buildAppointmentEmail,
  createFixtureMailer,
  readFixtureSmtpConfig,
} from "./fixture-mailer.mjs";

const appointment = {
  customerName: "Ana <Test>",
  customerEmail: "ana@example.test",
  appointmentDate: "2027-08-15",
  appointmentTime: "10:30",
};

describe("fixture SMTP mailer", () => {
  it("stays disabled when SMTP is not configured", async () => {
    const mailer = createFixtureMailer({}, vi.fn());

    expect(mailer.configured).toBe(false);
    await expect(
      mailer.sendAppointmentConfirmation(appointment),
    ).resolves.toEqual({ status: "disabled" });
  });

  it("builds a safe HTML and text confirmation", () => {
    const message = buildAppointmentEmail(appointment);

    expect(message).toMatchObject({
      to: "ana@example.test",
      subject: "Am primit rezervarea ta",
    });
    expect(message.text).toContain("Bună, Ana <Test>!");
    expect(message.html).toContain("Bună, Ana &lt;Test&gt;!");
    expect(message.html).not.toContain("Bună, Ana <Test>!");
    expect(message.html).toContain("2027-08-15");
    expect(message.html).toContain("10:30");
  });

  it("uses the configured SMTP transport without exposing the password", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "fixture-123" });
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    const environment = {
      SEMANTIC_FIXTURE_SMTP_HOST: "smtp.example.test",
      SEMANTIC_FIXTURE_SMTP_PORT: "465",
      SEMANTIC_FIXTURE_SMTP_SECURE: "true",
      SEMANTIC_FIXTURE_SMTP_USER: "fixture@example.test",
      SEMANTIC_FIXTURE_SMTP_PASSWORD: "app-password",
      SEMANTIC_FIXTURE_SMTP_FROM: "Fixture <fixture@example.test>",
    };

    const mailer = createFixtureMailer(environment, createTransport);
    await expect(
      mailer.sendAppointmentConfirmation(appointment),
    ).resolves.toEqual({
      status: "sent",
      messageId: "fixture-123",
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      auth: {
        user: "fixture@example.test",
        pass: "app-password",
      },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 8_000,
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Fixture <fixture@example.test>",
        to: "ana@example.test",
      }),
    );
  });

  it("rejects incomplete SMTP configuration", () => {
    expect(() =>
      readFixtureSmtpConfig({
        SEMANTIC_FIXTURE_SMTP_HOST: "smtp.example.test",
      }),
    ).toThrow("utilizator");
  });
});
