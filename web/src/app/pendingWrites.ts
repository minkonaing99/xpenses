import { type Mutation, type QueryClient, useMutationState } from "@tanstack/react-query";
import { mk } from "./queryClient";

export type WriteStatus = "Waiting for connection" | "Waiting to send" | "Sending" | "Needs attention";

export interface PendingWrite {
  id: number;
  action: string;
  detail: string;
  status: WriteStatus;
  submittedAt: number;
  retryable: boolean;
  blocked: boolean;
  recoveryHref: string;
  recoveryLabel: string;
}

const ACTIONS = new Map<string, string>([
  [mk.txnCreate.join(":"), "Add transaction"],
  [mk.txnUpdate.join(":"), "Edit transaction"],
  [mk.txnDelete.join(":"), "Delete transaction"],
  [mk.accountCreate.join(":"), "Add account"],
  [mk.accountUpdate.join(":"), "Edit account"],
  [mk.accountDelete.join(":"), "Delete account"],
  [mk.categoryCreate.join(":"), "Add category"],
  [mk.categoryUpdate.join(":"), "Edit category"],
  [mk.categoryDelete.join(":"), "Delete category"],
  [mk.budgetCreate.join(":"), "Add budget"],
  [mk.budgetUpdate.join(":"), "Edit budget"],
  [mk.budgetDelete.join(":"), "Delete budget"],
  [mk.recurringCreate.join(":"), "Add recurring transaction"],
  [mk.recurringUpdate.join(":"), "Edit recurring transaction"],
  [mk.recurringDelete.join(":"), "Delete recurring transaction"],
  [mk.planCreate.join(":"), "Add plan"],
  [mk.planUpdate.join(":"), "Edit plan"],
  [mk.planDelete.join(":"), "Delete plan"],
  [mk.planConfirm.join(":"), "Confirm purchase"],
  [mk.potCreate.join(":"), "Add savings pot"],
  [mk.potUpdate.join(":"), "Edit savings pot"],
  [mk.potMovement.join(":"), "Move savings pot money"],
  [mk.potSpend.join(":"), "Spend savings pot money"],
  [mk.potArchive.join(":"), "Archive savings pot"],
]);

function keyName(key: readonly unknown[] | undefined) {
  return key?.map(String).join(":") ?? "";
}

function detailFor(variables: unknown) {
  if (!variables || typeof variables !== "object") return "Saved change";
  const value = variables as Record<string, unknown>;
  const patch = value.patch && typeof value.patch === "object" ? value.patch as Record<string, unknown> : null;
  const detail = value.name ?? value.note ?? patch?.name ?? patch?.note;
  return typeof detail === "string" && detail.trim() ? detail.trim() : "Saved change";
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return String((error as { code: unknown }).code);
}

function recoveryFor(key: readonly unknown[] | undefined) {
  switch (String(key?.[0] ?? "")) {
    case "txn": return { recoveryHref: "/ledger", recoveryLabel: "Open Ledger" };
    case "account": return { recoveryHref: "/settings/accounts", recoveryLabel: "Open Accounts" };
    case "category": return { recoveryHref: "/settings/categories", recoveryLabel: "Open Categories" };
    case "budget": return { recoveryHref: "/settings/budgets", recoveryLabel: "Open Budgets" };
    case "recurring": return { recoveryHref: "/settings/recurring", recoveryLabel: "Open Recurring" };
    case "pot": return { recoveryHref: "/pots", recoveryLabel: "Open Savings Pots" };
    default: return { recoveryHref: "/plans", recoveryLabel: "Open Plans" };
  }
}

function isUnresolvedWrite(mutation: Mutation) {
  return ACTIONS.has(keyName(mutation.options.mutationKey))
    && (mutation.state.status === "pending" || mutation.state.status === "error");
}

export function useUnresolvedWriteCount() {
  return useMutationState({ filters: { predicate: isUnresolvedWrite } }).length;
}

export function usePendingWrites(online: boolean): PendingWrite[] {
  const writes = useMutationState({
    filters: { predicate: isUnresolvedWrite },
    select: (mutation): PendingWrite => ({
      id: mutation.mutationId,
      action: ACTIONS.get(keyName(mutation.options.mutationKey)) ?? "Save change",
      detail: detailFor(mutation.state.variables),
      status: mutation.state.status === "error"
        ? "Needs attention"
        : mutation.state.isPaused
          ? online ? "Waiting to send" : "Waiting for connection"
          : "Sending",
      submittedAt: mutation.state.submittedAt,
      retryable: ["NETWORK", "SERVER_ERROR", "RATE_LIMITED", "BLOCKED_WRITE"].includes(errorCode(mutation.state.error) ?? ""),
      blocked: errorCode(mutation.state.error) === "BLOCKED_WRITE",
      ...recoveryFor(mutation.options.mutationKey),
    }),
  });
  const firstErrorId = writes.find((write) => write.status === "Needs attention")?.id;
  return writes.map((write) => write.blocked && write.id !== firstErrorId ? { ...write, retryable: false } : write);
}

export function retryPendingWrite(client: QueryClient, id: number) {
  const mutation = client.getMutationCache().getAll().find((item) => item.mutationId === id);
  if (!mutation || mutation.state.status !== "error") return Promise.resolve();
  const retryable = ["NETWORK", "SERVER_ERROR", "RATE_LIMITED", "BLOCKED_WRITE"].includes(errorCode(mutation.state.error) ?? "");
  return retryable ? mutation.execute(mutation.state.variables) : Promise.resolve();
}

export function discardPendingWrite(client: QueryClient, id: number) {
  const mutation = client.getMutationCache().getAll().find((item) => item.mutationId === id);
  if (mutation?.state.status === "error") client.getMutationCache().remove(mutation);
}
