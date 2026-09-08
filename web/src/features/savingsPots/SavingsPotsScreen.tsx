import { useState } from "react";
import { useAccounts, useCreateSavingsPot, useSavingsPots } from "../../api/hooks";
import { bahtToSatang } from "../../lib/money";
import { Button } from "../../ui/Button";
import { Money } from "../../ui/Money";
import { MoneyInput } from "../../ui/MoneyInput";
import { PageHeader } from "../../ui/PageHeader";
import { Sheet } from "../../ui/Sheet";
import { Chips } from "../transactions/Chips";
import { SavingsPotDetail } from "./SavingsPotDetail";
import type { SavingsPot } from "../../api/types";
import "../../ui/form.css";
import "./SavingsPotsScreen.css";

export function SavingsPotsScreen() {
  const pots = useSavingsPots();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = [...(pots.data?.active ?? []), ...(pots.data?.archived ?? [])]
    .find((pot) => pot.id === selectedId) ?? null;

  return (
    <div className="pots">
      <PageHeader title="Savings pots" back="/settings"
        action={<Button variant="ghost" onClick={() => setCreating(true)}>Add</Button>} />
      {pots.isLoading && <div className="pots__skeleton" aria-label="Loading savings pots" />}
      {pots.isError && <p className="pots__error" role="alert">Could not load savings pots.</p>}
      {!pots.isLoading && (pots.data?.active.length ?? 0) === 0 && (
        <div className="pots__empty">
          <strong>Give saved money a job</strong>
          <p>Create a pot without moving money out of its account.</p>
        </div>
      )}
      <div className="pots__list">
        {(pots.data?.active ?? []).map((pot) => (
          <PotCard key={pot.id} pot={pot} onOpen={() => setSelectedId(pot.id)} />
        ))}
      </div>
      {(pots.data?.archived.length ?? 0) > 0 && <details className="pots__archived">
        <summary>Archived ({pots.data!.archived.length})</summary>
        <div className="pots__list">{pots.data!.archived.map((pot) => (
          <PotCard key={pot.id} pot={pot} onOpen={() => setSelectedId(pot.id)} />
        ))}</div>
      </details>}
      <SavingsPotDetail pot={selected} onClose={() => setSelectedId(null)} />
      <CreatePotForm open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function PotCard({ pot, onOpen }: { pot: SavingsPot; onOpen: () => void }) {
  return <button className="pot" onClick={onOpen}>
    <span className="pot__head"><strong>{pot.name}</strong><Money amount={pot.reserved} /></span>
    <span className="pot__track" role="progressbar" aria-label={`${pot.name} progress`}
      aria-valuenow={Math.min(100, pot.progress)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.min(100, Math.max(0, pot.progress))}%` }} />
    </span>
    <span className="pot__meta">
      <span>{pot.progress}% funded</span>
      <span>Target <Money amount={pot.targetAmount} /></span>
    </span>
    <span className={pot.shortfall > 0 ? "pot__available pot__available--short" : "pot__available"}>
      Available in {pot.accountName} <Money amount={pot.accountAvailable} />
    </span>
  </button>;
}

function CreatePotForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useAccounts();
  const create = useCreateSavingsPot();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const amount = bahtToSatang(target);
  const valid = name.trim().length > 0 && amount !== null && accountId !== null;

  async function save() {
    if (!valid || amount === null || accountId === null) return;
    await create.mutateAsync({ id: crypto.randomUUID(), name: name.trim(), targetAmount: amount, accountId });
    setName(""); setTarget(""); setAccountId(null); setDirty(false); onClose();
  }

  return <Sheet open={open} onClose={onClose} dirty={dirty} title="New savings pot">
    <div className="potform">
      <label className="fld"><span className="fld__label">Name</span><input className="add__input"
        aria-label="Pot name" maxLength={80} value={name} autoFocus
        onChange={(event) => { setName(event.target.value); setDirty(true); }} /></label>
      <label className="fld"><span className="fld__label">Target</span><MoneyInput className="add__input"
        ariaLabel="Target in baht" value={target}
        onChange={(value) => { setTarget(value); setDirty(true); }} /></label>
      <div className="fld"><span className="fld__label">Held in</span><Chips
        options={(accounts.data ?? []).map((account) => ({ value: account.id, label: account.name }))}
        value={accountId} onChange={(value) => { setAccountId(value); setDirty(true); }} /></div>
      {create.isError && <p className="pots__error" role="alert">{create.error.message}</p>}
      <Button block disabled={!valid || create.isPending} onClick={save}>
        {create.isPending ? "Creating..." : "Create pot"}
      </Button>
    </div>
  </Sheet>;
}
