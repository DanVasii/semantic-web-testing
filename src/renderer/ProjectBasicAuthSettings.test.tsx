// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project } from "../shared/persistence.js";
import { ProjectBasicAuthSettingsPanel } from "./ProjectBasicAuthSettings.js";

const project: Project = {
  id: "project-1",
  name: "Proiect protejat",
  baseUrl: "https://secure.example.test/app",
  normalizedBaseUrl: "https://secure.example.test/app",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
};

afterEach(cleanup);

describe("ProjectBasicAuthSettingsPanel", () => {
  it("edits the username without requiring or resending the saved password", async () => {
    const user = userEvent.setup();
    const api = {
      getProjectBasicAuth: vi.fn().mockResolvedValue({
        projectId: project.id,
        origin: "https://secure.example.test",
        username: "saved-user",
        configured: true,
        updatedAt: "2026-07-25T10:00:00.000Z",
      }),
      saveProjectBasicAuth: vi.fn().mockResolvedValue({
        projectId: project.id,
        origin: "https://secure.example.test",
        username: "edited-user",
        configured: true,
        updatedAt: "2026-07-25T11:00:00.000Z",
      }),
      deleteProjectBasicAuth: vi.fn(),
    } as unknown as SemanticAppApi;

    render(<ProjectBasicAuthSettingsPanel api={api} project={project} />);
    const username = await screen.findByLabelText("Username");
    expect(username).toBeInstanceOf(HTMLInputElement);
    if (!(username instanceof HTMLInputElement)) {
      throw new Error("Expected a username input.");
    }
    expect(username.value).toBe("saved-user");
    expect(screen.getByText("Configurat")).not.toBeNull();
    expect(
      screen.getByText(/Las-o goală pentru a păstra parola existentă/),
    ).not.toBeNull();

    await user.clear(username);
    await user.type(username, "edited-user");
    await user.click(
      screen.getByRole("button", { name: "Salvează credentialele" }),
    );

    expect(api.saveProjectBasicAuth).toHaveBeenCalledWith(project.id, {
      username: "edited-user",
    });
    expect(
      await screen.findByText(
        "Credentialele HTTP Basic Auth au fost salvate pentru proiect.",
      ),
    ).not.toBeNull();
  });

  it("requires a password on first save and supports removing credentials", async () => {
    const user = userEvent.setup();
    const api = {
      getProjectBasicAuth: vi.fn().mockResolvedValue({
        projectId: project.id,
        origin: "https://secure.example.test",
        username: "",
        configured: false,
      }),
      saveProjectBasicAuth: vi.fn().mockResolvedValue({
        projectId: project.id,
        origin: "https://secure.example.test",
        username: "tester",
        configured: true,
        updatedAt: "2026-07-25T10:00:00.000Z",
      }),
      deleteProjectBasicAuth: vi.fn().mockResolvedValue(true),
    } as unknown as SemanticAppApi;

    render(<ProjectBasicAuthSettingsPanel api={api} project={project} />);
    const saveButton = await screen.findByRole("button", {
      name: "Salvează credentialele",
    });
    await waitFor(() => expect(saveButton.hasAttribute("disabled")).toBe(true));
    await user.type(screen.getByLabelText("Username"), "tester");
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByLabelText("Parolă"), "secret");
    expect(saveButton.hasAttribute("disabled")).toBe(false);
    await user.click(saveButton);

    expect(api.saveProjectBasicAuth).toHaveBeenCalledWith(project.id, {
      username: "tester",
      password: "secret",
    });
    await user.click(
      await screen.findByRole("button", { name: "Șterge credentialele" }),
    );
    expect(api.deleteProjectBasicAuth).toHaveBeenCalledWith(project.id);
    expect(
      await screen.findByText(
        "Credentialele HTTP Basic Auth au fost șterse din proiect.",
      ),
    ).not.toBeNull();
  });
});
