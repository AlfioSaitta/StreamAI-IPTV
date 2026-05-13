// Tests for EpgReminderService — D.1 Fase 3.
// We use jsdom to get a working `localStorage` and `Notification` shim.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EpgProgramme } from '../../types';
import { EpgReminderService } from '../../services/epg/reminderService';

const programme = (start: number, stop: number, title = 'Test'): EpgProgramme => ({
  channelId: 'tvg.rai1',
  start,
  stop,
  title,
});

const channel = { id: 'rai1', name: 'RAI 1', tvgId: 'tvg.rai1' };

describe('EpgReminderService', () => {
  beforeEach(() => {
    localStorage.clear();
    EpgReminderService.stopScheduler();
    // Silence any Notification permission prompts.
    // @ts-expect-error jsdom does not implement Notification by default
    globalThis.Notification = undefined;
  });

  afterEach(() => {
    EpgReminderService.stopScheduler();
    vi.useRealTimers();
  });

  it('does not add reminders for past programmes', () => {
    const past = programme(Date.now() - 60_000, Date.now() - 30_000);
    const r = EpgReminderService.add(channel, past);
    expect(r).toBeNull();
    expect(EpgReminderService.getAll()).toHaveLength(0);
  });

  it('adds and persists a reminder for a future programme', () => {
    const start = Date.now() + 60 * 60_000;
    const r = EpgReminderService.add(channel, programme(start, start + 30 * 60_000, 'Tg1'));
    expect(r).not.toBeNull();
    expect(EpgReminderService.has(channel.id, start)).toBe(true);
    // Persisted to storage
    const raw = localStorage.getItem('streamai_epg_reminders');
    expect(raw).toContain('Tg1');
  });

  it('toggle removes an existing reminder', () => {
    const start = Date.now() + 60 * 60_000;
    const p = programme(start, start + 30 * 60_000);
    expect(EpgReminderService.toggle(channel, p)).toBe(true);
    expect(EpgReminderService.toggle(channel, p)).toBe(false);
    expect(EpgReminderService.has(channel.id, start)).toBe(false);
  });

  it('purges stale reminders on read', () => {
    const stale = {
      id: 'rai1|1000',
      channelId: 'rai1',
      channelName: 'RAI 1',
      tvgId: 'tvg.rai1',
      title: 'Old',
      start: 1000,
      stop: 2000,
      createdAt: 1000,
    };
    localStorage.setItem('streamai_epg_reminders', JSON.stringify([stale]));
    expect(EpgReminderService.getAll()).toHaveLength(0);
  });

  it('fires the listener when scheduler tick crosses lead time', () => {
    vi.useFakeTimers();
    const start = Date.now() + 3 * 60_000; // 3 min from now → triggers (lead = 2 min)
    EpgReminderService.add(channel, programme(start, start + 30 * 60_000, 'Soon'));
    const fired = vi.fn();
    EpgReminderService.onFired(fired); // also calls tick() once

    // Advance virtual time past the trigger threshold.
    vi.setSystemTime(start - 60_000);
    vi.advanceTimersByTime(31_000); // next interval tick

    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0][0].reminder.title).toBe('Soon');

    // Subsequent ticks must not re-fire the same reminder.
    vi.advanceTimersByTime(60_000);
    expect(fired).toHaveBeenCalledTimes(1);
  });
});

