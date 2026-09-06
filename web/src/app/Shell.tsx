import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { AddTransactionSheet } from "../features/transactions/AddTransactionSheet";
import { LogoMark } from "../ui/Logo";
import "./Shell.css";

export function Shell({ children }: { children: ReactNode }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="shell">
      <main className="shell__main">{children}</main>

      <nav className="tabbar" aria-label="Primary">
        <div className="nav__brand" aria-hidden="true">
          <LogoMark size={24} />
          <span className="nav__brandname">Xpenses</span>
        </div>

        <NavLink to="/" end className="tab" aria-label="Home">
          <HomeIcon />
          <span>Home</span>
        </NavLink>
        <NavLink to="/ledger" className="tab" aria-label="Ledger">
          <LedgerIcon />
          <span>Ledger</span>
        </NavLink>

        <button className="fab" onClick={() => setAdding(true)} aria-label="Add transaction">
          <PlusIcon />
          <span className="fab__label">Add</span>
        </button>

        <NavLink to="/reports" className="tab" aria-label="Reports">
          <ReportsIcon />
          <span>Reports</span>
        </NavLink>
        <NavLink to="/plans" className="tab" aria-label="Plans">
          <SettingsIcon />
          <span>Plans</span>
        </NavLink>
      </nav>

      <AddTransactionSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6 10.5V19h12v-8.5" />
    </svg>
  );
}

function LedgerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M9 9h6M9 13h6M9 17h4" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 19V5" />
      <path d="M5 19h14" />
      <path d="M9 15v-3M13 15V8M17 15v-5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
