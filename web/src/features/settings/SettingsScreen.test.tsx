import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "../../lib/api";
import { SettingsScreen } from "./SettingsScreen";
import { renderApp } from "../../test/utils";

const reload = vi.fn();

beforeEach(() => {
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal("location", { ...window.location, reload });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

describe("SettingsScreen", () => {
  it("links to each management screen", () => {
    renderApp(<SettingsScreen />);
    for (const label of ["Accounts", "Categories", "Budgets", "Recurring"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("links to the dedicated export page", () => {
    renderApp(<SettingsScreen />);
    expect(screen.getByRole("link", { name: /Export/ })).toHaveAttribute("href", "/settings/export");
  });

  it("changes and persists the color theme", () => {
    let saved = "dark";
    vi.stubGlobal("localStorage", {
      getItem: () => saved,
      setItem: (_key: string, value: string) => { saved = value; },
    });
    document.documentElement.dataset.theme = "dark";
    renderApp(<SettingsScreen />);

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(saved).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("signs out and reloads", async () => {
    renderApp(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/logout", {}));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("shows logout failure without reloading and allows retry", async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({} as never);
    renderApp(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't sign out. Check your connection and try again.",
    );
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
