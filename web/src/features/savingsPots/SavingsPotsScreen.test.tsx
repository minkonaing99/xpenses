import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "../../lib/api";
import { fakeGet, renderApp } from "../../test/utils";
import { SavingsPotsScreen } from "./SavingsPotsScreen";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.get).mockImplementation(fakeGet({
    "/savings-pots": {
      active: [{
        id: "p1", name: "Emergency", targetAmount: 100000, accountId: "a1",
        accountName: "KrungThai", reserved: 30000, progress: 30,
        accountBalance: 120000, accountAvailable: 90000, shortfall: 0, history: [],
      }],
      archived: [],
    },
    "/accounts": [{ id: "a1", name: "KrungThai", type: "bank", balance: 120000, startingBalance: 0 }],
    "/categories": [{ id: "c1", name: "Tech" }],
  }) as never);
});

describe("SavingsPotsScreen", () => {
  it("shows reserved progress separately from available account money", async () => {
    renderApp(<SavingsPotsScreen />);

    expect(await screen.findByText("Emergency")).toBeInTheDocument();
    expect(screen.getByText("30% funded")).toBeInTheDocument();
    expect(screen.getByText("Available in KrungThai")).toBeInTheDocument();
  });

  it("creates a pot from a short sheet", async () => {
    renderApp(<SavingsPotsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Pot name"), { target: { value: "Laptop" } });
    fireEvent.change(screen.getByLabelText("Target in baht"), { target: { value: "45000" } });
    fireEvent.click(await screen.findByRole("option", { name: "KrungThai" }));
    fireEvent.click(screen.getByRole("button", { name: "Create pot" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/savings-pots", expect.objectContaining({
      name: "Laptop", targetAmount: 4500000, accountId: "a1",
    })));
  });

  it("allocates money from the pot detail", async () => {
    renderApp(<SavingsPotsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Emergency/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    fireEvent.change(screen.getByLabelText("Amount in baht"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to pot" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/savings-pots/p1/movements",
      expect.objectContaining({ type: "allocate", amount: 10000 }),
    ));
  });

  it("releases reserved money after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp(<SavingsPotsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Emergency/ }));
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    fireEvent.change(screen.getByLabelText("Amount in baht"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Release money" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/savings-pots/p1/movements",
      expect.objectContaining({ type: "release", amount: 10000 }),
    ));
  });

  it("records a pot-funded expense", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp(<SavingsPotsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Emergency/ }));
    fireEvent.click(screen.getByRole("button", { name: "Spend" }));
    fireEvent.change(screen.getByLabelText("Purchase amount in baht"), { target: { value: "100" } });
    await screen.findByRole("option", { name: "Tech" });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Purchase note"), { target: { value: "Keyboard" } });
    expect(screen.getByLabelText("Purchase amount in baht")).toHaveValue("100");
    expect(screen.getByLabelText("Category")).toHaveValue("c1");
    const save = screen.getByRole("button", { name: "Record purchase" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/savings-pots/p1/spend",
      expect.objectContaining({ amount: 10000, categoryId: "c1", note: "Keyboard" }),
    ));
  });

  it("edits the pot name and target", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    renderApp(<SavingsPotsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Emergency/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Pot name"), { target: { value: "Rainy day" } });
    fireEvent.change(screen.getByLabelText("Target in baht"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      "/savings-pots/p1", { name: "Rainy day", targetAmount: 200000 },
    ));
  });

  it("archives an empty pot after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.get).mockImplementation(fakeGet({
      "/savings-pots": { active: [{
        id: "p1", name: "Emergency", targetAmount: 100000, accountId: "a1",
        accountName: "KrungThai", reserved: 0, progress: 0,
        accountBalance: 120000, accountAvailable: 120000, shortfall: 0, history: [],
      }], archived: [] },
      "/accounts": [], "/categories": [],
    }) as never);
    renderApp(<SavingsPotsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Emergency/ }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/savings-pots/p1/archive", {}));
  });

  it("keeps archived pots in a collapsed section", async () => {
    vi.mocked(api.get).mockImplementation(fakeGet({
      "/savings-pots": { active: [], archived: [{
        id: "p2", name: "Old laptop", targetAmount: 500000, accountId: "a1",
        accountName: "KrungThai", reserved: 0, progress: 0,
        accountBalance: 120000, accountAvailable: 120000, shortfall: 0,
        archivedAt: "2026-09-08T00:00:00.000Z", history: [],
      }] },
      "/accounts": [], "/categories": [],
    }) as never);
    renderApp(<SavingsPotsScreen />);

    const archived = await screen.findByText("Archived (1)");
    expect(screen.queryByText("Old laptop")).not.toBeVisible();
    fireEvent.click(archived);
    expect(screen.getByText("Old laptop")).toBeVisible();
  });
});
