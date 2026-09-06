// One query client with mutation defaults registered by key. Registering the
// mutationFn on the client (not just in a hook) is what lets React Query resume
// a write that was queued while offline — even across a reload, once the
// persisted cache is restored. See main.tsx for the persister wiring.
import { QueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Account, Category, RecurringRule, Transaction } from "../api/types";

export const PERSISTED_QUERY_KEY = "xpenses-cache";

export const mk = {
  txnCreate: ["txn", "create"] as const,
  txnUpdate: ["txn", "update"] as const,
  txnDelete: ["txn", "delete"] as const,
  accountCreate: ["account", "create"] as const,
  accountUpdate: ["account", "update"] as const,
  accountDelete: ["account", "delete"] as const,
  categoryCreate: ["category", "create"] as const,
  categoryUpdate: ["category", "update"] as const,
  categoryDelete: ["category", "delete"] as const,
  budgetCreate: ["budget", "create"] as const,
  budgetUpdate: ["budget", "update"] as const,
  budgetDelete: ["budget", "delete"] as const,
  recurringCreate: ["recurring", "create"] as const,
  recurringUpdate: ["recurring", "update"] as const,
  recurringDelete: ["recurring", "delete"] as const,
  planCreate: ["plan", "create"] as const,
  planUpdate: ["plan", "update"] as const,
  planDelete: ["plan", "delete"] as const,
  planConfirm: ["plan", "confirm"] as const,
};

type IdPatch<T> = { id: string; patch: Partial<T> };

export function registerMutationDefaults(qc: QueryClient): void {
  // Solo app, low write volume: after any write just refetch everything active.
  // ponytail: broad invalidate over per-entity targeting; narrow it if refetch cost shows.
  const onSettled = () => {
    qc.invalidateQueries();
  };
  const def = <V,>(key: readonly string[], mutationFn: (v: V) => Promise<unknown>) =>
    qc.setMutationDefaults(key, { mutationFn: mutationFn as (v: unknown) => Promise<unknown>, onSettled });

  def<Transaction>(mk.txnCreate, (t) => api.post("/transactions", t));
  def<IdPatch<Transaction> & { patch: { updatedAt: string } }>(mk.txnUpdate, (v) =>
    api.patch(`/transactions/${v.id}`, v.patch),
  );
  def<{ id: string; updatedAt: string }>(mk.txnDelete, (v) =>
    api.del(`/transactions/${v.id}`, { updatedAt: v.updatedAt }),
  );

  def<Pick<Account, "id" | "name" | "type" | "startingBalance">>(mk.accountCreate, (a) =>
    api.post("/accounts", a),
  );
  def<IdPatch<Account>>(mk.accountUpdate, (v) => api.patch(`/accounts/${v.id}`, v.patch));
  def<string>(mk.accountDelete, (id) => api.del(`/accounts/${id}`));

  def<Pick<Category, "id" | "name"> & { icon?: string | null }>(mk.categoryCreate, (c) =>
    api.post("/categories", c),
  );
  def<IdPatch<Category>>(mk.categoryUpdate, (v) => api.patch(`/categories/${v.id}`, v.patch));
  def<string>(mk.categoryDelete, (id) => api.del(`/categories/${id}`));

  def<{ id: string; categoryId: string; limitAmount: number }>(mk.budgetCreate, (b) =>
    api.post("/budgets", b),
  );
  def<{ id: string; limitAmount: number }>(mk.budgetUpdate, (v) =>
    api.patch(`/budgets/${v.id}`, { limitAmount: v.limitAmount }),
  );
  def<string>(mk.budgetDelete, (id) => api.del(`/budgets/${id}`));

  def<Omit<RecurringRule, "active"> & { active?: boolean }>(mk.recurringCreate, (r) =>
    api.post("/recurring", r),
  );
  def<IdPatch<RecurringRule>>(mk.recurringUpdate, (v) => api.patch(`/recurring/${v.id}`, v.patch));
  def<string>(mk.recurringDelete, (id) => api.del(`/recurring/${id}`));
  def<Pick<import("../api/types").PlannedPurchase, "id" | "name" | "amount" | "accountId" | "categoryId" | "plannedDate" | "waitDays">>(mk.planCreate, (p) => api.post("/plans", p));
  def<{ id: string; patch: Partial<import("../api/types").PlannedPurchase> }>(mk.planUpdate, (v) => api.patch(`/plans/${v.id}`, v.patch));
  def<string>(mk.planDelete, (id) => api.del(`/plans/${id}`));
  def<string>(mk.planConfirm, (id) => api.post(`/plans/${id}/confirm`, {}));
}

export function makeQueryClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, staleTime: 30_000, retry: 1 },
      // networkMode 'online' (default): writes pause while offline and resume on reconnect.
      mutations: { retry: 0 },
    },
  });
  registerMutationDefaults(qc);
  return qc;
}
