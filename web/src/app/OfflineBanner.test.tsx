import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreateTransaction } from "../api/hooks";
import type { Transaction } from "../api/types";
import { ApiError, api } from "../lib/api";
import { OfflineBanner } from "./OfflineBanner";
import { registerMutationDefaults } from "./queryClient";

vi.mock("../lib/api", async (orig) => {
  const actual = await orig<typeof import("../lib/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

const txn: Transaction = {
  id: "t1", type: "expense", amount: 12000, note: "Coffee", categoryId: "c1",
  accountId: "a1", fromAccountId: null, toAccountId: null,
  txnDate: "2026-09-07", updatedAt: "2026-09-07T12:00:00.000Z",
};

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  registerMutationDefaults(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function QueueExpense() {
  const create = useCreateTransaction();
  return <button onClick={() => create.mutate(txn)}>Queue expense</button>;
}

function QueueTwoExpenses() {
  const create = useCreateTransaction();
  return <button onClick={() => {
    create.mutate(txn);
    create.mutate({ ...txn, id: "t2", note: "Lunch" });
  }}>Queue two expenses</button>;
}

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("OfflineBanner", () => {
  it("shows a queued write and opens its details", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    onlineManager.setOnline(false);
    render(<><QueueExpense /><OfflineBanner /></>, { wrapper: Providers });

    fireEvent.click(screen.getByRole("button", { name: "Queue expense" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /1 change waiting to sync/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /1 change waiting to sync/i }));
    expect(await screen.findByRole("dialog", { name: "Sync activity" })).toBeInTheDocument();
    expect(screen.getByText("Add transaction")).toBeInTheDocument();
    expect(screen.getByText("Coffee")).toBeInTheDocument();
    expect(screen.getByText("Waiting for connection")).toBeInTheDocument();
    expect(screen.getByText(/Submitted /)).toBeInTheDocument();
  });

  it("keeps a failed network write visible and retries it once", async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce(new ApiError("NETWORK", "Offline", 0))
      .mockResolvedValueOnce({} as never);
    render(<><QueueExpense /><OfflineBanner /></>, { wrapper: Providers });

    fireEvent.click(screen.getByRole("button", { name: "Queue expense" }));
    const activity = await screen.findByRole("button", { name: /1 change needs attention/i });
    fireEvent.click(activity);
    expect(await screen.findByText("Needs attention")).toBeInTheDocument();

    const retry = screen.getByRole("button", { name: "Retry Add transaction" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Needs attention")).not.toBeInTheDocument());
  });

  it("links validation failures to their editor without retrying", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.post).mockRejectedValue(new ApiError("VALIDATION_ERROR", "Internal detail", 400));
    render(<><QueueExpense /><OfflineBanner /></>, { wrapper: Providers });

    fireEvent.click(screen.getByRole("button", { name: "Queue expense" }));
    fireEvent.click(await screen.findByRole("button", { name: /1 change needs attention/i }));

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry Add transaction" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Ledger" })).toHaveAttribute("href", "/ledger");
    expect(screen.queryByText("Internal detail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard Add transaction" }));
    await waitFor(() => expect(screen.queryByText("Needs attention")).not.toBeInTheDocument());
  });

  it("distinguishes an online queued write from the write being sent", async () => {
    vi.mocked(api.post)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({} as never);
    render(<><QueueTwoExpenses /><OfflineBanner /></>, { wrapper: Providers });

    fireEvent.click(screen.getByRole("button", { name: "Queue two expenses" }));
    fireEvent.click(await screen.findByRole("button", { name: /2 changes/i }));

    expect(await screen.findByText("Waiting to send")).toBeInTheDocument();
    expect(screen.getByText("Sending")).toBeInTheDocument();
  });
});
