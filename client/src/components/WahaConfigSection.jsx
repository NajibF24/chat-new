// WahaConfigSection.jsx
// Drop this component into the AdminDashboard integrations tab.
// Props: botForm, setBotForm

import React, { useState } from 'react';

// ── Schedule type options ──────────────────────────────────────
const SCHEDULE_TYPES = [
  { id: 'daily',    label: '📅 Daily',        desc: 'Send at a specific time every day' },
  { id: 'interval', label: '🔄 Interval',     desc: 'Send every N minutes (minimum 15 min)' },
  { id: 'times',    label: '🕐 Multiple Times', desc: 'Send at several specific times per day' },
];

// ── Default empty schedule ────────────────────────────────────
const defaultSchedule = () => ({
  _id: Date.now().toString(),
  enabled: true,
  label: '',
  prompt: '',
  scheduleType: 'daily',
  time: '08:00',
  intervalMin: 60,
  times: [],
});

// ── Default empty target ──────────────────────────────────────
const defaultTarget = () => ({
  _id: Date.now().toString(),
  label: '',
  chatId: '',
  enabled: true,
  schedules: [defaultSchedule()],
});

// ── Single schedule row editor ────────────────────────────────
function ScheduleRow({ schedule, onChange, onRemove }) {
  const [timesInput, setTimesInput] = useState((schedule.times || []).join(', '));

  const update = (key, val) => onChange({ ...schedule, [key]: val });

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2.5">
      {/* Header row */}
      <div className="flex items-center gap-2">
        {/* Enable toggle */}
        <button
          type="button"
          onClick={() => update('enabled', !schedule.enabled)}
          className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors flex-shrink-0 ${schedule.enabled ? 'bg-[#25D366]' : 'bg-gray-200'}`}
        >
          <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform ${schedule.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
        </button>
        <input
          type="text"
          value={schedule.label || ''}
          onChange={e => update('label', e.target.value)}
          placeholder="Label (e.g. Morning Briefing)"
          className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[#25D366]/50"
        />
        <button type="button" onClick={onRemove}
          className="text-red-400 hover:text-red-600 text-xs px-1.5 py-1 transition-colors">🗑</button>
      </div>

      {/* Schedule type selector */}
      <div>
        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Schedule Type</label>
        <div className="flex gap-1.5 flex-wrap">
          {SCHEDULE_TYPES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => update('scheduleType', t.id)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                schedule.scheduleType === t.id
                  ? 'bg-[#25D366] text-white border-[#25D366]'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          {SCHEDULE_TYPES.find(t => t.id === schedule.scheduleType)?.desc}
        </p>
      </div>

      {/* Daily: single time */}
      {schedule.scheduleType === 'daily' && (
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Time (24-hour format)</label>
          <input
            type="time"
            value={schedule.time || '08:00'}
            onChange={e => update('time', e.target.value)}
            className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[#25D366]/50"
          />
        </div>
      )}

      {/* Interval */}
      {schedule.scheduleType === 'interval' && (
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">
            Interval (minutes) — minimum 15 min
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={15}
              max={1440}
              step={15}
              value={schedule.intervalMin || 60}
              onChange={e => update('intervalMin', Math.max(15, parseInt(e.target.value) || 60))}
              className="w-24 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[#25D366]/50"
            />
            <span className="text-xs text-gray-500">
              = Every {schedule.intervalMin >= 60
                ? `${Math.floor(schedule.intervalMin / 60)}h${schedule.intervalMin % 60 > 0 ? ` ${schedule.intervalMin % 60}m` : ''}`
                : `${schedule.intervalMin}m`}
            </span>
          </div>
          {/* Quick presets */}
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {[15, 30, 60, 120, 240, 480].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => update('intervalMin', n)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                  schedule.intervalMin === n
                    ? 'bg-[#25D366] text-white border-[#25D366]'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
              >
                {n >= 60 ? `${n / 60}h` : `${n}m`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Multiple times */}
      {schedule.scheduleType === 'times' && (
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">
            Times (comma-separated, HH:MM format)
          </label>
          <input
            type="text"
            value={timesInput}
            onChange={e => {
              setTimesInput(e.target.value);
              const parsed = e.target.value
                .split(',')
                .map(t => t.trim())
                .filter(t => /^\d{2}:\d{2}$/.test(t));
              update('times', parsed);
            }}
            placeholder="08:00, 12:00, 17:00, 21:00"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[#25D366]/50"
          />
          {(schedule.times || []).length > 0 && (
            <p className="text-[10px] text-gray-400 mt-1">
              {(schedule.times || []).length} time(s): {(schedule.times || []).join(' • ')}
            </p>
          )}
          {/* Quick day presets */}
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {[
              { label: '2× daily',    times: '08:00, 17:00' },
              { label: '3× daily',    times: '08:00, 12:00, 17:00' },
              { label: '4× daily',    times: '07:00, 10:00, 14:00, 19:00' },
              { label: 'Work hours',  times: '08:00, 09:00, 10:00, 11:00, 13:00, 14:00, 15:00, 16:00' },
            ].map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setTimesInput(preset.times);
                  const parsed = preset.times.split(',').map(t => t.trim());
                  update('times', parsed);
                }}
                className="px-2 py-0.5 rounded text-[10px] font-semibold border bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300 transition-all"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message/Prompt */}
      <div>
        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">
          Message / Trigger Prompt
        </label>
        <textarea
          value={schedule.prompt || ''}
          onChange={e => update('prompt', e.target.value)}
          placeholder="e.g. Generate a daily summary update for the team"
          rows={2}
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-xs outline-none focus:border-[#25D366]/50 resize-none"
        />
      </div>
    </div>
  );
}

// ── Single target (chat/group) editor ─────────────────────────
function TargetEditor({ target, onChange, onRemove, globalSchedules }) {
  const updateTarget = (key, val) => onChange({ ...target, [key]: val });
  const useOwnSchedules = (target.schedules || []).length > 0;

  const addSchedule    = () => updateTarget('schedules', [...(target.schedules || []), defaultSchedule()]);
  const updateSchedule = (idx, val) => {
    const arr = [...(target.schedules || [])];
    arr[idx]  = val;
    updateTarget('schedules', arr);
  };
  const removeSchedule = (idx) => {
    const arr = (target.schedules || []).filter((_, i) => i !== idx);
    updateTarget('schedules', arr);
  };

  return (
    <div className={`border-2 rounded-xl p-4 transition-all ${target.enabled ? 'border-[#25D366]/40 bg-[#25D366]/5' : 'border-gray-200 bg-gray-50'}`}>
      {/* Target header */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => updateTarget('enabled', !target.enabled)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${target.enabled ? 'bg-[#25D366]' : 'bg-gray-200'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${target.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
        </button>
        <span className="text-sm">💬</span>
        <input
          type="text"
          value={target.label || ''}
          onChange={e => updateTarget('label', e.target.value)}
          placeholder="Target label (e.g. Management Team)"
          className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-[#25D366]/50"
        />
        <button type="button" onClick={onRemove}
          className="text-red-400 hover:text-red-600 text-xs px-2 py-1 transition-colors flex-shrink-0">🗑 Remove</button>
      </div>

      {/* Chat ID */}
      <div className="mb-3">
        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">
          Chat ID / Group ID *
        </label>
        <input
          type="text"
          value={target.chatId || ''}
          onChange={e => updateTarget('chatId', e.target.value)}
          placeholder="120363xxxxxx@g.us (Group) or 628xxxxxxx@c.us (Personal)"
          className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none focus:border-[#25D366]/50"
        />
        <p className="text-[9px] text-gray-400 mt-0.5">@g.us = Group · @c.us = Personal Chat</p>
      </div>

      {/* Schedules */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Custom Schedules for This Target
            </label>
            {!useOwnSchedules && globalSchedules > 0 && (
              <p className="text-[10px] text-amber-600 mt-0.5">
                ⚠️ Using {globalSchedules} global schedule(s). Add a custom schedule here to override.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={addSchedule}
            className="text-[10px] font-semibold text-[#25D366] hover:text-green-700 transition-colors"
          >
            + Add Schedule
          </button>
        </div>

        {(target.schedules || []).length === 0 ? (
          <div className="text-[10px] text-gray-400 italic py-2 text-center border border-dashed border-gray-200 rounded-lg">
            No custom schedules — using global schedule(s)
          </div>
        ) : (
          <div className="space-y-2">
            {(target.schedules || []).map((sch, idx) => (
              <ScheduleRow
                key={sch._id || idx}
                schedule={sch}
                onChange={val => updateSchedule(idx, val)}
                onRemove={() => removeSchedule(idx)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN WAHA CONFIG SECTION ──────────────────────────────────
export default function WahaConfigSection({ botForm, setBotForm }) {
  const config = botForm.wahaConfig || {};

  const updateConfig = (key, val) => setBotForm(f => ({
    ...f,
    wahaConfig: { ...f.wahaConfig, [key]: val }
  }));

  const addTarget    = () => updateConfig('targets', [...(config.targets || []), defaultTarget()]);
  const updateTarget = (idx, val) => {
    const arr = [...(config.targets || [])];
    arr[idx]  = val;
    updateConfig('targets', arr);
  };
  const removeTarget = (idx) => updateConfig('targets', (config.targets || []).filter((_, i) => i !== idx));

  const addGlobalSchedule    = () => updateConfig('schedules', [...(config.schedules || []), defaultSchedule()]);
  const updateGlobalSchedule = (idx, val) => {
    const arr = [...(config.schedules || [])];
    arr[idx]  = val;
    updateConfig('schedules', arr);
  };
  const removeGlobalSchedule = (idx) => updateConfig('schedules', (config.schedules || []).filter((_, i) => i !== idx));

  const enabledTargetsCount = (config.targets || []).filter(t => t.enabled && t.chatId).length;
  const globalScheduleCount = (config.schedules || []).filter(s => s.enabled).length;

  return (
    <div className={`border-2 rounded-xl p-4 transition-all ${config.enabled ? 'border-[#25D366]/40 bg-[#25D366]/5' : 'border-gray-100 bg-white'}`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <div>
            <span className="font-semibold text-sm text-gray-800">WhatsApp Forwarder (WAHA)</span>
            {config.enabled && (
              <div className="flex gap-1.5 mt-0.5">
                {enabledTargetsCount > 0 && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#25D366]/15 text-green-700 border border-[#25D366]/20">
                    {enabledTargetsCount} active target{enabledTargetsCount !== 1 ? 's' : ''}
                  </span>
                )}
                {globalScheduleCount > 0 && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {globalScheduleCount} global schedule{globalScheduleCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => updateConfig('enabled', !config.enabled)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.enabled ? 'bg-[#25D366]' : 'bg-gray-200'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {config.enabled && (
        <div className="space-y-4">
          {/* Connection settings */}
          <div className="bg-white rounded-xl border border-gray-100 p-3 space-y-3">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">⚙️ WAHA Connection</p>
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">
                API Endpoint URL
              </label>
              <input
                type="text"
                value={config.endpoint || ''}
                onChange={e => updateConfig('endpoint', e.target.value)}
                placeholder="http://your_server:3000/api/sendText"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-[#25D366]/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Session Name</label>
                <input
                  type="text"
                  value={config.session || 'default'}
                  onChange={e => updateConfig('session', e.target.value)}
                  placeholder="default"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-[#25D366]/50"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">WAHA API Key</label>
                <input
                  type="password"
                  value={config.apiKey || ''}
                  onChange={e => updateConfig('apiKey', e.target.value)}
                  placeholder="Secret API Key"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-[#25D366]/50"
                />
              </div>
            </div>
          </div>

          {/* Global Schedules */}
          <div className="bg-white rounded-xl border border-gray-100 p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">📅 Global Schedules</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Applied to all targets (unless a target has its own schedules)</p>
              </div>
              <button
                type="button"
                onClick={addGlobalSchedule}
                className="text-[10px] font-semibold text-[#25D366] hover:text-green-700 transition-colors flex items-center gap-1"
              >
                <span>+</span> Add Schedule
              </button>
            </div>

            {(config.schedules || []).length === 0 ? (
              <div className="text-[10px] text-gray-400 italic py-3 text-center border border-dashed border-gray-200 rounded-lg">
                No global schedules. Schedules can be added here or per target.
              </div>
            ) : (
              <div className="space-y-2">
                {(config.schedules || []).map((sch, idx) => (
                  <ScheduleRow
                    key={sch._id || idx}
                    schedule={sch}
                    onChange={val => updateGlobalSchedule(idx, val)}
                    onRemove={() => removeGlobalSchedule(idx)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Targets */}
          <div className="bg-white rounded-xl border border-gray-100 p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">📱 Chat / Group Targets</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Register one or more WhatsApp Chat ID or Group ID</p>
              </div>
              <button
                type="button"
                onClick={addTarget}
                className="text-[10px] font-semibold text-[#25D366] hover:text-green-700 transition-colors flex items-center gap-1"
              >
                <span>+</span> Add Target
              </button>
            </div>

            {(config.targets || []).length === 0 ? (
              <div className="text-[10px] text-gray-400 italic py-3 text-center border border-dashed border-gray-200 rounded-lg">
                No targets yet. Click "+ Add Target" to add a Chat ID or Group ID.
              </div>
            ) : (
              <div className="space-y-3">
                {(config.targets || []).map((target, idx) => (
                  <TargetEditor
                    key={target._id || idx}
                    target={target}
                    onChange={val => updateTarget(idx, val)}
                    onRemove={() => removeTarget(idx)}
                    globalSchedules={(config.schedules || []).filter(s => s.enabled).length}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Legacy fallback note */}
          {!config.targets?.length && config.chatId && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[10px] text-amber-700">
              <p className="font-bold">⚠️ Legacy Mode Detected</p>
              <p>Old Chat ID <code className="bg-amber-100 px-1 rounded font-mono">{config.chatId}</code> is still active.
              Add a new target above to use the latest multi-target system.
              The old Chat ID will continue working for backward compatibility.</p>
            </div>
          )}

          {/* Info box */}
          <div className="bg-[#25D366]/8 border border-[#25D366]/20 rounded-xl p-3 text-[10px] text-green-800 space-y-1">
            <p className="font-bold">💡 Usage Tips</p>
            <p>• <strong>Target without custom schedules</strong> → uses global schedules</p>
            <p>• <strong>Target with custom schedules</strong> → global schedules are ignored for this target</p>
            <p>• <strong>Minimum 15-minute interval</strong> to prevent spam</p>
            <p>• Auto-forward on chat is not affected by schedules</p>
          </div>
        </div>
      )}
    </div>
  );
}