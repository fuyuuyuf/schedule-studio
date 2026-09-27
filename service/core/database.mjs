import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeRecurrence } from './recurrence.mjs';

const DEFAULT_COLOR = '#2aa198';

function jsonOr(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function nowIso() { return new Date().toISOString(); }

export function normalizeSchedule(input, existing = null) {
  const source = { ...(existing || {}), ...(input || {}) };
  const id = String(source.id || crypto.randomUUID()).slice(0, 160);
  const title = String(source.title || '').trim().slice(0, 200);
  if (!title) throw new Error('日程标题不能为空');
  const startDate = String(source.startDate || source.dates?.[0] || '');
  const endDate = String(source.endDate || source.dates?.at?.(-1) || startDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new Error('日程日期范围无效');
  const start = Math.max(0, Math.min(1440, Math.trunc(Number(source.start) || 0)));
  const end = Math.max(0, Math.min(1440, Math.trunc(Number(source.end) || 0)));
  if (startDate === endDate && end <= start) throw new Error('单日日程结束时间必须晚于开始时间');
  const reminder = {
    enabled: Boolean(source.reminder?.enabled),
    minutesBefore: Math.max(0, Math.min(10080, Number(source.reminder?.minutesBefore) || 0)),
    daysBefore: Math.max(0, Math.min(365, Number(source.reminder?.daysBefore) || 0)),
  };
  return {
    id, title, startDate, endDate, start, end, span: source.span !== false,
    dates: [startDate, endDate], color: String(source.color || DEFAULT_COLOR).slice(0, 40),
    notes: String(source.notes || '').slice(0, 100000), marked: Boolean(source.marked), reminder,
    recurrence: source.recurrence ? normalizeRecurrence(source.recurrence) : null,
    createdAt: existing?.createdAt || source.createdAt || nowIso(), updatedAt: nowIso(),
  };
}

export class ScheduleDatabase {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.path = databasePath;
    this.db = new DatabaseSync(databasePath, { timeout: 5000 });
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
        start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL, color TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
        marked INTEGER NOT NULL DEFAULT 0, reminder_json TEXT, recurrence_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS schedules_dates ON schedules(start_date, end_date);
      CREATE TABLE IF NOT EXISTS reminders (
        key TEXT PRIMARY KEY, client_id TEXT NOT NULL, event_id TEXT NOT NULL, kind TEXT NOT NULL,
        trigger_at INTEGER NOT NULL, deadline INTEGER NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE INDEX IF NOT EXISTS reminders_trigger ON reminders(trigger_at);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS plugin_state (
        plugin_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(plugin_id, key)
      ) STRICT;
      INSERT INTO metadata(key, value) VALUES('schema_version', '1') ON CONFLICT(key) DO UPDATE SET value='1';
    `);
  }

  rowToSchedule(row) {
    return {
      id: row.id, title: row.title, startDate: row.start_date, endDate: row.end_date,
      dates: [row.start_date, row.end_date], start: row.start_minute, end: row.end_minute,
      span: true, color: row.color, notes: row.notes, marked: Boolean(row.marked),
      reminder: jsonOr(row.reminder_json, { enabled: false, minutesBefore: 10, daysBefore: 0 }),
      recurrence: jsonOr(row.recurrence_json, null), createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  listSchedules({ startDate, endDate } = {}) {
    let rows;
    if (startDate && endDate) rows = this.db.prepare('SELECT * FROM schedules WHERE (end_date >= ? AND start_date <= ?) OR recurrence_json IS NOT NULL ORDER BY start_date, start_minute').all(startDate, endDate);
    else rows = this.db.prepare('SELECT * FROM schedules ORDER BY start_date, start_minute').all();
    return rows.map(row => this.rowToSchedule(row));
  }

  getSchedule(id) {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    return row ? this.rowToSchedule(row) : null;
  }

  saveSchedule(input) {
    const current = input?.id ? this.getSchedule(String(input.id)) : null;
    const item = normalizeSchedule(input, current);
    this.db.prepare(`INSERT INTO schedules(id,title,start_date,end_date,start_minute,end_minute,color,notes,marked,reminder_json,recurrence_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,start_minute=excluded.start_minute,
      end_minute=excluded.end_minute,color=excluded.color,notes=excluded.notes,marked=excluded.marked,
      reminder_json=excluded.reminder_json,recurrence_json=excluded.recurrence_json,updated_at=excluded.updated_at`).run(
      item.id, item.title, item.startDate, item.endDate, item.start, item.end, item.color, item.notes,
      item.marked ? 1 : 0, JSON.stringify(item.reminder), item.recurrence ? JSON.stringify(item.recurrence) : null,
      item.createdAt, item.updatedAt,
    );
    return item;
  }

  deleteSchedule(id) { return this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0; }

  replaceSchedules(items) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM schedules');
      const saved = items.map(item => this.saveSchedule(item));
      this.db.exec('COMMIT');
      return saved;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  importSchedules(items) {
    if (!Array.isArray(items) || items.length > 10000) throw new Error('导入日程格式无效');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const saved = items.map(item => this.saveSchedule(item));
      this.db.exec('COMMIT');
      return saved;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  listReminders() { return this.db.prepare('SELECT * FROM reminders ORDER BY trigger_at').all().map(row => ({ key: row.key, clientId: row.client_id, eventId: row.event_id, kind: row.kind, at: row.trigger_at, deadline: row.deadline, title: row.title, notes: row.notes })); }
  replaceClientReminders(clientId, reminders) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM reminders WHERE client_id = ?').run(clientId);
      const insert = this.db.prepare('INSERT OR REPLACE INTO reminders(key,client_id,event_id,kind,trigger_at,deadline,title,notes) VALUES(?,?,?,?,?,?,?,?)');
      for (const item of reminders) insert.run(item.key, item.clientId, item.eventId, item.kind, item.at, item.deadline, item.title, item.notes || '');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  replaceAllReminders(reminders) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM reminders');
      const insert = this.db.prepare('INSERT OR REPLACE INTO reminders(key,client_id,event_id,kind,trigger_at,deadline,title,notes) VALUES(?,?,?,?,?,?,?,?)');
      for (const item of reminders) insert.run(item.key, item.clientId, item.eventId, item.kind, item.at, item.deadline, item.title, item.notes || '');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  deleteReminders(keys) { const statement = this.db.prepare('DELETE FROM reminders WHERE key = ?'); for (const key of keys) statement.run(key); }

  getSetting(key, fallback = null) { const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key); return row ? jsonOr(row.value_json, fallback) : fallback; }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').run(key, JSON.stringify(value), nowIso()); }
  getPluginState(pluginId, key, fallback = null) { const row = this.db.prepare('SELECT value_json FROM plugin_state WHERE plugin_id=? AND key=?').get(pluginId, key); return row ? jsonOr(row.value_json, fallback) : fallback; }
  setPluginState(pluginId, key, value) { this.db.prepare('INSERT INTO plugin_state(plugin_id,key,value_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(plugin_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').run(pluginId, key, JSON.stringify(value), nowIso()); }
  getDataEpoch() { return this.db.prepare("SELECT value FROM metadata WHERE key='data_epoch'").get()?.value || '0'; }
  clearAllData() {
    const epoch = crypto.randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of ['schedules', 'reminders', 'settings', 'plugin_state']) this.db.exec(`DELETE FROM ${table}`);
      this.db.prepare("INSERT INTO metadata(key,value) VALUES('data_epoch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(epoch);
      this.db.exec('COMMIT');
      return epoch;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
