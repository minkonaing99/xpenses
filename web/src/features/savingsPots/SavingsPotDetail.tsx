import { useState } from "react";
import {
  useArchiveSavingsPot, useCategories, useCreateSavingsPotMovement,
  useSpendSavingsPot, useUpdateSavingsPot,
} from "../../api/hooks";
import type { SavingsPot } from "../../api/types";
import { bahtToSatang } from "../../lib/money";
import { today } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Money } from "../../ui/Money";
import { MoneyInput } from "../../ui/MoneyInput";
import { Sheet } from "../../ui/Sheet";
import { Select } from "../../ui/Select";

export function SavingsPotDetail({ pot, onClose }: { pot: SavingsPot | null; onClose: () => void }) {
  const [action, setAction] = useState<"allocate" | "release" | "spend" | "edit" | null>(null);
  const archive = useArchiveSavingsPot();

  async function archivePot() {
    if (!pot || !window.confirm(`Archive ${pot.name}?`)) return;
    await archive.mutateAsync(pot.id);
    onClose();
  }
  return <Sheet open={pot !== null} onClose={onClose} title={pot?.name ?? "Savings pot"}>
    {pot && <div className="potdetail">
      <div className="potdetail__balance"><span>Reserved</span><Money amount={pot.reserved} /></div>
      <div className="potdetail__facts">
        <span>Target <Money amount={pot.targetAmount} /></span>
        <span>Available <Money amount={pot.accountAvailable} /></span>
      </div>
      {!pot.archivedAt && <div className="potdetail__actions">
        <Button onClick={() => setAction("allocate")}>Add money</Button>
        <Button variant="quiet" disabled={pot.reserved === 0} onClick={() => setAction("release")}>Release</Button>
        <Button variant="quiet" disabled={pot.reserved === 0} onClick={() => setAction("spend")}>Spend</Button>
      </div>}
      {(action === "allocate" || action === "release") &&
        <MovementForm pot={pot} type={action} onDone={() => setAction(null)} />}
      {action === "spend" && <SpendForm pot={pot} onDone={() => setAction(null)} />}
      {!pot.archivedAt && <div className="potdetail__manage">
        <Button variant="quiet" onClick={() => setAction("edit")}>Edit</Button>
        <Button variant="quiet" disabled={pot.reserved !== 0 || archive.isPending} onClick={archivePot}>Archive</Button>
      </div>}
      {action === "edit" && <EditForm pot={pot} onDone={() => setAction(null)} />}
      <History pot={pot} />
    </div>}
  </Sheet>;
}

function EditForm({ pot, onDone }: { pot: SavingsPot; onDone: () => void }) {
  const update = useUpdateSavingsPot();
  const [name, setName] = useState(pot.name);
  const [targetText, setTargetText] = useState(String(pot.targetAmount / 100));
  const targetAmount = bahtToSatang(targetText);

  async function save() {
    if (!name.trim() || targetAmount === null) return;
    await update.mutateAsync({ id: pot.id, patch: { name: name.trim(), targetAmount } });
    onDone();
  }

  return <div className="potdetail__form">
    <label className="fld"><span className="fld__label">Name</span><input aria-label="Pot name"
      className="add__input" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label className="fld"><span className="fld__label">Target</span><MoneyInput ariaLabel="Target in baht"
      className="add__input" value={targetText} onChange={setTargetText} /></label>
    {update.isError && <p className="pots__error" role="alert">{update.error.message}</p>}
    <Button block disabled={!name.trim() || targetAmount === null || update.isPending} onClick={save}>Save changes</Button>
  </div>;
}

function SpendForm({ pot, onDone }: { pot: SavingsPot; onDone: () => void }) {
  const categories = useCategories();
  const spend = useSpendSavingsPot();
  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const amount = bahtToSatang(amountText);

  async function save() {
    if (amount === null || !categoryId || !window.confirm(`Spend ฿${amountText} from ${pot.name}?`)) return;
    await spend.mutateAsync({
      id: crypto.randomUUID(), potId: pot.id, amount, categoryId,
      note: note.trim() || undefined, txnDate: today(), updatedAt: new Date().toISOString(),
    });
    onDone();
  }

  return <div className="potdetail__form">
    <label className="fld"><span className="fld__label">Purchase amount</span><MoneyInput
      className="add__input" ariaLabel="Purchase amount in baht" value={amountText} onChange={setAmountText} /></label>
    <label className="fld"><span className="fld__label">Category</span><Select label="Category"
      options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))}
      value={categoryId} onChange={setCategoryId} /></label>
    <label className="fld"><span className="fld__label">Note (optional)</span><input aria-label="Purchase note"
      className="add__input" maxLength={255} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {spend.isError && <p className="pots__error" role="alert">{spend.error.message}</p>}
    <Button block disabled={amount === null || amount > pot.reserved || !categoryId || spend.isPending}
      onClick={save}>Record purchase</Button>
  </div>;
}

function MovementForm({ pot, type, onDone }: {
  pot: SavingsPot;
  type: "allocate" | "release";
  onDone: () => void;
}) {
  const create = useCreateSavingsPotMovement();
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const amount = bahtToSatang(amountText);

  async function save() {
    if (amount === null) return;
    if (type === "release" && !window.confirm(`Release ฿${amountText} from ${pot.name}?`)) return;
    await create.mutateAsync({
      id: crypto.randomUUID(), potId: pot.id, type, amount,
      note: note.trim() || undefined,
    });
    onDone();
  }

  return <div className="potdetail__form">
    <label className="fld"><span className="fld__label">Amount</span><MoneyInput
      className="add__input" ariaLabel="Amount in baht" value={amountText} onChange={setAmountText} /></label>
    <label className="fld"><span className="fld__label">Note (optional)</span><input
      className="add__input" maxLength={255} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {amount !== null && <p className="potdetail__preview">
      After {type === "allocate" ? "adding" : "release"}: <Money
        amount={type === "allocate" ? pot.reserved + amount : pot.reserved - amount} /> reserved
    </p>}
    {create.isError && <p className="pots__error" role="alert">{create.error.message}</p>}
    <Button block disabled={amount === null || (type === "release" && amount > pot.reserved) || create.isPending}
      onClick={save}>{type === "allocate" ? "Add to pot" : "Release money"}</Button>
  </div>;
}

function History({ pot }: { pot: SavingsPot }) {
  if (pot.history.length === 0) return <p className="potdetail__empty">No activity yet.</p>;
  return <section className="potdetail__history"><h3>Activity</h3>{pot.history.map((item) => (
    <div className="potdetail__history-row" key={item.id}>
      <span>{item.type === "allocate" ? "Added" : item.type === "release" ? "Released" : item.note || "Purchase"}</span>
      <Money amount={item.amount} tone={item.type === "allocate" ? "pos" : "neg"} />
    </div>
  ))}</section>;
}
