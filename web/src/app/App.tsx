import { Route, Routes } from "react-router-dom";
import { useMe } from "../api/hooks";
import { ApiError } from "../lib/api";
import { LoginScreen } from "../features/auth/LoginScreen";
import { Shell } from "./Shell";
import { ErrorBoundary } from "./ErrorBoundary";
import { OfflineBanner } from "./OfflineBanner";
import { MonthProvider } from "./MonthContext";
import { DashboardScreen } from "../features/dashboard/DashboardScreen";
import { TransactionsScreen } from "../features/transactions/TransactionsScreen";
import { ReportsScreen } from "../features/reports/ReportsScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { AccountsScreen } from "../features/accounts/AccountsScreen";
import { CategoriesScreen } from "../features/categories/CategoriesScreen";
import { BudgetsScreen } from "../features/budgets/BudgetsScreen";
import { RecurringScreen } from "../features/recurring/RecurringScreen";
import { PlansScreen } from "../features/plans/PlansScreen";
import { ExportScreen } from "../features/settings/ExportScreen";
import { SavingsPotsScreen } from "../features/savingsPots/SavingsPotsScreen";
import "./App.css";

export function App() {
  const me = useMe();

  if (me.isLoading) {
    return <div className="boot" aria-busy="true" aria-label="Loading" />;
  }

  const unauthorized = me.error instanceof ApiError && me.error.code === "UNAUTHORIZED";
  if (unauthorized || !me.data) {
    return <LoginScreen onSuccess={() => me.refetch()} />;
  }

  return (
    <ErrorBoundary>
      <OfflineBanner />
      <MonthProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<DashboardScreen />} />
            <Route path="/ledger" element={<TransactionsScreen />} />
            <Route path="/reports" element={<ReportsScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/settings/accounts" element={<AccountsScreen />} />
            <Route path="/settings/categories" element={<CategoriesScreen />} />
            <Route path="/settings/budgets" element={<BudgetsScreen />} />
            <Route path="/settings/recurring" element={<RecurringScreen />} />
            <Route path="/plans" element={<PlansScreen />} />
            <Route path="/pots" element={<SavingsPotsScreen />} />
            <Route path="/settings/export" element={<ExportScreen />} />
            <Route path="*" element={<DashboardScreen />} />
          </Routes>
        </Shell>
      </MonthProvider>
    </ErrorBoundary>
  );
}
