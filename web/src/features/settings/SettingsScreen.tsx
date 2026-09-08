import { useState } from "react";
import { Link } from "react-router-dom";
import { useLogout } from "../../api/hooks";
import { readTheme, saveTheme, type Theme } from "../../lib/theme";
import { PageHeader } from "../../ui/PageHeader";
import { Segmented } from "../../ui/Segmented";
import { DashboardCustomizer } from "../dashboard/DashboardCustomizer";
import { loadDashboardPreferences, saveDashboardPreferences } from "../dashboard/dashboardPreferences";
import { useUnresolvedWriteCount } from "../../app/pendingWrites";
import "./SettingsScreen.css";

const MANAGE = [
  { to: "/settings/accounts", label: "Accounts", desc: "Cash, bank, and other balances" },
  { to: "/settings/categories", label: "Categories", desc: "How expenses are grouped" },
  { to: "/settings/budgets", label: "Budgets", desc: "Monthly limits per category" },
  { to: "/settings/recurring", label: "Recurring", desc: "Auto-inserted transactions" },
  { to: "/pots", label: "Savings pots", desc: "Reserve account money for goals" },
  { to: "/settings/export", label: "Export", desc: "Download your transactions" },
];

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsScreen() {
  const logout = useLogout();
  const unresolvedWrites = useUnresolvedWriteCount();
  const [customizing, setCustomizing] = useState(false);
  const [preferences, setPreferences] = useState(loadDashboardPreferences);
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : readTheme(),
  );

  function changeTheme(next: Theme) {
    setTheme(next);
    saveTheme(next);
  }
  function updatePreferences(next: typeof preferences) { setPreferences(next); saveDashboardPreferences(next); }

  async function signOut() {
    if (unresolvedWrites > 0) {
      const changes = `${unresolvedWrites} unsent ${unresolvedWrites === 1 ? "change" : "changes"}`;
      if (!window.confirm(`Sign out and discard ${changes}?`)) return;
    }
    try {
      await logout.mutateAsync();
      location.reload();
    } catch {
      // The mutation state renders the retryable error.
    }
  }

  return (
    <div className="settings">
      <PageHeader title="Settings" />

      <nav className="settings__list" aria-label="Manage">
        {MANAGE.map((m) => (
          <Link key={m.to} to={m.to} className="srow">
            <div className="srow__text">
              <span className="srow__label">{m.label}</span>
              <span className="srow__desc">{m.desc}</span>
            </div>
            <Chevron />
          </Link>
        ))}
        <button className="srow settings__customize" onClick={() => setCustomizing(true)}><span className="srow__text"><span className="srow__label">Customize Home</span><span className="srow__desc">Choose dashboard sections</span></span><Chevron /></button>
      </nav>

      <section className="appearance" aria-label="Appearance">
        <h2 className="settings__section-title">Appearance</h2>
        <Segmented options={THEMES} value={theme} onChange={changeTheme} label="Color theme" />
      </section>

      <DashboardCustomizer open={customizing} value={preferences} onChange={updatePreferences} onClose={() => setCustomizing(false)} />

      {logout.isError && (
        <p className="settings__logout-error" role="alert">
          Couldn't sign out. Check your connection and try again.
        </p>
      )}
      <button className="settings__logout" onClick={signOut} disabled={logout.isPending}>
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
