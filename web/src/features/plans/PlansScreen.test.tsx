import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "../../lib/api";
import { PlansScreen } from "./PlansScreen";
import { fakeGet, renderApp } from "../../test/utils";

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(fakeGet({
    "/accounts": [{ id: "a1", name: "Cash", type: "cash", balance: 10000, startingBalance: 0 }],
    "/categories": [{ id: "c1", name: "Food" }],
    "/plans": { plans: [{ id: "p1", name: "Headphones", amount: 3000, accountId: "a1", categoryId: "c1", plannedDate: "2026-09-20", waitDays: 7, waitUntil: "2026-09-13", status: "planned" }], accounts: [{ id: "a1", name: "Cash", balance: 10000, planned: 3000, forecastBalance: 7000 }], budgets: [] },
    "/reports/summary": { monthExpense: 2000 },
  }) as never);
});

describe("PlansScreen", () => {
  it("separates current balance from planned forecast", async () => {
    renderApp(<PlansScreen />);
    expect(await screen.findByText("Headphones")).toBeInTheDocument();
    expect(screen.getByText("Forecast after plans")).toBeInTheDocument();
  });
});
