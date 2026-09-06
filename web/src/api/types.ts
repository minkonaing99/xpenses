// Domain types mirroring the API. Money fields are integer satang.

export type TxnType = "expense" | "income" | "transfer";
export type AccountType = "cash" | "bank" | "other";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  startingBalance: number;
  balance: number; // computed current balance (satang)
}

export interface Category {
  id: string;
  name: string;
  icon?: string | null;
}

export interface Transaction {
  id: string;
  type: TxnType;
  amount: number; // satang, always > 0
  note?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  txnDate: string; // YYYY-MM-DD
  updatedAt: string; // ISO datetime
}

export interface BudgetStatus {
  id: string;
  categoryId: string;
  limitAmount: number; // satang
  spent: number; // satang
  over: boolean;
}

export type IntervalUnit = "day" | "week" | "month";

export interface RecurringRule {
  id: string;
  type: TxnType;
  amount: number; // satang
  note?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  nextRunDate: string; // YYYY-MM-DD
  active: boolean;
}

export interface CategorySpend {
  categoryId: string;
  name: string;
  total: number; // satang
}

export interface DailySpend {
  date: string; // YYYY-MM-DD
  total: number; // satang, expense-only
  topCategoryName?: string;
}

export interface PlannedPurchase {
  id: string;
  name: string;
  amount: number;
  accountId: string;
  categoryId: string;
  plannedDate: string;
  waitDays: number;
  waitUntil: string;
  status: "planned" | "confirmed";
  confirmedTransactionId?: string | null;
}

export interface PlansData {
  plans: PlannedPurchase[];
  accounts: (Account & { planned: number; forecastBalance: number })[];
  budgets: (BudgetStatus & { planned: number; forecastSpent: number; overForecast: boolean })[];
}

// A recurring rule projected onto a concrete upcoming date.
export type UpcomingRecurring = RecurringRule & { date: string };

export interface Summary {
  accounts: Account[];
  monthIncome: number; // satang
  monthExpense: number; // satang
  monthNet: number; // satang, income - expense this month
}

export type Anomaly =
  | { type: "budget_burn"; categoryId: string; name: string; spent: number; limit: number; pct: number }
  | {
      type: "category_velocity";
      categoryId: string;
      name: string;
      currentSpent: number;
      avg3mo: number;
      projectedFull: number;
    };

export interface Comparison {
  categoryId: string;
  name: string;
  current: number; // satang, this month
  last: number; // satang, last month
  prevAvg: number; // satang, trailing 3-month average
  vsLast: number; // current - last
  vsAvg: number; // current - prevAvg
  trend: number; // sign of vsLast: 1 up, -1 down, 0 flat
}
