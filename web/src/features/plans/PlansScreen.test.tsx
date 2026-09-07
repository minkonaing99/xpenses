import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "../../lib/api";
import { PlansScreen } from "./PlansScreen";
import { fakeGet, renderApp } from "../../test/utils";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.patch).mockResolvedValue({} as never);
  vi.mocked(api.get).mockImplementation(fakeGet({
    "/accounts": [{ id: "a1", name: "Cash", type: "cash", balance: 10000, startingBalance: 0 }],
    "/categories": [{ id: "c1", name: "Food" }],
    "/plans": {
      plans: [{ id: "p1", name: "Headphones", amount: 3000, accountId: "a1", categoryId: "c1", plannedDate: "2026-09-20", waitDays: 7, waitUntil: "2026-09-13", status: "planned" }],
      confirmedPurchases: [
        { id: "p2", name: "Desk lamp", amount: 4500, purchaseAmount: 4500, purchaseDate: "2026-09-01", reflection: null, reflectionNote: null, status: "confirmed" },
        { id: "p3", name: "Coffee grinder", amount: 6000, purchaseAmount: 6000, purchaseDate: "2026-08-20", reflection: "regret", reflectionNote: "Too noisy", status: "confirmed" },
      ],
      accounts: [{ id: "a1", name: "Cash", balance: 10000, planned: 3000, forecastBalance: 7000 }],
      budgets: [],
    },
    "/reports/summary": { monthExpense: 2000 },
  }) as never);
});

describe("PlansScreen", () => {
  it("separates current balance from planned forecast", async () => {
    renderApp(<PlansScreen />);
    expect(await screen.findByText("Headphones")).toBeInTheDocument();
    expect(screen.getByText("Forecast after plans")).toBeInTheDocument();
  });

  it("uses the transaction-style purchase form", async () => {
    renderApp(<PlansScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));

    expect(screen.getByLabelText("Price in baht")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cash" })).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByText(/Ready after 7 days/i)).toBeInTheDocument();
  });

  it("reviews a confirmed purchase from purchase history", async () => {
    renderApp(<PlansScreen />);

    expect(screen.getByText("Purchase reflections")).toBeInTheDocument();
    expect(await screen.findByText("Desk lamp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review Desk lamp" }));
    fireEvent.click(screen.getByRole("radio", { name: "Worth it" }));
    fireEvent.change(screen.getByLabelText("Reflection note"), { target: { value: "Bright and useful" } });
    expect(screen.getByLabelText("Reflection note")).toHaveAttribute("maxlength", "255");
    fireEvent.click(screen.getByRole("button", { name: "Save reflection" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/plans/p2", {
      reflection: "worth_it",
      reflectionNote: "Bright and useful",
    }));
  });

  it("opens an existing reflection for editing", async () => {
    renderApp(<PlansScreen />);

    expect(await screen.findByText("Coffee grinder")).toBeInTheDocument();
    expect(screen.getByText("Too noisy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit reflection Coffee grinder" }));

    expect(screen.getByRole("radio", { name: "Regret" })).toBeChecked();
    expect(screen.getByLabelText("Reflection note")).toHaveValue("Too noisy");
  });

  it("closes an open reflection without saving", async () => {
    renderApp(<PlansScreen />);
    expect(await screen.findByText("Desk lamp")).toBeInTheDocument();

    const review = screen.getByRole("button", { name: "Review Desk lamp" });
    fireEvent.click(review);
    expect(screen.getByRole("radiogroup", { name: "Purchase reflection" })).toBeInTheDocument();
    fireEvent.click(review);

    expect(screen.queryByRole("radiogroup", { name: "Purchase reflection" })).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });
});
