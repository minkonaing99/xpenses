import { useEffect, useState } from "react";
import { useAccounts, useCategories, useConfirmPlan, useCreatePlan, useDeletePlan, usePlans, useSummary, useUpdatePlan } from "../../api/hooks";
import type { ConfirmedPurchase, PlannedPurchase, ReflectionRating } from "../../api/types";
import { useMonth } from "../../app/MonthContext";
import { today } from "../../lib/format";
import { bahtToSatang } from "../../lib/money";
import { Button } from "../../ui/Button";
import { Money } from "../../ui/Money";
import { MoneyInput } from "../../ui/MoneyInput";
import { PageHeader } from "../../ui/PageHeader";
import { Select } from "../../ui/Select";
import { Segmented } from "../../ui/Segmented";
import { Sheet } from "../../ui/Sheet";
import { Chips } from "../transactions/Chips";
import "../../ui/form.css";
import "./PlansScreen.css";

export function PlansScreen() {
  const { month } = useMonth();
  const plans = usePlans(month);
  const summary = useSummary(month);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlannedPurchase | null>(null);
  const confirm = useConfirmPlan();
  const remove = useDeletePlan();
  const busy = confirm.isPending || remove.isPending;
  const monthPlans = (plans.data?.plans ?? []).filter((plan) => plan.plannedDate.startsWith(month)).reduce((total, plan) => total + plan.amount, 0);
  return <div className="plans">
    <PageHeader title="Plans" back="/" action={<Button variant="ghost" onClick={() => { setEditing(null); setOpen(true); }}>Add</Button>} />
    <section className="plans__forecast">
      <h2>Forecast after plans</h2>
      {(plans.data?.accounts ?? []).map((account) => <div className="plans__account" key={account.id}>
        <span>{account.name}</span><Money amount={account.forecastBalance} /><small>Now <Money amount={account.balance} /> - planned <Money amount={account.planned} /></small>
      </div>)}
    </section>
    <section className="plans__forecast plans__month">
      <span>This month's expenses</span><Money amount={(summary.data?.monthExpense ?? 0) + monthPlans} />
      <small>Actual <Money amount={summary.data?.monthExpense ?? 0} /> + planned <Money amount={monthPlans} /></small>
    </section>
    <section className="plans__list">
      <h2>Planned purchases</h2>
      {(plans.data?.plans ?? []).length === 0 && <p>No planned purchases.</p>}
      {(plans.data?.plans ?? []).map((plan) => <article key={plan.id} className="plans__item">
        <div><strong>{plan.name}</strong><span>{plan.plannedDate} · ready {plan.waitUntil}</span></div><Money amount={plan.amount} />
        <div className="plans__actions">
          <Button variant="quiet" disabled={busy} onClick={() => { setEditing(plan); setOpen(true); }}>Edit</Button>
          <Button variant="quiet" disabled={busy || today() < plan.waitUntil} onClick={() => confirm.mutate(plan.id)}>Confirm</Button>
          <Button variant="quiet" disabled={busy} onClick={() => remove.mutate(plan.id)}>Delete</Button>
        </div>
      </article>)}
    </section>
    <PurchaseReflections purchases={plans.data?.confirmedPurchases ?? []} />
    <PlanForm open={open} editing={editing} onClose={() => setOpen(false)} />
  </div>;
}

const reflectionOptions: { value: ReflectionRating; label: string }[] = [
  { value: "worth_it", label: "Worth it" },
  { value: "not_sure", label: "Not sure" },
  { value: "regret", label: "Regret" },
];

function reflectionLabel(value?: ReflectionRating | null) {
  return reflectionOptions.find((option) => option.value === value)?.label ?? "Not reviewed";
}

