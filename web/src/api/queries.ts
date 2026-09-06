// Read hooks. Endpoint shapes live here and in mutations.ts.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { keys } from "./keys";
import type {
  Account,
  Anomaly,
  BudgetStatus,
  CategorySpend,
  Category,
  Comparison,
  DailySpend,
  RecurringRule,
  Summary,
  Transaction,
  TxnType,
  UpcomingRecurring,
  PlansData,
} from "./types";

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<{ authenticated: boolean }>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function useAccounts() {
  return useQuery({ queryKey: keys.accounts, queryFn: () => api.get<Account[]>("/accounts") });
}

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: () => api.get<Category[]>("/categories"),
    staleTime: 5 * 60_000,
  });
}

export function useRecurring() {
  return useQuery({
    queryKey: keys.recurring,
    queryFn: () => api.get<RecurringRule[]>("/recurring"),
  });
}

export function useSummary(month: string) {
  return useQuery({
    queryKey: keys.summary(month),
    queryFn: () => api.get<Summary>(`/reports/summary?month=${month}`),
  });
}

export function useBudgets(month: string) {
  return useQuery({
    queryKey: keys.budgets(month),
    queryFn: () => api.get<BudgetStatus[]>(`/budgets?month=${month}`),
  });
}

export function useCategorySpend(month: string) {
  return useQuery({
    queryKey: keys.spend(month),
    queryFn: () => api.get<CategorySpend[]>(`/reports/category-spend?month=${month}`),
  });
}

export interface TransactionQueryFilters {
  type?: TxnType | null;
  accountId?: string | null;
  categoryId?: string | null;
}

export function useTransactions(month: string, filters: TransactionQueryFilters = {}) {
  const { type, accountId, categoryId } = filters;
  return useInfiniteQuery({
    queryKey: keys.txns(month, type ?? "", accountId ?? "", categoryId ?? ""),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ month, limit: "200" });
      if (type) query.set("type", type);
      if (accountId) query.set("accountId", accountId);
      if (categoryId) query.set("categoryId", categoryId);
      if (pageParam) query.set("cursor", pageParam);
      return api.getPage<Transaction[]>(`/transactions?${query}`);
    },
    getNextPageParam: (lastPage, _pages, _lastPageParam, pageParams) => {
      const nextCursor = lastPage.nextCursor;
      return nextCursor && !pageParams.includes(nextCursor) ? nextCursor : undefined;
    },
    select: (result) => result.pages.flatMap((page) => page.data),
  });
}

export function useAnomalies(month: string) {
  return useQuery({
    queryKey: keys.anomalies(month),
    queryFn: () => api.get<Anomaly[]>(`/insights/anomalies?month=${month}`),
  });
}

export function useComparisons(month: string) {
  return useQuery({
    queryKey: keys.comparisons(month),
    queryFn: () => api.get<Comparison[]>(`/insights/comparisons?month=${month}`),
  });
}

/** Expense-only spend per day over [from, to] inclusive — feeds the heatmap. */
export function useDailySpend(from: string, to: string) {
  return useQuery({
    queryKey: keys.dailySpend(from, to),
    queryFn: () => api.get<DailySpend[]>(`/reports/daily-spend?from=${from}&to=${to}`),
  });
}

/** Recurring rules projected onto their next occurrences within `days`. */
export function useUpcoming(days = 30) {
  return useQuery({
    queryKey: keys.upcoming(days),
    queryFn: () => api.get<UpcomingRecurring[]>(`/recurring/upcoming?days=${days}`),
  });
}

export function useUpcomingRange(from: string, to: string) {
  return useQuery({ queryKey: keys.upcomingRange(from, to), queryFn: () => api.get<UpcomingRecurring[]>(`/recurring/upcoming?from=${from}&to=${to}`) });
}

export function usePlans(month: string) {
  return useQuery({ queryKey: keys.plans(month), queryFn: () => api.get<PlansData>(`/plans?month=${month}`) });
}

/** Latest transactions across all months — powers quick-add "repeat" templates. */
export function useRecentTransactions() {
  return useQuery({
    queryKey: keys.recentTxns,
    queryFn: () => api.get<Transaction[]>("/transactions?limit=30"),
  });
}
