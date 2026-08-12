import { describe, expect, it } from "vitest";

import {
  hasMySqlConnectionErrors,
  validateMySqlConnectionInput,
} from "./mysql.js";

describe("MySQL connection validation", () => {
  it("accepts hostnames, IPs and a valid port", () => {
    expect(
      validateMySqlConnectionInput(
        {
          host: "mysql.internal",
          port: 3306,
          database: "booking",
          username: "tester",
          password: "secret",
          ssl: true,
        },
        true,
      ),
    ).toEqual({});
  });

  it("accepts an explicitly empty password for local MySQL servers", () => {
    expect(
      validateMySqlConnectionInput(
        {
          host: "127.0.0.1",
          port: 3306,
          database: "semantic_fixture",
          username: "root",
          password: "",
          ssl: false,
        },
        true,
      ),
    ).toEqual({});
  });

  it("rejects protocols in host and ports outside the TCP range", () => {
    const errors = validateMySqlConnectionInput(
      {
        host: "mysql://localhost/path",
        port: 70_000,
        database: "",
        username: "",
        ssl: "yes",
      },
      true,
    );

    expect(hasMySqlConnectionErrors(errors)).toBe(true);
    expect(typeof errors.host).toBe("string");
    expect(typeof errors.port).toBe("string");
    expect(typeof errors.database).toBe("string");
    expect(typeof errors.username).toBe("string");
    expect(typeof errors.password).toBe("string");
    expect(typeof errors.ssl).toBe("string");
  });
});