function PurchaseReflections({ purchases }: { purchases: ConfirmedPurchase[] }) {
  const update = useUpdatePlan();
  const [reviewing, setReviewing] = useState<ConfirmedPurchase | null>(null);
  const [rating, setRating] = useState<ReflectionRating>("not_sure");
  const [note, setNote] = useState("");

  function openReview(purchase: ConfirmedPurchase) {
    update.reset();
    setReviewing(purchase);
    setRating(purchase.reflection ?? "not_sure");
    setNote(purchase.reflectionNote ?? "");
  }

  async function save() {
    if (!reviewing) return;
    await update.mutateAsync({ id: reviewing.id, patch: { reflection: rating, reflectionNote: note.trim() || null } });
    setReviewing(null);
  }

  return <section className="plans__list plans__reflections">
    <h2>Purchase reflections</h2>
    {purchases.length === 0 && <p>No confirmed purchases yet.</p>}
    {purchases.map((purchase) => {
      const isReviewing = reviewing?.id === purchase.id;
      const reflection = purchase.reflection ?? "unreviewed";
      return <article key={purchase.id} className="plans__item plans__reflection-card">
      <header className="plans__reflection-header">
        <div className="plans__reflection-title">
          <strong>{purchase.name}</strong>
          <div className="plans__reflection-meta">
            {purchase.purchaseDate ? <time dateTime={purchase.purchaseDate}>{purchase.purchaseDate}</time> : <span>Date unavailable</span>}
            <span className={`plans__reflection-rating plans__reflection-rating--${reflection}`}>{reflectionLabel(purchase.reflection)}</span>
            <Button variant="quiet" className="plans__review" aria-label={`${isReviewing ? "Cancel reflection" : purchase.reflection ? "Edit reflection" : "Review"} ${purchase.name}`} onClick={() => isReviewing ? setReviewing(null) : openReview(purchase)}>
              {isReviewing ? "Cancel" : purchase.reflection ? "Edit" : "Review"}
            </Button>
          </div>
        </div>
        <Money className="plans__reflection-amount" amount={purchase.purchaseAmount ?? purchase.amount} />
      </header>
      {purchase.reflectionNote && <p className="plans__reflection-note">{purchase.reflectionNote}</p>}
      {purchase.purchaseDeletedAt && <small className="plans__deleted">Transaction deleted</small>}
      {isReviewing && <div className="plans__reflection-form">
        <Segmented label="Purchase reflection" options={reflectionOptions} value={rating} onChange={setRating} />
        <label className="fld"><span className="fld__label">Note (optional)</span><textarea className="add__input plans__note" aria-label="Reflection note" maxLength={255} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {update.isError && <p className="aform__error">{update.error.message}</p>}
        <Button block disabled={update.isPending} onClick={save}>{update.isPending ? "Saving..." : "Save reflection"}</Button>
      </div>}
    </article>})}
  </section>;
}

function readyAfter(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toLocaleDateString("en-CA", { timeZone: "UTC" });
}

function PlanForm({ open, editing, onClose }: { open: boolean; editing: PlannedPurchase | null; onClose: () => void }) {
  const accounts = useAccounts(); const categories = useCategories(); const create = useCreatePlan(); const update = useUpdatePlan();
  const [name, setName] = useState(""); const [amount, setAmount] = useState(""); const [accountId, setAccountId] = useState<string | null>(null); const [categoryId, setCategoryId] = useState<string | null>(null); const [plannedDate, setPlannedDate] = useState(today()); const [waitDays, setWaitDays] = useState("7");
  const [dirty, setDirty] = useState(false);
  const satang = bahtToSatang(amount); const wait = Number(waitDays); const valid = !!name.trim() && !!satang && satang > 0 && !!accountId && !!categoryId && Number.isInteger(wait) && wait >= 0 && wait <= 30;
  useEffect(() => { if (open) { setDirty(false); setName(editing?.name ?? ""); setAmount(editing ? String(editing.amount / 100) : ""); setAccountId(editing?.accountId ?? null); setCategoryId(editing?.categoryId ?? null); setPlannedDate(editing?.plannedDate ?? today()); setWaitDays(String(editing?.waitDays ?? 7)); } }, [open, editing]);
  async function save() { if (!valid || !satang || !accountId || !categoryId) return; const fields = { name: name.trim(), amount: satang, accountId, categoryId, plannedDate, waitDays: wait }; if (editing) await update.mutateAsync({ id: editing.id, patch: fields }); else await create.mutateAsync({ id: crypto.randomUUID(), ...fields }); onClose(); }
  return <Sheet open={open} onClose={onClose} dirty={dirty} title={editing ? "Edit plan" : "Plan purchase"}><div className="planform">
    <label className="planform__amount"><span className="planform__baht" aria-hidden="true">฿</span><MoneyInput value={amount} onChange={(value) => { setAmount(value); setDirty(true); }} ariaLabel="Price in baht" autoFocus={!editing} /></label>
    <div className="fld"><span className="fld__label">Category</span><Select label="Category" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} value={categoryId} onChange={(value) => { setCategoryId(value); setDirty(true); }} placeholder="Select category" /></div>
    <div className="fld"><span className="fld__label">Paid from</span><Chips options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))} value={accountId} onChange={(value) => { setAccountId(value); setDirty(true); }} /></div>
    <div className="planform__row"><label className="fld fld--grow"><span className="fld__label">Item</span><input className="add__input" value={name} maxLength={255} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></label><label className="fld"><span className="fld__label">Planned date</span><input className="add__input add__date" type="date" min={today()} value={plannedDate} onChange={(e) => { setPlannedDate(e.target.value); setDirty(true); }} /></label></div>
    <label className="fld planform__wait"><span className="fld__label">Wait days</span><input className="add__input" type="number" min="0" max="30" value={waitDays} onChange={(e) => { setWaitDays(e.target.value); setDirty(true); }} /><small>Ready after {wait} days: {readyAfter(today(), Number.isFinite(wait) ? wait : 0)}</small></label>
    <Button block disabled={!valid || create.isPending || update.isPending} onClick={save}>{create.isPending || update.isPending ? "Saving…" : "Save plan"}</Button>
  </div></Sheet>;
}
