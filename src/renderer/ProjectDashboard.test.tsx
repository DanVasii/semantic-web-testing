// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { ProjectOverview } from "../shared/projects.js";
import { ProjectDashboard } from "./ProjectDashboard.js";

const overview: ProjectOverview = {
  project: {
    id: "project-1",
    name: "Magazin demo",
    baseUrl: "https://example.test/shop?preview=1",
    normalizedBaseUrl: "https://example.test/shop",
    createdAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:00:00.000Z",
    browserConfig: {
      browserType: "chromium",
      sessionMode: "temporary",
      headless: false,
    },
    aiConfig: {},
    shortcutConfig: {},
  },
  statistics: {
    pageCount: 4,
    testCount: 3,
    runCount: 12,
    lastRunAt: "2026-07-24T11:00:00.000Z",
  },
};

const createApi = (
  projects: ProjectOverview[] = [overview],
): SemanticAppApi => ({
  getAppInfo: vi.fn().mockResolvedValue({
    version: "0.1.0",
    electronVersion: "41.7.1",
  }),
  listProjects: vi.fn().mockResolvedValue(projects),
  createProject: vi.fn().mockResolvedValue(overview),
  updateProject: vi.fn().mockResolvedValue(overview),
  deleteProject: vi.fn().mockResolvedValue(true),
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectDashboard", () => {
  it("restores the last opened project and displays its statistics", async () => {
    localStorage.setItem("semantic-app:last-project-id", overview.project.id);
    render(<ProjectDashboard api={createApi()} />);

    expect(await screen.findByText("Proiect deschis")).not.toBeNull();
    expect(
      screen.getByText("Pagini analizate").previousSibling?.textContent,
    ).toBe("4");
    expect(screen.getByText("Teste").previousSibling?.textContent).toBe("3");
    expect(screen.getByText("Rulări").previousSibling?.textContent).toBe("12");
    expect(
      screen.getByRole("link", { name: "https://example.test/shop" }),
    ).not.toBeNull();
  });

  it("validates and creates a project with a normalized URL preview", async () => {
    const user = userEvent.setup();
    const api = createApi([]);
    const created: ProjectOverview = {
      ...overview,
      project: {
        ...overview.project,
        name: "Portal rezervări",
        baseUrl: "https://example.test/booking?service=10#calendar",
        normalizedBaseUrl: "https://example.test/booking",
      },
    };
    vi.mocked(api.createProject).mockResolvedValue(created);
    render(<ProjectDashboard api={api} />);

    await screen.findByText("Creează primul proiect");
    await user.click(screen.getByRole("button", { name: "+ Proiect nou" }));
    await user.click(screen.getByRole("button", { name: "Creează proiectul" }));

    expect(
      screen.getByText("Numele proiectului este obligatoriu."),
    ).not.toBeNull();
    expect(
      screen.getByText("URL-ul proiectului este obligatoriu."),
    ).not.toBeNull();

    await user.type(
      screen.getByLabelText("Numele proiectului"),
      "Portal rezervări",
    );
    await user.type(
      screen.getByLabelText("URL-ul proiectului"),
      "https://example.test/booking?service=10#calendar",
    );

    expect(screen.getByText("https://example.test/booking")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Creează proiectul" }));

    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalledWith({
        name: "Portal rezervări",
        baseUrl: "https://example.test/booking?service=10#calendar",
      });
    });
    expect(await screen.findByText("Proiect creat")).not.toBeNull();
    expect(localStorage.getItem("semantic-app:last-project-id")).toBe(
      "project-1",
    );
  });

  it("edits a project and refreshes the item in the list", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const updated: ProjectOverview = {
      ...overview,
      project: { ...overview.project, name: "Magazin actualizat" },
    };
    vi.mocked(api.updateProject).mockResolvedValue(updated);
    render(<ProjectDashboard api={api} />);

    await screen.findByText("Magazin demo");
    await user.click(screen.getByRole("button", { name: "Editează" }));
    const nameInput = screen.getByLabelText("Numele proiectului");
    await user.clear(nameInput);
    await user.type(nameInput, "Magazin actualizat");
    await user.click(
      screen.getByRole("button", { name: "Salvează modificările" }),
    );

    await waitFor(() => {
      expect(api.updateProject).toHaveBeenCalledWith("project-1", {
        name: "Magazin actualizat",
        baseUrl: overview.project.baseUrl,
      });
    });
    expect(await screen.findByText("Proiect actualizat")).not.toBeNull();
  });

  it("requires confirmation before deleting a project", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<ProjectDashboard api={api} />);

    await screen.findByText("Magazin demo");
    await user.click(
      screen.getByRole("button", {
        name: "Șterge proiectul Magazin demo",
      }),
    );

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(api.deleteProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Șterge proiectul" }));

    await waitFor(() => {
      expect(api.deleteProject).toHaveBeenCalledWith("project-1");
    });
    expect(await screen.findByText("Creează primul proiect")).not.toBeNull();
  });
});
