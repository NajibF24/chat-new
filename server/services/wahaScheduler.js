// server/services/wahaScheduler.js
// ============================================================
// GYS Portal AI — Flexible WAHA WhatsApp Scheduler
// ✅ UPDATED:
//   - Per-target scheduling (send to specific targets by ID)
//   - Global scheduling (send to all active targets)
//   - Detailed logging for each schedule fire event
//   - 3 schedule types: daily, multiple, interval
// ============================================================

import axios   from 'axios';
import Bot     from '../models/Bot.js';
import AIProviderService from './ai-provider.service.js';

const LOG_PREFIX = '[WahaScheduler]';
function log(level, ...args) {
  const ts = new Date().toISOString();
  if (level === 'ERROR') console.error(ts, LOG_PREFIX, '❌', ...args);
  else if (level === 'WARN')  console.warn(ts,  LOG_PREFIX, '⚠️', ...args);
  else                        console.log(ts,   LOG_PREFIX, level === 'OK' ? '✅' : 'ℹ️', ...args);
}

// Prevent double-firing within same minute
const firedCache = new Set();

// Track next-fire times for interval schedules
// Key: `${botId}:${scheduleId}` → Date
const intervalNextFire = new Map();

// ── Time helpers ──────────────────────────────────────────────
function currentHHMM() {
  const now = new Date();
  return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function timeToMinutes(hhmm) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function currentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

// ── Send message via WAHA API ─────────────────────────────────
async function sendWahaMessage(wahaConfig, chatId, text) {
  if (!wahaConfig.endpoint || !chatId) {
    log('WARN', `sendWahaMessage: missing endpoint or chatId`);
    return false;
  }

  const sendUrl = wahaConfig.endpoint.replace(/\/$/, '') + '/api/sendText';
  const payload = {
    session: wahaConfig.session || 'default',
    chatId,
    text,
  };
  const headers = {
    'Content-Type': 'application/json',
    ...(wahaConfig.apiKey && { 'X-Api-Key': wahaConfig.apiKey }),
  };

  try {
    await axios.post(sendUrl, payload, { headers, timeout: 20000 });
    log('OK', `Sent to ${chatId}: "${text.substring(0, 80)}..."`);
    return true;
  } catch (err) {
    log('ERROR', `Failed to send to ${chatId}: ${err.response?.data?.message || err.message}`);
    return false;
  }
}

// ── Generate AI response ──────────────────────────────────────
async function generateAIResponse(bot, prompt) {
  try {
    log('INFO', `Generating AI response for bot "${bot.name}" | prompt="${prompt.substring(0, 80)}"`);
    const result = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt:   bot.prompt || bot.systemPrompt || 'You are a professional AI assistant.',
      messages:       [],
      userContent:    prompt,
    });
    log('OK', `AI response generated | length=${result.text?.length || 0}`);
    return result.text || null;
  } catch (err) {
    log('ERROR', `AI generation failed: ${err.message}`);
    return null;
  }
}

// ── Fire a schedule ───────────────────────────────────────────
// schedule.targetIds:
//   []        → send to ALL active targets (global)
//   ['id1', ] → send only to those specific targets
async function fireSchedule(bot, schedule) {
  const wahaConfig = bot.wahaConfig;
  const schedLabel = schedule.label || String(schedule._id) || 'unnamed';

  log('INFO', `─────── Firing schedule "${schedLabel}" for bot "${bot.name}" ───────`);
  log('INFO', `  scheduleType = ${schedule.scheduleType || 'daily'}`);
  log('INFO', `  prompt       = "${(schedule.prompt || '').substring(0, 100)}"`);
  log('INFO', `  targetIds    = [${(schedule.targetIds || []).join(', ')}] (empty = global)`);

  const prompt = schedule.prompt || 'Give a helpful daily update summary.';

  // Generate AI message
  const aiText = await generateAIResponse(bot, prompt);
  if (!aiText) {
    log('ERROR', `No AI response — aborting schedule "${schedLabel}"`);
    return;
  }

  const formattedMsg = `🤖 *${bot.name}*\n\n${aiText}`;

  // Resolve target list
  const allActiveTargets = (wahaConfig.targets || []).filter(t => t.active !== false);

  let resolvedTargets;
  if (!schedule.targetIds || schedule.targetIds.length === 0) {
    // GLOBAL: send to all active targets
    resolvedTargets = allActiveTargets;
    log('INFO', `  Mode: GLOBAL → ${resolvedTargets.length} active targets`);
  } else {
    // PER-TARGET: only send to specified targets
    resolvedTargets = allActiveTargets.filter(t =>
      schedule.targetIds.includes(String(t._id))
    );
    log('INFO', `  Mode: PER-TARGET → ${resolvedTargets.length} matching targets (requested ${schedule.targetIds.length})`);
  }

  // Log each target
  resolvedTargets.forEach((t, i) => {
    log('INFO', `  Target[${i}]: "${t.label || t.chatId}" type=${t.type} chatId=${t.chatId}`);
  });

  // Legacy chatId fallback
  const legacyChatId = wahaConfig.chatId;
  if (resolvedTargets.length === 0 && !legacyChatId) {
    log('WARN', `No targets resolved — nothing sent for schedule "${schedLabel}"`);
    return;
  }

  // Send to resolved targets
  let sentCount = 0;
  for (const target of resolvedTargets) {
    const ok = await sendWahaMessage(wahaConfig, target.chatId, formattedMsg);
    if (ok) sentCount++;
  }

  // Fallback: legacy chatId
  if (resolvedTargets.length === 0 && legacyChatId) {
    log('INFO', `  Sending to legacy chatId: ${legacyChatId}`);
    await sendWahaMessage(wahaConfig, legacyChatId, formattedMsg);
    sentCount++;
  }

  log('OK', `Schedule "${schedLabel}" done — sent to ${sentCount}/${resolvedTargets.length} targets`);
}

