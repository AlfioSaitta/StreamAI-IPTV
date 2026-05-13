// EPG reminders — D.1 Fase 3 IMPROVEMENT_PLAN_V2.
// Persists reminders in localStorage and fires a notification 2 minutes
// before the programme starts. Works on:
//   - Web/Electron: standard `Notification` API (permission requested lazy).
//   - Capacitor (Android): falls back to `Notification` if permitted, otherwise
//     to an in-app toast event (`epg-reminder-fired`) the UI can subscribe to.
//
// Storage shape: `streamai_epg_reminders` → EpgReminder[].

import type { EpgProgramme } from '../../types';

export interface EpgReminder {
  /** Stable id: `${channelId}|${start}`. */
  id: string;
  /** Internal Channel.id (so we can resume playback). */
  channelId: string;
  /** Human-readable channel name (e.g. "RAI 1"). */
  channelName: string;
  /** XMLTV tvg-id of the channel (for matching across reloads). */
  tvgId: string;
  /** Programme title. */
  title: string;
  /** Programme start (epoch ms UTC). */
  start: number;
  /** Programme end (epoch ms UTC). */
  stop: number;
  /** When the reminder was created. */
  createdAt: number;
  /** True once the notification has been delivered (avoid double fires). */
  fired?: boolean;
}

/** Event fired by the scheduler when a reminder triggers. */
export interface ReminderFiredEvent {
  reminder: EpgReminder;
}

const STORAGE_KEY = 'streamai_epg_reminders';
const LEAD_TIME_MS = 2 * 60 * 1000; // notify 2 minutes before start
const CHECK_INTERVAL_MS = 30 * 1000;
/** Drop reminders whose programme ended more than this ago. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

type Listener = (event: ReminderFiredEvent) => void;

const buildId = (channelId: string, start: number): string => `${channelId}|${start}`;

const readAll = (): EpgReminder[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(r => r && typeof r.id === 'string' && typeof r.start === 'number');
  } catch (err) {
    console.warn('[EpgReminder] failed to parse storage', err);
    return [];
  }
};

const writeAll = (reminders: EpgReminder[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
  } catch (err) {
    console.warn('[EpgReminder] failed to persist storage', err);
  }
};

const purgeStale = (reminders: EpgReminder[]): EpgReminder[] => {
  const cutoff = Date.now() - STALE_AFTER_MS;
  return reminders.filter(r => r.stop > cutoff);
};

class EpgReminderServiceClass {
  private listeners: Set<Listener> = new Set();
  private intervalId: number | null = null;
  private permissionRequested = false;

  /** Get all reminders, purging stale ones as a side-effect. */
  getAll(): EpgReminder[] {
    const fresh = purgeStale(readAll());
    writeAll(fresh);
    return fresh;
  }

  /** True if a reminder exists for the given (channelId, start). */
  has(channelId: string, start: number): boolean {
    return this.getAll().some(r => r.id === buildId(channelId, start));
  }

  /**
   * Add a reminder for the given programme on the given channel.
   * Returns the persisted reminder, or null if the programme already started.
   */
  add(
    channel: { id: string; name: string; tvgId?: string },
    programme: EpgProgramme,
  ): EpgReminder | null {
    if (programme.start <= Date.now()) return null;
    const all = this.getAll();
    const id = buildId(channel.id, programme.start);
    if (all.some(r => r.id === id)) return all.find(r => r.id === id) ?? null;

    const reminder: EpgReminder = {
      id,
      channelId: channel.id,
      channelName: channel.name,
      tvgId: channel.tvgId ?? programme.channelId,
      title: programme.title,
      start: programme.start,
      stop: programme.stop,
      createdAt: Date.now(),
    };
    all.push(reminder);
    writeAll(all);
    void this.ensurePermission();
    this.ensureScheduler();
    return reminder;
  }

  /** Remove a reminder by id (or by channelId+start). */
  remove(channelId: string, start: number): void {
    const id = buildId(channelId, start);
    const filtered = this.getAll().filter(r => r.id !== id);
    writeAll(filtered);
  }

  /**
   * Toggle a reminder on/off. Returns the new state (`true` = reminder set).
   */
  toggle(
    channel: { id: string; name: string; tvgId?: string },
    programme: EpgProgramme,
  ): boolean {
    if (this.has(channel.id, programme.start)) {
      this.remove(channel.id, programme.start);
      return false;
    }
    return this.add(channel, programme) !== null;
  }

  /**
   * Subscribe to fire events. Returns an unsubscribe function.
   */
  onFired(listener: Listener): () => void {
    this.listeners.add(listener);
    this.ensureScheduler();
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Start the periodic check; safe to call multiple times. */
  ensureScheduler(): void {
    if (this.intervalId !== null) return;
    if (typeof window === 'undefined') return;
    this.intervalId = window.setInterval(() => this.tick(), CHECK_INTERVAL_MS);
    // Fire one tick immediately to handle reminders that should already trigger.
    this.tick();
  }

  /** Stop the periodic check (used in tests). */
  stopScheduler(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    const all = this.getAll();
    let mutated = false;
    for (const r of all) {
      if (r.fired) continue;
      const triggerAt = r.start - LEAD_TIME_MS;
      if (now >= triggerAt && now < r.stop) {
        r.fired = true;
        mutated = true;
        this.deliver(r);
      }
    }
    if (mutated) writeAll(all);
  }

  private deliver(reminder: EpgReminder): void {
    // Always notify in-app subscribers (UI toast, badge counter, etc.).
    for (const listener of this.listeners) {
      try {
        listener({ reminder });
      } catch (err) {
        console.warn('[EpgReminder] listener threw', err);
      }
    }
    // Best-effort native notification (no-op if permission denied).
    this.fireNativeNotification(reminder);
  }

  private async ensurePermission(): Promise<void> {
    if (this.permissionRequested) return;
    if (typeof Notification === 'undefined') return;
    this.permissionRequested = true;
    if (Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }
  }

  private fireNativeNotification(reminder: EpgReminder): void {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
      const minutes = Math.max(0, Math.round((reminder.start - Date.now()) / 60000));
      const body = minutes <= 0
        ? `In onda ora su ${reminder.channelName}`
        : `Tra ${minutes} minuti su ${reminder.channelName}`;
      const notif = new Notification(reminder.title, {
        body,
        tag: reminder.id,
        silent: false,
      });
      // Clicking the notification surfaces an event the app can react to
      // (e.g. focus window + start playback).
      notif.onclick = () => {
        try {
          window.focus();
          window.dispatchEvent(
            new CustomEvent<ReminderFiredEvent>('epg-reminder-clicked', {
              detail: { reminder },
            }),
          );
        } catch {
          /* ignore */
        }
      };
    } catch (err) {
      console.warn('[EpgReminder] Notification failed', err);
    }
  }
}

export const EpgReminderService = new EpgReminderServiceClass();

