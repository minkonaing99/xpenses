import { useState } from "react";
import { Link } from "react-router-dom";
import { useLogout } from "../../api/hooks";
import { useMonth } from "../../app/MonthContext";
import { readTheme, saveTheme, type Theme } from "../../lib/theme";
import { PageHeader } from "../../ui/PageHeader";
import { Segmented } from "../../ui/Segmented";
import "./SettingsScreen.css";

// Last calendar day of a YYYY-MM as YYYY-MM-DD.
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, "0")}`;
}

const MANAGE = [
  { to: "/settings/accounts", label: "Accounts", desc: "Cash, bank, and other balances" },
  { to: "/settings/categories", label: "Categories", desc: "How expenses are grouped" },
  { to: "/settings/budgets", label: "Budgets", desc: "Monthly limits per category" },
  { to: "/settings/recurring", label: "Recurring", desc: "Auto-inserted transactions" },
  { to: "/settings/plans", label: "Plans", desc: "Future purchases and waiting periods" },
];

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsScreen() {
  const logout = useLogout();
  const { month } = useMonth();
  const [from, setFrom] = useState(`${month}-01`);
  const [to, setTo] = useState(monthEnd(month));
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : readTheme(),
  );
  const exportHref = `/api/reports/export?from=${from}&to=${to}&format=${format}`;

  function changeTheme(next: Theme) {
    setTheme(next);
    saveTheme(next);
  }

  async function signOut() {
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
      </nav>

      <section className="appearance" aria-label="Appearance">
        <h2 className="settings__section-title">Appearance</h2>
        <Segmented options={THEMES} value={theme} onChange={changeTheme} label="Color theme" />
      </section>

      <section className="export" aria-label="Export">
        <h2 className="settings__section-title">Export</h2>
        <div className="export__row">
          <label className="export__field">
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="export__field">
            To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="export__row">
          <label className="export__field">
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <a className="settings__export btn btn--primary" href={exportHref} download>
            Download {format.toUpperCase()}
          </a>
        </div>
      </section>

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
