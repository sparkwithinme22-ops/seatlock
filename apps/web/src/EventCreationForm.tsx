import { FormEvent, useMemo, useState } from "react";

export type PricingTierDraft = {
  name: string;
  rowCount: number;
  priceRupees: number;
  color: string;
};

export type EventDraft = {
  name: string;
  venue: string;
  startsAt: string;
  seatsPerRow: number;
  pricingTiers: PricingTierDraft[];
};

const colors = ["#F6C453", "#80ED99", "#7EA8FF", "#C792EA", "#FF8A80"];

function initialDraft(): EventDraft {
  return {
    name: "",
    venue: "",
    startsAt: "",
    seatsPerRow: 8,
    pricingTiers: [
      { name: "VIP", rowCount: 1, priceRupees: 1200, color: colors[0] },
      { name: "Standard", rowCount: 2, priceRupees: 500, color: colors[1] },
    ],
  };
}

type Props = {
  creating: boolean;
  onChange: () => void;
  onCreate: (draft: EventDraft) => Promise<boolean>;
};

export function EventCreationForm({ creating, onChange, onCreate }: Props) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(initialDraft);
  const [validationMessage, setValidationMessage] = useState("");
  const totalRows = draft.pricingTiers.reduce((sum, tier) => sum + tier.rowCount, 0);
  const totalSeats = totalRows * draft.seatsPerRow;
  const rowAssignments = useMemo(() => {
    let rowIndex = 0;
    return draft.pricingTiers.map((tier) => {
      const first = String.fromCharCode(65 + rowIndex);
      rowIndex += tier.rowCount;
      const last = String.fromCharCode(64 + rowIndex);
      return { ...tier, rows: first === last ? first : `${first}–${last}` };
    });
  }, [draft.pricingTiers]);

  function update(next: EventDraft) {
    setDraft(next);
    setValidationMessage("");
    onChange();
  }

  function updateTier(index: number, values: Partial<PricingTierDraft>) {
    update({
      ...draft,
      pricingTiers: draft.pricingTiers.map((tier, tierIndex) => (
        tierIndex === index ? { ...tier, ...values } : tier
      )),
    });
  }

  function validateStep() {
    if (step === 1 && (draft.name.trim().length < 3 || draft.venue.trim().length < 2 || !draft.startsAt)) {
      setValidationMessage("Complete the event name, venue, and start time.");
      return false;
    }
    if (step === 2) {
      const names = draft.pricingTiers.map((tier) => tier.name.trim().toLowerCase());
      if (draft.seatsPerRow < 1 || draft.seatsPerRow > 30 || totalRows < 1 || totalRows > 10) {
        setValidationMessage("Use 1–30 seats per row and no more than 10 rows in total.");
        return false;
      }
      if (draft.pricingTiers.some((tier) => tier.name.trim().length < 2 || tier.rowCount < 1 || tier.priceRupees < 0)) {
        setValidationMessage("Every tier needs a name, at least one row, and a valid price.");
        return false;
      }
      if (new Set(names).size !== names.length) {
        setValidationMessage("Pricing tier names must be unique.");
        return false;
      }
    }
    return true;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (creating || !validateStep()) return;
    if (await onCreate(draft)) {
      setDraft(initialDraft());
      setStep(1);
    }
  }

  return (
    <form className="event-builder" onSubmit={submit}>
      <div className="builder-progress" aria-label={`Event creation step ${step} of 3`}>
        {["Details", "Pricing", "Review"].map((label, index) => (
          <span className={step >= index + 1 ? "active" : ""} key={label}>
            <b>{index + 1}</b>{label}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div className="stacked-form builder-step">
          <label>Event name<input value={draft.name} onChange={(event) => update({ ...draft, name: event.target.value })} placeholder="Design After Dark" minLength={3} required /></label>
          <label>Venue<input value={draft.venue} onChange={(event) => update({ ...draft, venue: event.target.value })} placeholder="City Auditorium" minLength={2} required /></label>
          <label>Start time<input value={draft.startsAt} onChange={(event) => update({ ...draft, startsAt: event.target.value })} type="datetime-local" required /></label>
        </div>
      )}

      {step === 2 && (
        <div className="builder-step">
          <label className="builder-field">Seats per row<input value={draft.seatsPerRow} onChange={(event) => update({ ...draft, seatsPerRow: Number(event.target.value) })} type="number" min="1" max="30" required /></label>
          <div className="tier-heading"><span>Pricing tiers</span><small>{totalRows}/10 rows · {totalSeats} seats</small></div>
          <div className="tier-list">
            {draft.pricingTiers.map((tier, index) => (
              <div className="tier-card" key={`${index}-${tier.color}`}>
                <input aria-label={`Tier ${index + 1} color`} className="color-input" type="color" value={tier.color} onChange={(event) => updateTier(index, { color: event.target.value })} />
                <label>Name<input value={tier.name} onChange={(event) => updateTier(index, { name: event.target.value })} /></label>
                <label>Rows<input value={tier.rowCount} onChange={(event) => updateTier(index, { rowCount: Number(event.target.value) })} type="number" min="1" max="10" /></label>
                <label>Price ₹<input value={tier.priceRupees} onChange={(event) => updateTier(index, { priceRupees: Number(event.target.value) })} type="number" min="0" /></label>
                <button aria-label={`Remove ${tier.name} tier`} className="icon-button" disabled={draft.pricingTiers.length === 1} onClick={() => update({ ...draft, pricingTiers: draft.pricingTiers.filter((_, tierIndex) => tierIndex !== index) })} type="button">×</button>
              </div>
            ))}
          </div>
          <button className="secondary-button" disabled={draft.pricingTiers.length === 5} onClick={() => update({
            ...draft,
            pricingTiers: [...draft.pricingTiers, { name: `Tier ${draft.pricingTiers.length + 1}`, rowCount: 1, priceRupees: 500, color: colors[draft.pricingTiers.length] }],
          })} type="button">+ Add pricing tier</button>
        </div>
      )}

      {step === 3 && (
        <div className="builder-step review-card">
          <div><span>Event</span><strong>{draft.name}</strong><small>{draft.venue} · {new Date(draft.startsAt).toLocaleString()}</small></div>
          <div><span>Inventory</span><strong>{totalSeats} seats</strong><small>{totalRows} rows · {draft.seatsPerRow} seats per row</small></div>
          <div className="review-tiers">
            {rowAssignments.map((tier) => <p key={tier.name}><i style={{ background: tier.color }} /><strong>{tier.name}</strong><span>Rows {tier.rows}</span><b>₹{tier.priceRupees}</b></p>)}
          </div>
        </div>
      )}

      {validationMessage && <p className="builder-error" role="alert">{validationMessage}</p>}
      <div className="builder-actions">
        {step > 1 && <button className="secondary-button" disabled={creating} onClick={() => setStep(step - 1)} type="button">Back</button>}
        {step < 3
          ? <button className="primary-button" onClick={() => validateStep() && setStep(step + 1)} type="button">Continue</button>
          : <button className="primary-button" disabled={creating}>{creating ? "Creating event…" : "Create event and seats"}</button>}
      </div>
    </form>
  );
}
