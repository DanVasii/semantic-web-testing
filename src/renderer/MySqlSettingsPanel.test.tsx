// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { MySqlSchemaResult } from "../shared/mysql.js";
import { MySqlSettingsPanel } from "./MySqlSettingsPanel.js";

const schema: MySqlSchemaResult = {
  database: "booking",
  loadedAt: "2026-07-26T09:00:00.000Z",
  tables: [
    {
      name: "appointments",
      columns: [
        {
          name: "id",
          dataType: "bigint",
          columnType: "bigint unsigned",
          nullable: false,
          extra: "auto_increment",
          ordinalPosition: 1,
          primaryKey: true,
        },
        {
          name: "customer_email",
          dataType: "varchar",
          columnType: "varchar(255)",
          nullable: false,
          extra: "",
          ordinalPosition: 2,
          primaryKey: false,
        },
      ],
      primaryKey: ["id"],
      identityColumns: ["id"],
      identitySource: "primary_key",
    },
  ],
};

const unconfigured = {
  projectId: "project-1",
  host: "localhost",
  port: 3306,
  database: "",
  username: "",
  ssl: false,
  passwordConfigured: false,
  identities: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MySqlSettingsPanel", () => {
  it("validates host and port locally before invoking the main process", async () => {
    const user = userEvent.setup();
    const testMySqlConnection = vi.fn();
    const api = {
      getMySqlSettings: vi.fn().mockResolvedValue(unconfigured),
      testMySqlConnection,
    } as unknown as SemanticAppApi;

    render(<MySqlSettingsPanel api={api} projectId="project-1" />);
    const host = await screen.findByLabelText("Host");
    await user.clear(host);
    await user.type(host, "mysql://localhost/path");
    const port = screen.getByLabelText("Port");
    await user.clear(port);
    await user.type(port, "70000");
    await user.click(
      screen.getByRole("button", { name: "Testează conexiunea" }),
    );

    expect(
      screen.getByText(/Host-ul trebuie să fie un hostname/i),
    ).not.toBeNull();
    expect(screen.getByText(/Portul trebuie să fie/i)).not.toBeNull();
    expect(testMySqlConnection).not.toHaveBeenCalled();
  });

  it("saves and tests the connection, loads tables and persists manual identity columns", async () => {
    const user = userEvent.setup();
    const saveMySqlSettings = vi.fn().mockResolvedValue({
      ...unconfigured,
      host: "mysql.internal",
      database: "booking",
      username: "tester",
      ssl: true,
      passwordConfigured: true,
      updatedAt: "2026-07-26T09:00:00.000Z",
    });
    const testMySqlConnection = vi.fn().mockResolvedValue({
      success: true,
      message: "Conexiunea MySQL este disponibilă.",
      latencyMs: 12,
    });
    const loadMySqlSchema = vi.fn().mockResolvedValue(schema);
    const saveMySqlIdentityConfig = vi.fn().mockResolvedValue({
      ...schema,
      tables: [
        {
          ...schema.tables[0],
          identityColumns: ["id", "customer_email"],
          identitySource: "manual",
        },
      ],
    });
    const api = {
      getMySqlSettings: vi.fn().mockResolvedValue(unconfigured),
      saveMySqlSettings,
      testMySqlConnection,
      loadMySqlSchema,
      saveMySqlIdentityConfig,
    } as unknown as SemanticAppApi;

    render(<MySqlSettingsPanel api={api} projectId="project-1" />);
    const host = await screen.findByLabelText("Host");
    await user.clear(host);
    await user.type(host, "mysql.internal");
    await user.type(screen.getByLabelText("Bază de date"), "booking");
    await user.type(screen.getByLabelText("Username"), "tester");
    await user.type(screen.getByLabelText("Parolă"), "very-secret");
    await user.click(screen.getByRole("checkbox", { name: "Conexiune SSL" }));
    await user.click(
      screen.getByRole("button", { name: "Salvează configurația" }),
    );

    await waitFor(() => {
      expect(saveMySqlSettings).toHaveBeenCalledWith("project-1", {
        host: "mysql.internal",
        port: 3306,
        database: "booking",
        username: "tester",
        password: "very-secret",
        ssl: true,
      });
    });
    expect(
      await screen.findByText(/Configurația MySQL a fost salvată/i),
    ).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Testează conexiunea" }),
    );
    await waitFor(() => expect(testMySqlConnection).toHaveBeenCalledOnce());
    expect(await screen.findByText(/12 ms/i)).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Încarcă schema și tabelele" }),
    );
    expect(await screen.findByText(/appointments · 2 coloane/i)).not.toBeNull();
    await user.click(screen.getByText(/appointments · 2 coloane/i));
    await user.click(screen.getByRole("checkbox", { name: /customer_email/i }));
    await user.click(
      screen.getByRole("button", { name: "Salvează identity config" }),
    );

    await waitFor(() => {
      expect(saveMySqlIdentityConfig).toHaveBeenCalledWith("project-1", [
        {
          tableName: "appointments",
          columns: ["id", "customer_email"],
        },
      ]);
    });
    expect(
      await screen.findByText(/coloanele multiple vor fi combinate cu AND/i),
    ).not.toBeNull();
  });
});
