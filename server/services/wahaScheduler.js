// server/services/wahaScheduler.js
// ============================================================
// GYS Portal AI — Flexible WAHA WhatsApp Scheduler
//
// Supports 3 schedule types per bot:
//   1. 'daily'    — send once at a fixed time e.g. "08:00"
//   2. 'multiple' — send at multiple fixed times e.g. ["08:00","12:00","17:00"]
//   3. 'interval' — send every N minutes within a time window
//
// Each schedule can target:
//   - All active targets (if targetIds is empty)
//   - Specific targets (by wahaTarget._id)
//
// Checks every 1 minute, fires when current HH:MM matches.
// ============================================================

import axios   from 'axios';
import Bot     from '../models/Bot.js';
import AIProviderService from './ai-provider.service.js';

// Track last-fired times to avoid double-firing within same minute
// Key: `${botId}:${scheduleId}:${YYYY-MM-DD HH:MM}` → true
const firedCache = new Set();

// Track interval "next fire" times
// Key: `${botId}:${scheduleId}` → Date
const intervalNextFire = new Map();

// ── Helpers ───────────────────────────────────────────────────
function currentHHMM() {
  const now = new Date();
  return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

function todayKey() {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
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
  if (!wahaConfig.endpoint || !chatId) return;

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
    await axios.post(sendUrl, payload, { headers, timeout: 15000 });
    console.log(`[WahaScheduler] ✅ Sent to ${chatId}: ${text.substring(0, 60)}...`);
  } catch (err) {
    console.error(`[WahaScheduler] ❌ Failed ${chatId}:`, err.response?.data?.message || err.message);
  }
}

// ── Generate AI response for a schedule prompt ────────────────
async function generateAIResponse(bot, prompt) {
  try {
    const result = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt:   bot.prompt || bot.systemPrompt || 'You are a professional AI assistant.',
      messages:       [],
      userContent:    prompt,
    });
    return result.text || 'Maaf, tidak ada respons dari AI.';
  } catch (err) {
    console.error('[WahaScheduler] AI error:', err.message);
    return null;
  }
}

// ── Fire a schedule: generate AI response and send to targets ─
async function fireSchedule(bot, schedule) {
  const wahaConfig = bot.wahaConfig;
  const prompt = schedule.prompt || 'Give me a daily update summary.';

  console.log(`[WahaScheduler] 🔔 Firing schedule "${schedule.label || schedule._id}" for bot "${bot.name}"`);

  // Generate AI response
  const aiText = await generateAIResponse(bot, prompt);
  if (!aiText) return;

  const formattedMsg = `🤖 *${bot.name}*\n\n${aiText}`;

  // Determine which targets to send to
  let targets = (wahaConfig.targets || []).filter(t => t.active);

  if (schedule.targetIds && schedule.targetIds.length > 0) {
    // Only send to specified targets
    targets = targets.filter(t => schedule.targetIds.includes(String(t._id)));
  }

  // Also check legacy chatId for backward compat
  const legacyChatId = wahaConfig.chatId;

  if (targets.length === 0 && !legacyChatId) {
    console.warn(`[WahaScheduler] No active targets for schedule "${schedule.label}"`);
    return;
  }

  // Send to all resolved targets
  for (const target of targets) {
    await sendWahaMessage(wahaConfig, target.chatId, formattedMsg);
  }

  // Send to legacy chatId if no new targets configured
  if (targets.length === 0 && legacyChatId) {
    await sendWahaMessage(wahaConfig, legacyChatId, formattedMsg);
  }
}

// ── Check if a schedule should fire right now ─────────────────
function shouldFireSchedule(botId, schedule) {
  const schedId = String(schedule._id || schedule.label || 'unnamed');
  const nowHHMM = currentHHMM();
  const nowMin  = currentMinutes();
  const today   = todayKey();

  switch (schedule.scheduleType || 'daily') {

    case 'daily': {
      const fireTime = schedule.time || '08:00';
      if (nowHHMM !== fireTime) return false;
      const cacheKey = `${botId}:${schedId}:${today}:${fireTime}`;
      if (firedCache.has(cacheKey)) return false;
      firedCache.add(cacheKey);
      return true;
    }

    case 'multiple': {
      const times = schedule.times || [];
      for (const t of times) {
        if (nowHHMM === t) {
          const cacheKey = `${botId}:${schedId}:${today}:${t}`;
          if (!firedCache.has(cacheKey)) {
            firedCache.add(cacheKey);
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

      // Outside active window
      if (nowMin < startMin || nowMin > endMin) return false;

      const nextFireKey = `${botId}:${schedId}`;
      const nextFire    = intervalNextFire.get(nextFireKey);
      const now         = new Date();

      if (!nextFire) {
        // First check — set next fire to now + interval
        intervalNextFire.set(nextFireKey, new Date(now.getTime() + interval * 60000));
        // Fire immediately on first check within window
        return true;
      }

      if (now >= nextFire) {
        intervalNextFire.set(nextFireKey, new Date(now.getTime() + interval * 60000));
        return true;
      }

      return false;
    }

    default:
      return false;
  }
}

// ── Legacy daily schedule check (backward compat) ────────────
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

// ── Main scheduler tick (runs every 60 seconds) ───────────────
async function schedulerTick() {
  try {
    const bots = await Bot.find({
      'wahaConfig.enabled': true,
    }).lean();

    for (const bot of bots) {
      const wahaConfig = bot.wahaConfig;

      // Process new-style schedules
      const schedules = (wahaConfig.schedules || []).filter(s => s.active !== false);
      for (const schedule of schedules) {
        if (shouldFireSchedule(String(bot._id), schedule)) {
          // Don't await — fire and forget, don't block the tick
          fireSchedule(bot, schedule).catch(err =>
            console.error(`[WahaScheduler] Schedule "${schedule.label}" error:`, err.message)
          );
        }
      }

      // Process legacy daily schedule (backward compat)
      if (shouldFireLegacy(String(bot._id), wahaConfig) && wahaConfig.dailySchedule?.prompt) {
        const fakeSchedule = {
          _id:          'legacy',
          label:        'Daily (Legacy)',
          prompt:       wahaConfig.dailySchedule.prompt,
          scheduleType: 'daily',
          time:         wahaConfig.dailySchedule.time,
          targetIds:    [],
        };
        fireSchedule(bot, fakeSchedule).catch(err =>
          console.error(`[WahaScheduler] Legacy schedule error:`, err.message)
        );
      }
    }
  } catch (err) {
    console.error('[WahaScheduler] Tick error:', err.message);
  }
}

// ── Clean fired cache daily (prevent unbounded growth) ────────
function cleanFiredCache() {
  const today = todayKey();
  for (const key of firedCache) {
    // Keys contain date: if it's not today's date, remove it
    if (!key.includes(today)) {
      firedCache.delete(key);
    }
  }
}

// ── Start the scheduler ───────────────────────────────────────
export const startWahaScheduler = () => {
  console.log('⏳ WAHA Flexible Scheduler started (checking every 60s)...');

  // Run immediately once, then every 60 seconds
  schedulerTick();
  setInterval(schedulerTick, 60 * 1000);

  // Clean cache daily at midnight
  setInterval(cleanFiredCache, 60 * 60 * 1000); // every hour
};

export default startWahaScheduler;