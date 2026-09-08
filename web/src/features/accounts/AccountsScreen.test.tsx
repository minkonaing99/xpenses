import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api, ApiError } from "../../lib/api";
import { AccountsScreen } from "./AccountsScreen";
import { fakeGet, renderApp } from "../../test/utils";

const accounts = [
  { id: "a1", name: "Cash", type: "cash", startingBalance: 0, balance: 12000, reserved: 3000, available: 9000 },
  { id: "a2", name: "Bank", type: "bank", startingBalance: 0, balance: 0, reserved: 0, available: 0 },
];

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(fakeGet({ "/accounts": accounts }) as never);
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
  vi.mocked(api.del).mockResolvedValue({} as never);
});
afterEach(() => vi.clearAllMocks());

describe("AccountsScreen", () => {
  it("shows balance and pot-adjusted available money", async () => {
    renderApp(<AccountsScreen />);
    expect(await screen.findByText((_text, node) =>
      node?.classList.contains("arow__type") === true && node.textContent?.includes("Available ฿90.00") === true,
    )).toBeInTheDocument();
  });

  it("creates a new account with the typed values", async () => {
    renderApp(<AccountsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));

    fireEvent.change(screen.getByPlaceholderText("e.g. Cash"), { target: { value: "Wallet" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/accounts",
        expect.objectContaining({ name: "Wallet", type: "cash", startingBalance: 15000 }),
      ),
    );
  });

  it("edits an existing account", async () => {
    renderApp(<AccountsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Cash/ }));

    const nameInput = screen.getByDisplayValue("Cash");
    fireEvent.change(nameInput, { target: { value: "Pocket" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/accounts/a1",
        expect.objectContaining({ name: "Pocket" }),
      ),
    );
  });

  it("surfaces a 409 when deleting an account with transactions", async () => {
    vi.mocked(api.del).mockRejectedValue(new ApiError("CONFLICT", "no", 409));
    renderApp(<AccountsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Cash/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("can't be deleted");
  });
});
