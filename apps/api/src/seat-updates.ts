import pg from "pg";
import type { Response } from "express";
import { config } from "./config.js";

const channel = "seat_inventory_changed";
const heartbeatIntervalMs = 20_000;
const reconnectDelayMs = 1_000;

class SeatUpdateHub {
  private subscribers = new Map<string, Set<Response>>();
  private listener: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeat = setInterval(() => this.sendHeartbeats(), heartbeatIntervalMs);
  private closed = false;

  constructor() {
    this.heartbeat.unref();
  }

  subscribe(eventId: string, response: Response) {
    const eventSubscribers = this.subscribers.get(eventId) ?? new Set<Response>();
    eventSubscribers.add(response);
    this.subscribers.set(eventId, eventSubscribers);
    response.write(`event: connected\ndata: ${JSON.stringify({ eventId })}\n\n`);
    void this.ensureListener();

    return () => {
      eventSubscribers.delete(response);
      if (eventSubscribers.size === 0) this.subscribers.delete(eventId);
    };
  }

  async close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const listener = this.listener;
    this.listener = null;
    if (listener) await listener.end().catch(() => undefined);
  }

  private async ensureListener() {
    if (this.closed || this.listener || this.connecting || this.subscribers.size === 0) return;
    this.connecting = this.connect().finally(() => { this.connecting = null; });
    await this.connecting;
  }

  private async connect() {
    const listener = new pg.Client({ connectionString: config.listenerDatabaseUrl });
    try {
      await listener.connect();
      await listener.query(`LISTEN ${channel}`);
      listener.on("notification", (notification) => {
        if (notification.channel === channel && notification.payload) {
          this.publish(notification.payload);
        }
      });
      listener.on("error", () => this.handleDisconnect(listener));
      listener.on("end", () => this.handleDisconnect(listener));
      this.listener = listener;
      console.log(JSON.stringify({
        event: "seat_update_listener_connected",
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      await listener.end().catch(() => undefined);
      console.error(JSON.stringify({
        event: "seat_update_listener_failed",
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      }));
      this.scheduleReconnect();
    }
  }

  private handleDisconnect(listener: pg.Client) {
    if (this.listener !== listener) return;
    this.listener = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer || this.subscribers.size === 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureListener();
    }, reconnectDelayMs);
  }

  private publish(eventId: string) {
    const payload = `event: seats_changed\ndata: ${JSON.stringify({ eventId })}\n\n`;
    const subscribers = this.subscribers.get(eventId) ?? [];
    for (const response of subscribers) response.write(payload);
    console.log(JSON.stringify({
      event: "seat_update_published",
      event_id: eventId,
      subscribers: subscribers instanceof Set ? subscribers.size : 0,
      timestamp: new Date().toISOString(),
    }));
  }

  private sendHeartbeats() {
    for (const responses of this.subscribers.values()) {
      for (const response of responses) response.write(": heartbeat\n\n");
    }
  }
}

export const seatUpdateHub = new SeatUpdateHub();
