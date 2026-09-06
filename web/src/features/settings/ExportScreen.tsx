import { useState } from "react";
import { useMonth } from "../../app/MonthContext";
import { PageHeader } from "../../ui/PageHeader";
import "./SettingsScreen.css";

function monthEnd(month: string) { const [year, monthNumber] = month.split("-").map(Number); return `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`; }

export function ExportScreen() {
  const { month } = useMonth(); const [from, setFrom] = useState(`${month}-01`); const [to, setTo] = useState(monthEnd(month)); const [format, setFormat] = useState<"csv" | "json">("csv");
  return <div className="settings"><PageHeader title="Export" back="/settings" /><section className="export" aria-label="Export"><label className="export__field">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label className="export__field">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label><label className="export__field">Format<select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}><option value="csv">CSV</option><option value="json">JSON</option></select></label><a className="settings__export btn btn--primary" href={`/api/reports/export?from=${from}&to=${to}&format=${format}`} download>Download {format.toUpperCase()}</a></section></div>;
}
