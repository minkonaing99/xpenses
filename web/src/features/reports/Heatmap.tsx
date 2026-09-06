import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useDailySpend, usePlans, useUpcomingRange } from "../../api/hooks";
import { useMonth } from "../../app/MonthContext";
import { formatSatang } from "../../lib/money";
import "./Heatmap.css";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

// Every YYYY-MM-DD in the month. Plain string math — no local-TZ Date drift.
function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun .. 6 Sat
}

/** Calendar heatmap of expense-only daily spend for the selected month. */
export function Heatmap() {
  const { month } = useMonth();
  const days = monthDays(month);
  const from = days[0];
  const to = days[days.length - 1];
  const q = useDailySpend(from, to);
  const plans = usePlans(month);
  const recurring = useUpcomingRange(from, to);

  const byDate = useMemo(() => {
    return new Map((q.data ?? []).map((d) => [d.date, d]));
  }, [q.data]);

  const max = Math.max(1, ...(q.data ?? []).map((d) => d.total));
  const lead = weekday(from); // blank cells before day 1

  return (
    <section className="rcard">
      <h2 className="rcard__title">Daily spend</h2>
      <div className="heat">
        {DOW.map((d, i) => (
          <span key={`d${i}`} className="heat__dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }).map((_, i) => (
          <span key={`b${i}`} className="heat__cell heat__cell--blank" aria-hidden="true" />
        ))}
        {days.map((iso) => {
          const spend = byDate.get(iso);
          const total = spend?.total ?? 0;
          const level = total === 0 ? 0 : Math.min(4, Math.ceil((total / max) * 4));
          const plan = (plans.data?.plans ?? []).find((item) => item.plannedDate === iso);
          const recurrence = (recurring.data ?? []).find((item) => item.date === iso);
          return (
            <div key={iso} className={`heat__cell heat__cell--l${level}`}>
              <span className="heat__date">{Number(iso.slice(8))}</span>
              {total > 0 && <span className="heat__amount">฿{formatSatang(total)}</span>}
              {spend?.topCategoryName && <span className="heat__category">{spend.topCategoryName}</span>}
              {plan && <Link className="heat__event" to="/plans">Plan</Link>}
              {recurrence && <Link className="heat__event" to="/settings/recurring">Recurring</Link>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
