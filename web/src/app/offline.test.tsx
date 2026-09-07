import { dehydrate, hydrate, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async (orig) => {
  const actual = await orig<typeof import("../lib/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "../lib/api";
import {
  makeQueryClient,
  mk,
  pruneExpiredQueries,
  QUERY_CACHE_MAX_AGE,
  registerMutationDefaults,
} from "./queryClient";
import { useCreateTransaction } from "../api/hooks";
import type { Transaction } from "../api/types";
import { ApiError } from "../lib/api";

const txn: Transaction = {
  id: "t1",
  type: "expense",
  amount: 12000,
  note: "offline latte",
  categoryId: "c1",
  accountId: "a1",
  fromAccountId: null,
  toAccountId: null,
  txnDate: "2026-07-11",
  updatedAt: "2026-07-11T00:00:00.000Z",
};

afterEach(() => {
  onlineManager.setOnline(true);
  vi.resetAllMocks();
});

describe("offline write queue", () => {
  it("pauses a write while offline, then replays it on reconnect", async () => {
    vi.mocked(api.post).mockResolvedValue({} as never);
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });
    registerMutationDefaults(qc);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    onlineManager.setOnline(false);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });
    result.current.mutate(txn);

    // Offline: the request must not go out.
    await waitFor(() => expect(result.current.isPaused).toBe(true));
    expect(api.post).not.toHaveBeenCalled();

    // Reconnect: the queued write replays automatically.
    onlineManager.setOnline(true);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/transactions", txn));
  });

  it("preserves a failed write for recovery after reload", async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError("NETWORK", "Offline", 0));
    const client = makeQueryClient();
    const mutation = client.getMutationCache().build(client, { mutationKey: mk.txnCreate });

    await expect(mutation.execute(txn)).rejects.toMatchObject({ code: "NETWORK" });
    const dehydrated = dehydrate(client);
    expect(dehydrated.mutations).toHaveLength(1);

    const restored = makeQueryClient();
    hydrate(restored, dehydrated);
    expect(restored.getMutationCache().getAll()[0]?.state).toMatchObject({ status: "error", variables: txn });
  });

  it("sends queued writes in submission order", async () => {
    let finishFirst: (() => void) | undefined;
    vi.mocked(api.post)
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = () => resolve({} as never); }))
      .mockResolvedValueOnce({} as never);
    const client = makeQueryClient();
    const first = client.getMutationCache().build(client, { mutationKey: mk.txnCreate });
    const second = client.getMutationCache().build(client, { mutationKey: mk.txnCreate });

    const firstRun = first.execute(txn);
    const secondRun = second.execute({ ...txn, id: "t2", note: "Lunch" });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    finishFirst?.();
    await Promise.all([firstRun, secondRun]);
    expect(api.post).toHaveBeenNthCalledWith(2, "/transactions", expect.objectContaining({ id: "t2" }));
  });

  it("does not send a later write after an earlier write fails", async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce(new ApiError("VALIDATION_ERROR", "Bad first write", 400))
      .mockResolvedValueOnce({} as never);
    const client = makeQueryClient();
    const first = client.getMutationCache().build(client, { mutationKey: mk.txnCreate });
    const second = client.getMutationCache().build(client, { mutationKey: mk.txnCreate });

    await expect(first.execute(txn)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(second.execute({ ...txn, id: "t2" })).rejects.toMatchObject({ code: "BLOCKED_WRITE" });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("does not let an unrelated failed mutation block writes", async () => {
    const client = makeQueryClient();
    const logout = client.getMutationCache().build(client, {
      mutationKey: ["auth", "logout"],
      mutationFn: () => Promise.reject(new Error("Logout failed")),
    });
    await expect(logout.execute(undefined)).rejects.toThrow("Logout failed");
    vi.mocked(api.post).mockResolvedValue({} as never);

    const write = client.getMutationCache().build(client, { mutationKey: mk.txnCreate });
    await expect(write.execute(txn)).resolves.toEqual({});
  });

  it("expires old read cache without deleting unresolved writes", async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError("NETWORK", "Offline", 0));
    const client = makeQueryClient();
    const now = Date.now();
    client.setQueryData(["old"], {}, { updatedAt: now - QUERY_CACHE_MAX_AGE - 1 });
    client.setQueryData(["fresh"], {}, { updatedAt: now });
    const write = client.getMutationCache().build(client, { mutationKey: mk.txnCreate });
    await expect(write.execute(txn)).rejects.toMatchObject({ code: "NETWORK" });

    pruneExpiredQueries(client, now);

    expect(client.getQueryData(["old"])).toBeUndefined();
    expect(client.getQueryData(["fresh"])).toEqual({});
    expect(client.getMutationCache().getAll()).toContain(write);
  });
});