// ── Check if a schedule should fire right now ─────────────────
function shouldFireSchedule(botId, schedule) {
  if (!schedule.active && schedule.active !== undefined) {
    return false; // explicitly disabled
  }

  const schedId = String(schedule._id || schedule.label || 'unnamed');
  const nowHHMM = currentHHMM();
  const nowMin  = currentMinutes();
  const today   = todayKey();

  switch (schedule.scheduleType || 'daily') {

    case 'daily': {
      const fireTime = schedule.time || '08:00';
      if (nowHHMM !== fireTime) return false;
      const cacheKey = `${botId}:${schedId}:${today}:daily:${fireTime}`;
      if (firedCache.has(cacheKey)) return false;
      firedCache.add(cacheKey);
      log('INFO', `Schedule "${schedule.label}" | daily | matched ${fireTime}`);
      return true;
    }

    case 'multiple': {
      const times = schedule.times || [];
      for (const t of times) {
        if (nowHHMM === t) {
          const cacheKey = `${botId}:${schedId}:${today}:multi:${t}`;
          if (!firedCache.has(cacheKey)) {
            firedCache.add(cacheKey);
            log('INFO', `Schedule "${schedule.label}" | multiple | matched ${t}`);
            return true;
          }
        }
      }
      return false;
    }

    case 'interval': {
      const startMin = timeToMinutes(schedule.intervalStart || '08:00');
      const endMin   = timeToMinutes(schedule.intervalEnd   || '17:00');
      const interval = Math.max(1, schedule.intervalMinutes || 60);

      if (nowMin < startMin || nowMin > endMin) return false;

      const nextFireKey = `${botId}:${schedId}:interval`;
      const nextFire    = intervalNextFire.get(nextFireKey);
      const now         = new Date();

      if (!nextFire) {
        // First time in window — fire immediately, set next
        intervalNextFire.set(nextFireKey, new Date(now.getTime() + interval * 60000));
        log('INFO', `Schedule "${schedule.label}" | interval | first fire (every ${interval}min)`);
        return true;
      }

      if (now >= nextFire) {
        intervalNextFire.set(nextFireKey, new Date(now.getTime() + interval * 60000));
        log('INFO', `Schedule "${schedule.label}" | interval | interval elapsed`);
        return true;
      }

      return false;
    }

    default:
      log('WARN', `Unknown scheduleType "${schedule.scheduleType}" for schedule "${schedule.label}"`);
      return false;
  }
}

// ── Legacy daily schedule (backward compat) ───────────────────
function shouldFireLegacy(botId, wahaConfig) {
  const daily = wahaConfig.dailySchedule;
  if (!daily?.enabled || !daily?.time) return false;

  const nowHHMM = currentHHMM();
  const today   = todayKey();

  if (nowHHMM !== daily.time) return false;

  const cacheKey = `legacy:${botId}:${today}:${daily.time}`;
  if (firedCache.has(cacheKey)) return false;
  firedCache.add(cacheKey);
  return true;
}

// ── Main scheduler tick (every 60 seconds) ────────────────────
async function schedulerTick() {
  const nowHHMM = currentHHMM();
  try {
    const bots = await Bot.find({ 'wahaConfig.enabled': true }).lean();

    if (bots.length === 0) return; // silent if no WAHA bots

    log('INFO', `Tick at ${nowHHMM} | checking ${bots.length} WAHA-enabled bots`);

    for (const bot of bots) {
      const wahaConfig  = bot.wahaConfig;
      const schedules   = (wahaConfig.schedules || []);
      const activeScheds = schedules.filter(s => s.active !== false);

      log('INFO', `Bot "${bot.name}" | ${activeScheds.length}/${schedules.length} active schedules | ${(wahaConfig.targets || []).filter(t => t.active).length} active targets`);

      for (const schedule of activeScheds) {
        if (shouldFireSchedule(String(bot._id), schedule)) {
          fireSchedule(bot, schedule).catch(err =>
            log('ERROR', `Schedule "${schedule.label}" fire error: ${err.message}`)
          );
        }
      }

      // Legacy daily
      if (shouldFireLegacy(String(bot._id), wahaConfig) && wahaConfig.dailySchedule?.prompt) {
        const legacySched = {
          _id:          'legacy',
          label:        'Daily (Legacy)',
          prompt:       wahaConfig.dailySchedule.prompt,
          scheduleType: 'daily',
          time:         wahaConfig.dailySchedule.time,
          targetIds:    [], // global
          active:       true,
        };
        fireSchedule(bot, legacySched).catch(err =>
          log('ERROR', `Legacy schedule error: ${err.message}`)
        );
      }
    }
  } catch (err) {
    log('ERROR', `Tick error: ${err.message}`);
  }
}

// ── Clean fired cache hourly ───────────────────────────────────
function cleanFiredCache() {
  const today = todayKey();
  let removed = 0;
  for (const key of firedCache) {
    if (!key.includes(today)) { firedCache.delete(key); removed++; }
  }
  if (removed > 0) log('INFO', `Cache cleaned: removed ${removed} stale entries`);
}

// ── Start ──────────────────────────────────────────────────────
export const startWahaScheduler = () => {
  log('OK', 'WAHA Flexible Scheduler starting (interval: 60s)...');
  schedulerTick(); // run immediately
  setInterval(schedulerTick, 60 * 1000);
  setInterval(cleanFiredCache, 60 * 60 * 1000); // clean hourly
};

export default startWahaScheduler;
