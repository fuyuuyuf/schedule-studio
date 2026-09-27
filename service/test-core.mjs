import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScheduleDatabase } from './core/database.mjs';
import { ApplicationEventBus } from './core/event-bus.mjs';
import { PluginManager } from './core/plugin-manager.mjs';
import { ComponentRegistry } from './core/component-registry.mjs';
import { expandRecurringSchedule } from './core/recurrence.mjs';

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-studio-test-'));
const database = new ScheduleDatabase(path.join(testDirectory, 'test.sqlite'));

try {
  const created = database.saveSchedule({
    title: '核心测试', startDate: '2026-09-26', endDate: '2026-09-26', start: 600, end: 660,
    recurrence: { frequency: 'weekly', interval: 1, weekdays: [6], until: '2026-10-31' },
  });
  assert.equal(database.getSchedule(created.id).title, '核心测试');
  const occurrences = expandRecurringSchedule(created, '2026-10-01', '2026-10-31');
  assert.equal(occurrences.length, 5);
  assert.equal(occurrences[0].startDate, '2026-10-03');

  const pluginDirectory = path.join(testDirectory, 'mod', 'test-plugin');
  fs.mkdirSync(pluginDirectory, { recursive: true });
  fs.writeFileSync(path.join(pluginDirectory, 'manifest.json'), JSON.stringify({
    id: 'test-plugin', name: '测试插件', version: '1.0.0', apiVersion: '1', main: 'index.mjs',
    permissions: ['schedules:read', 'settings:read', 'reminders:read', 'storage', 'http:route', 'ui:components'],
    uiComponents: [{ id: 'reminder-view', name: '替换提醒页', surface: 'desktop', kind: 'DESKTOP_REMINDERS', mode: 'replace', html: 'view.html', module: 'view.js' }],
  }));
  fs.writeFileSync(path.join(pluginDirectory, 'view.html'), '<p>测试组件</p>');
  fs.writeFileSync(path.join(pluginDirectory, 'view.js'), 'export function mount() {}');
  fs.writeFileSync(path.join(pluginDirectory, 'index.mjs'), `export function activate(context) {
    context.storage.set('loaded', true);
    context.http.register('GET', 'status', () => ({ count: context.schedules.list().length, theme: context.settings.get().appearance, reminders: context.reminders.list().length }));
  }`);
  const plugins = new PluginManager({ directory: path.join(testDirectory, 'mod'), database, eventBus: new ApplicationEventBus(),
    getSettings: () => ({ appearance: 'light' }), listReminders: () => [], logger: { info() {}, warn() {}, error() {} } });
  await plugins.loadAll();
  assert.equal(plugins.list()[0].status, 'active');
  assert.deepEqual(await plugins.handleHttp('test-plugin', 'GET', 'status', {}), { count: 1, theme: 'light', reminders: 0 });
  assert.equal(database.getPluginState('test-plugin', 'loaded'), true);
  const registry = new ComponentRegistry({ database, pluginManager: plugins });
  assert.equal(registry.list().extensions[0].id, 'test-plugin:reminder-view');
  assert.equal(registry.list().extensions[0].kind, 'DESKTOP_REMINDERS');
  const competingDirectory = path.join(testDirectory, 'mod', 'other-plugin');
  fs.mkdirSync(competingDirectory);
  fs.writeFileSync(path.join(competingDirectory, 'manifest.json'), JSON.stringify({
    id: 'other-plugin', apiVersion: '1', permissions: ['ui:components'],
    uiComponents: [{ id: 'other-view', surface: 'desktop', kind: 'DESKTOP_REMINDERS', mode: 'replace', html: 'view.html' }],
  }));
  fs.writeFileSync(path.join(competingDirectory, 'view.html'), '<p>其它组件</p>');
  await plugins.load('other-plugin');
  registry.updateExtension('test-plugin:reminder-view', true);
  assert.equal(registry.list().builtins.find(item => item.id === 'desktop.reminders').replacement, 'test-plugin:reminder-view');
  assert.equal(registry.list().extensions.find(item => item.id === 'test-plugin:reminder-view').enabled, true);
  assert.equal(registry.list().extensions.find(item => item.pluginId === 'other-plugin').blockedBy, 'test-plugin:reminder-view');
  assert.throws(() => registry.updateExtension('other-plugin:other-view', true), /先关闭/);
  assert.throws(() => registry.updateBuiltin('desktop.reminders', { enabled: false }), /核心组件/);
  await plugins.setEnabled('test-plugin', false);
  assert.equal(plugins.list()[0].status, 'disabled');
  assert.equal(registry.list().builtins.find(item => item.id === 'desktop.reminders').replacement, null);
  await plugins.setEnabled('test-plugin', true);
  assert.equal(plugins.list()[0].status, 'active');
  registry.activatePluginDefaults('test-plugin');
  assert.equal(registry.list().extensions.find(item => item.id === 'test-plugin:reminder-view').enabled, true);
  assert.equal(database.deleteSchedule(created.id), true);
  assert.equal(database.getSchedule(created.id), null);
  const epoch = database.getDataEpoch();
  assert.equal(epoch, '0');
  const clearedEpoch = database.clearAllData();
  assert.equal(database.getDataEpoch(), clearedEpoch);
  assert.equal(database.listSchedules().length, 0);
  assert.equal(database.getSetting('component.builtin:desktop.reminders'), null);
  assert.equal(database.getPluginState('test-plugin', 'loaded'), null);
  await plugins.close();

  console.log('核心数据层、重复规则与插件接口测试通过');
} finally {
  database.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
}
