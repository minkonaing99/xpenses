import { fireEvent, screen } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "../../lib/api";
import { ReportsScreen } from "./ReportsScreen";
import { fakeGet, renderApp } from "../../test/utils";
import { money } from "../../test/money";
import { currentMonth } from "../../lib/format";

const summary = {
  accounts: [{ id: "a1", name: "Cash", type: "cash", balance: 12000 }],
  monthIncome: 50000,
  monthExpense: 30000,
  monthNet: 20000,
};
const spend = [{ categoryId: "c1", name: "Food", total: 30000 }];
const comparisons = [
  {
    categoryId: "c1",
    name: "Food",
    current: 30000,
    last: 20000,
    prevAvg: 22000,
    vsLast: 10000,
    vsAvg: 8000,
    trend: 1,
  },
];
const dailySpend = [{ date: `${currentMonth()}-03`, total: 12000, topCategoryName: "Food" }];

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(
    fakeGet({
      "/reports/summary": summary,
      "/reports/category-spend": spend,
      "/insights/comparisons": comparisons,
      "/reports/daily-spend": dailySpend,
    }) as never,
  );
});
afterEach(() => vi.clearAllMocks());

describe("ReportsScreen", () => {
  it("renders month stats, account balances, and category spend", async () => {
    renderApp(<ReportsScreen />);

    expect(await screen.findByText("Food")).toBeInTheDocument();
    expect(screen.getByText("In")).toBeInTheDocument();
    expect(screen.getByText("Out")).toBeInTheDocument();
    expect(screen.getByText("Net")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByText(money("+฿200.00"))).toBeInTheDocument(); // monthNet
  });

  it("shows a month-over-month spend comparison", async () => {
    renderApp(<ReportsScreen />);
    // Both months resolve to the same mocked summary -> flat delta.
    expect(await screen.findByText(/flat vs last month/i)).toBeInTheDocument();
  });

  it("shows a per-category trend chip vs last month", async () => {
    renderApp(<ReportsScreen />);
    // vsLast = 10000 satang = ฿100, spending up -> ▲ 100
    expect(await screen.findByTitle("vs last month")).toHaveTextContent("100");
  });

  it("drills into the category from chart and category controls", async () => {
    function Location() {
      const location = useLocation();
      return <output aria-label="Current route">{location.pathname}{location.search}</output>;
    }
    renderApp(<><ReportsScreen /><Location /></>);
    const controls = await screen.findAllByRole("button", { name: "View Food transactions" });
    fireEvent.click(controls[0]);
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/ledger?month=");
    expect(screen.getByLabelText("Current route")).toHaveTextContent("categoryId=c1");
  });

  it("shows each day's spend and highest category in the heatmap", async () => {
    renderApp(<ReportsScreen />);

    expect(await screen.findByText("฿120")).toBeInTheDocument();
    expect(screen.getByText("Food", { selector: ".heat__category" })).toBeInTheDocument();
  });
});
