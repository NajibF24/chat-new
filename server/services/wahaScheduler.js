// server/services/wahaScheduler.js
// ============================================================
// GYS Portal AI — Flexible WhatsApp Scheduler (Baileys)
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

import Bot     from '../models/Bot.js';
import AIProviderService from './ai-provider.service.js';
import AICoreService, { isNewsletterCommand } from './ai-core.service.js';
import BaileysService from './baileys.service.js';
import fs from 'fs';
import path from 'path';

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

// ── Send text via Baileys ─────────────────────────────────────
async function sendMessage(chatId, text) {
  if (!chatId) return;
  const ok = await BaileysService.sendText(chatId, text);
  if (!ok) console.warn(`[Scheduler] ⚠️ Could not send text to ${chatId} (Baileys offline?)`);
}

// ── Send image via Baileys (with text fallback) ───────────────
async function sendImage(chatId, imagePath, caption, publicImageUrl) {
  if (!chatId) return;

  if (fs.existsSync(imagePath)) {
    const ok = await BaileysService.sendImage(chatId, imagePath, caption);
    if (ok) return;
  }

  // Fallback: send text + link if Baileys fails or file missing
  console.warn(`[Scheduler] ↩️ Image send failed, falling back to text+URL for ${chatId}`);
  const fallback = publicImageUrl
    ? `${caption}\n\n🖼️ *GYS Steel Signal Newsletter:*\n${publicImageUrl}`
    : caption;
  await sendMessage(chatId, fallback);
}


// ── Generate AI response for a schedule prompt ────────────────
async function generateAIResponse(bot, prompt) {
  try {
    // ✅ FIX: Pass bot.capabilities so web search (and other tools) are active
    // Without this, the bot ignores its capability settings and generates
    // fabricated news from training data instead of doing a real web search.
    const capabilities = bot.capabilities || {};

    const result = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt:   bot.prompt || bot.systemPrompt || 'You are a professional AI assistant.',
      messages:       [],
      userContent:    prompt,
      capabilities,
    });
    return result.text || 'No response from AI.';
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

  let isImage = false;
  let imagePath = '';
  let publicImageUrl = '';
  let formattedMsg = '';

  if (isNewsletterCommand(prompt)) {
    try {
      const { result, newsletterData } = await AICoreService.generateNewsletterDataCore({ bot, message: prompt, history: [] });
      isImage = true;
      imagePath = path.join(process.cwd(), 'data', 'files', result.fileName);
      
      // Build public URL so fallback text message has a clickable link
      // Priority: SERVER_PUBLIC_URL env var > PUBLIC_URL > safe fallback
      const serverBase = (process.env.SERVER_PUBLIC_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
      if (!serverBase) console.warn('[WahaScheduler] ⚠️ SERVER_PUBLIC_URL not set — image links may not work!');
      publicImageUrl = serverBase ? `${serverBase}${result.fileUrl}` : result.fileUrl;

      let sourceLinks = '';
      if (newsletterData.sourceLinks && newsletterData.sourceLinks.length > 0) {
        sourceLinks = '\n\n🔗 *Sources:*\n' + newsletterData.sourceLinks.map(l => `- ${l}`).join('\n');
      }
      formattedMsg = `🤖 *${bot.name}*\n\nHere is your latest GYS Steel Signal.${sourceLinks}`;
    } catch (error) {
      console.error('[WahaScheduler] Newsletter generation error:', error);
      formattedMsg = `🤖 *${bot.name}*\n\nFailed to generate Newsletter: ${error.message}`;
    }
  } else {
    // Generate Text AI response
    const aiText = await generateAIResponse(bot, prompt);
    if (!aiText) return;
    formattedMsg = `🤖 *${bot.name}*\n\n${aiText}`;
  }

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
    if (isImage && imagePath) {
      await sendImage(target.chatId, imagePath, formattedMsg, publicImageUrl);
    } else {
      await sendMessage(target.chatId, formattedMsg);
    }
  }

  // Send to legacy chatId if no new targets configured
  if (targets.length === 0 && legacyChatId) {
    if (isImage && imagePath) {
      await sendImage(legacyChatId, imagePath, formattedMsg, publicImageUrl);
    } else {
      await sendMessage(legacyChatId, formattedMsg);
    }
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