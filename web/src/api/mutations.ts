// Write hooks. The mutationFn + invalidation live in queryClient.ts as
// mutation defaults (keyed), so a write started offline is paused by React
// Query and resumed on reconnect, surviving a reload via the persisted cache.
// Hooks here just bind to a key.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { mk, PERSISTED_QUERY_KEY } from "../app/queryClient";
import type { Account, Category, RecurringRule, Transaction } from "./types";
import type { PlannedPurchase } from "./types";

/* auth — online-only, never queued offline */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout", {}),
    networkMode: "always",
    onSuccess: () => {
      qc.clear();
      window.localStorage.removeItem(PERSISTED_QUERY_KEY);
    },
  });
}

/* transactions */
export function useCreateTransaction() {
  return useMutation<unknown, Error, Transaction>({ mutationKey: mk.txnCreate });
}
export function useUpdateTransaction() {
  return useMutation<unknown, Error, { id: string; patch: Partial<Transaction> & { updatedAt: string } }>({
    mutationKey: mk.txnUpdate,
  });
}
export function useDeleteTransaction() {
  return useMutation<unknown, Error, { id: string; updatedAt: string }>({ mutationKey: mk.txnDelete });
}

/* accounts */
export function useCreateAccount() {
  return useMutation<unknown, Error, Pick<Account, "id" | "name" | "type" | "startingBalance">>({
    mutationKey: mk.accountCreate,
  });
}
export function useUpdateAccount() {
  return useMutation<unknown, Error, { id: string; patch: Partial<Account> }>({ mutationKey: mk.accountUpdate });
}
export function useDeleteAccount() {
  return useMutation<unknown, Error, string>({ mutationKey: mk.accountDelete });
}

/* categories */
export function useCreateCategory() {
  return useMutation<unknown, Error, Pick<Category, "id" | "name"> & { icon?: string | null }>({
    mutationKey: mk.categoryCreate,
  });
}
export function useUpdateCategory() {
  return useMutation<unknown, Error, { id: string; patch: Partial<Category> }>({ mutationKey: mk.categoryUpdate });
}
export function useDeleteCategory() {
  return useMutation<unknown, Error, string>({ mutationKey: mk.categoryDelete });
}

/* budgets */
export function useCreateBudget() {
  return useMutation<unknown, Error, { id: string; categoryId: string; limitAmount: number }>({
    mutationKey: mk.budgetCreate,
  });
}
export function useUpdateBudget() {
  return useMutation<unknown, Error, { id: string; limitAmount: number }>({ mutationKey: mk.budgetUpdate });
}
export function useDeleteBudget() {
  return useMutation<unknown, Error, string>({ mutationKey: mk.budgetDelete });
}

/* recurring */
export function useCreateRecurring() {
  return useMutation<unknown, Error, Omit<RecurringRule, "active"> & { active?: boolean }>({
    mutationKey: mk.recurringCreate,
  });
}
export function useUpdateRecurring() {
  return useMutation<unknown, Error, { id: string; patch: Partial<RecurringRule> }>({
    mutationKey: mk.recurringUpdate,
  });
}
export function useDeleteRecurring() {
  return useMutation<unknown, Error, string>({ mutationKey: mk.recurringDelete });
}

export function useCreatePlan() {
  return useMutation<unknown, Error, Pick<PlannedPurchase, "id" | "name" | "amount" | "accountId" | "categoryId" | "plannedDate" | "waitDays">>({ mutationKey: mk.planCreate });
}
export function useUpdatePlan() {
  return useMutation<unknown, Error, { id: string; patch: Partial<PlannedPurchase> }>({ mutationKey: mk.planUpdate });
}
export function useDeletePlan() { return useMutation<unknown, Error, string>({ mutationKey: mk.planDelete }); }
export function useConfirmPlan() { return useMutation<unknown, Error, string>({ mutationKey: mk.planConfirm }); }
