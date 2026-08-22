import { FormEvent, useEffect, useRef, useState } from "react";

type EventSummary = {
  id: string;
  name: string;
  venue: string;
  starts_at: string;
  seat_count: number;
  reserved_count: number;
};

type Seat = { id: string; label: string; price_paise: number; reserved: boolean };
type SeatHold = { hold_token: string; expires_at: string; seat_id: string };
type Session = {
  token: string;
  user: { name: string; email: string; role: string };
  organizer: { id: string; name: string };
};

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

async function api<T>(path: string, options?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function App() {
  const [view, setView] = useState<"booking" | "auth" | "dashboard">("booking");
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [organizerEvents, setOrganizerEvents] = useState<EventSummary[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null);
  const [seatHold, setSeatHold] = useState<SeatHold | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const eventCreationInFlight = useRef(false);
  const eventCreationKey = useRef<string | null>(null);

  async function loadEvents() {
    const data = await api<EventSummary[]>("/api/events");
    setEvents(data);
    setSelectedEvent((current) => current ?? data[0] ?? null);
  }

  async function loadSeats(eventId: string) {
    setSeats(await api<Seat[]>(`/api/events/${eventId}/seats`));
  }

  async function loadOrganizerEvents(token = session?.token) {
    if (!token) return;
    setOrganizerEvents(await api<EventSummary[]>("/api/organizer/events", undefined, token));
  }

  useEffect(() => {
    loadEvents().catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (selectedEvent) {
      setSelectedSeat(null);
      loadSeats(selectedEvent.id).catch((error) => setMessage(error.message));
    }
  }, [selectedEvent]);

  useEffect(() => {
    if (!seatHold) return;
    const updateCountdown = () => {
      const seconds = Math.max(0, Math.ceil((new Date(seatHold.expires_at).getTime() - Date.now()) / 1000));
      setRemainingSeconds(seconds);
      if (seconds === 0) {
        setSeatHold(null);
        setSelectedSeat(null);
        setMessage("Your seat hold expired. The seat is available again.");
        if (selectedEvent) loadSeats(selectedEvent.id).catch(() => undefined);
      }
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [seatHold, selectedEvent]);

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEvent || !selectedSeat) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const hold = await api<SeatHold>("/api/holds", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          eventId: selectedEvent.id,
          seatId: selectedSeat.id,
          customerName: form.get("name"),
          customerEmail: form.get("email"),
        }),
      });
      setSeatHold(hold);
      setMessage(`Seat ${selectedSeat.label} is held for five minutes.`);
      await loadSeats(selectedEvent.id);
      formElement.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reservation failed");
    }
  }

  async function confirmReservation() {
    if (!seatHold || !selectedEvent || !selectedSeat) return;
    try {
      await api(`/api/holds/${seatHold.hold_token}/confirm`, { method: "POST" });
      setMessage(`Seat ${selectedSeat.label} is confirmed. Your booking is complete.`);
      setSeatHold(null);
      setSelectedSeat(null);
      await Promise.all([loadSeats(selectedEvent.id), loadEvents()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm booking");
      setSeatHold(null);
      setSelectedSeat(null);
      await loadSeats(selectedEvent.id);
    }
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = authMode === "register"
      ? {
          organizationName: form.get("organizationName"),
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
        }
      : { email: form.get("email"), password: form.get("password") };
    try {
      const authenticated = await api<Session>(`/api/auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSession(authenticated);
      setMessage("");
      setView("dashboard");
      await loadOrganizerEvents(authenticated.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed");
    }
  }

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || eventCreationInFlight.current) return;
    eventCreationInFlight.current = true;
    setCreatingEvent(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const idempotencyKey = eventCreationKey.current ?? crypto.randomUUID();
    eventCreationKey.current = idempotencyKey;
    try {
      await api("/api/organizer/events", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          name: form.get("name"),
          venue: form.get("venue"),
          startsAt: new Date(String(form.get("startsAt"))).toISOString(),
          rows: Number(form.get("rows")),
          seatsPerRow: Number(form.get("seatsPerRow")),
          priceRupees: Number(form.get("priceRupees")),
        }),
      }, session.token);
      formElement.reset();
      eventCreationKey.current = null;
      await Promise.all([loadOrganizerEvents(), loadEvents()]);
      setMessage("Event created with its complete seat inventory.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create event");
    } finally {
      eventCreationInFlight.current = false;
      setCreatingEvent(false);
    }
  }

  function logout() {
    setSession(null);
    setOrganizerEvents([]);
    setView("booking");
    setMessage("");
  }

  return (
    <main>
      <header>
        <button className="brand brand-button" onClick={() => setView("booking")}>SeatLock<span>.</span></button>
        <nav>
          {session && <span className="signed-in">{session.organizer.name}</span>}
          <button className="nav-button" onClick={() => setView(session ? "dashboard" : "auth")}>
            {session ? "Dashboard" : "Organizer portal"}
          </button>
          {session && <button className="nav-button muted" onClick={logout}>Log out</button>}
        </nav>
      </header>

      {view === "booking" && (
        <>
          <section className="hero">
            <p className="eyebrow">Reliable ticket reservations</p>
            <h1>Pick your moment.<br />Lock your seat.</h1>
            <p className="intro">A learning project built to explore the engineering behind safe, concurrent bookings.</p>
          </section>

          <section className="workspace">
            <aside>
              <p className="section-label">Upcoming events</p>
              {events.map((item) => (
                <button className={`event-card ${selectedEvent?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => setSelectedEvent(item)}>
                  <strong>{item.name}</strong><span>{item.venue}</span>
                  <small>{item.seat_count - item.reserved_count} seats available</small>
                </button>
              ))}
            </aside>

            <div className="booking-panel">
              <div className="panel-heading">
                <div><p className="section-label">Choose a seat</p><h2>{selectedEvent?.name ?? "Loading…"}</h2></div>
                <div className="legend"><i /> Available <i className="taken" /> Taken</div>
              </div>
              <div className="stage">STAGE</div>
              <div className="seat-grid">
                {seats.map((seat) => (
                  <button aria-label={`Seat ${seat.label}${seat.reserved ? ", reserved" : ""}`} className={`seat ${seat.reserved ? "reserved" : ""} ${selectedSeat?.id === seat.id ? "selected" : ""}`} disabled={seat.reserved} key={seat.id} onClick={() => setSelectedSeat(seat)}>{seat.label}</button>
                ))}
              </div>
              <form className="booking-form" onSubmit={reserve}>
                <div className="selection"><span>Selected seat</span><strong>{selectedSeat ? `${selectedSeat.label} · ₹${(selectedSeat.price_paise / 100).toFixed(0)}` : "None"}</strong></div>
                <input name="name" placeholder="Your name" minLength={2} required />
                <input name="email" type="email" placeholder="Email address" required />
                <button className="primary-button" disabled={!selectedSeat || Boolean(seatHold)}>Hold seat</button>
              </form>
              {seatHold && selectedSeat && (
                <div className="hold-panel">
                  <div>
                    <span>Seat {selectedSeat.label} held</span>
                    <strong>{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}</strong>
                  </div>
                  <p>Only you can confirm this seat while the timer is active.</p>
                  <button className="primary-button" onClick={confirmReservation}>Confirm booking</button>
                </div>
              )}
              {message && <p className="message" role="status">{message}</p>}
            </div>
          </section>
        </>
      )}

      {view === "auth" && (
        <section className="auth-layout">
          <div className="auth-copy">
            <p className="eyebrow">Organizer portal</p>
            <h1>Run remarkable<br />events.</h1>
            <p className="intro">Create events, generate seat inventory, and monitor reservations from one protected workspace.</p>
          </div>
          <div className="auth-card">
            <div className="auth-tabs">
              <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Create account</button>
              <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Log in</button>
            </div>
            <form className="stacked-form" onSubmit={authenticate}>
              {authMode === "register" && <><label>Organization<input name="organizationName" placeholder="Aurora Events" minLength={2} required /></label><label>Your name<input name="name" placeholder="Your full name" minLength={2} required /></label></>}
              <label>Email<input name="email" type="email" placeholder="you@example.com" required /></label>
              <label>Password<input name="password" type="password" placeholder="At least 10 characters" minLength={10} required /></label>
              <button className="primary-button">{authMode === "register" ? "Create organizer account" : "Log in"}</button>
            </form>
            {message && <p className="message" role="status">{message}</p>}
          </div>
        </section>
      )}

      {view === "dashboard" && session && (
        <section className="dashboard">
          <div className="dashboard-heading">
            <div><p className="eyebrow">Organizer dashboard</p><h1>{session.organizer.name}</h1></div>
            <div className="account-chip"><span>{session.user.name}</span><small>{session.user.role}</small></div>
          </div>
          <div className="dashboard-grid">
            <div className="event-list-panel">
              <p className="section-label">Your events</p>
              {organizerEvents.length === 0 && <p className="empty-state">No events yet. Create your first one.</p>}
              {organizerEvents.map((item) => (
                <article className="dashboard-event" key={item.id}>
                  <div><strong>{item.name}</strong><span>{item.venue} · {new Date(item.starts_at).toLocaleDateString()}</span></div>
                  <div className="event-stat"><strong>{item.reserved_count}/{item.seat_count}</strong><span>reserved</span></div>
                </article>
              ))}
            </div>
            <div className="create-panel">
              <p className="section-label">Create an event</p>
              <form className="stacked-form" onChange={() => {
                if (!eventCreationInFlight.current) eventCreationKey.current = null;
              }} onSubmit={createEvent}>
                <label>Event name<input name="name" placeholder="Design After Dark" minLength={3} required /></label>
                <label>Venue<input name="venue" placeholder="City Auditorium" minLength={2} required /></label>
                <label>Start time<input name="startsAt" type="datetime-local" required /></label>
                <div className="field-row">
                  <label>Rows<input name="rows" type="number" min="1" max="10" defaultValue="3" required /></label>
                  <label>Seats / row<input name="seatsPerRow" type="number" min="1" max="30" defaultValue="8" required /></label>
                </div>
                <label>Price per seat (₹)<input name="priceRupees" type="number" min="0" defaultValue="500" required /></label>
                <button className="primary-button" disabled={creatingEvent}>
                  {creatingEvent ? "Creating event…" : "Create event and seats"}
                </button>
              </form>
              {message && <p className="message" role="status">{message}</p>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
