// server/services/wahaScheduler.js
// ── WAHA Multi-Target Flexible Scheduler ────────────────────
// Supports:
//   - Multiple chat/group targets per bot
//   - Schedule types: 'daily' (HH:MM), 'interval' (every N min), 'times' (multiple per day)
//   - Backward compatible with legacy dailySchedule config

import axios  from 'axios';
import Bot    from '../models/Bot.js';
import AIProviderService from './ai-provider.service.js';

// ── Send a single message to a WAHA target ───────────────────
async function sendWahaMessage(wahaConfig, chatId, botName, triggerPrompt, aiText) {
  const wibTime = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false });
  const formattedMessage =
      `🤖 *BOT SCHEDULED MESSAGE:* ${botName}\n` +
      `🕐 *Time (WIB):* ${wibTime}\n` +
      `👤 *Triggered by:* scheduler\n\n` +
      `💬 *Prompt:*\n${triggerPrompt}\n\n` +
      `🤖 *Response:*\n${aiText}`;

  const payload = {
    session: wahaConfig.session || 'default',
    chatId,
    text: formattedMessage,
  };

  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (wahaConfig.apiKey) headers['X-Api-Key'] = wahaConfig.apiKey;

  await axios.post(wahaConfig.endpoint, payload, { headers, timeout: 15000 });
  console.log(`[WAHA Scheduler] ✅ Sent to ${chatId} (bot: ${botName})`);
}

// ── Generate AI response for a scheduled message ─────────────
async function generateScheduledResponse(bot, prompt) {
  const aiResponse = await AIProviderService.generateCompletion({
    providerConfig: bot.aiProvider,
    systemPrompt:   bot.prompt || bot.systemPrompt || 'You are a professional AI assistant.',
    messages:       [],
    userContent:    prompt,
    capabilities:   bot.capabilities,
  });
  return aiResponse?.text || 'Maaf, AI tidak memberikan respon.';
}

// ── Check if a schedule should fire right now ─────────────────
// Returns true if the schedule should trigger in the current minute tick.
function shouldFire(schedule, now) {
  if (!schedule?.enabled || !schedule?.prompt?.trim()) return false;

  const currentHHMM = now.getHours().toString().padStart(2, '0') + ':' +
                      now.getMinutes().toString().padStart(2, '0');
  const currentMin  = now.getHours() * 60 + now.getMinutes();

  switch (schedule.scheduleType || 'daily') {
    case 'daily':
      return schedule.time === currentHHMM;

    case 'interval': {
      // Fire every N minutes from midnight. Min interval = 15 min.
      const interval = Math.max(15, parseInt(schedule.intervalMin) || 60);
      return currentMin % interval === 0;
    }

    case 'times':
      return (schedule.times || []).includes(currentHHMM);

    default:
      return false;
  }
}

// ── Resolve which targets and schedules should fire now ───────
// Returns array of { chatId, prompt } to send.
function resolveFireList(bot, now) {
  const cfg     = bot.wahaConfig;
  const fireList = [];

  // ── New multi-target system ──────────────────────────────
  const targets = cfg.targets || [];

  if (targets.length > 0) {
    for (const target of targets) {
      if (!target.enabled || !target.chatId) continue;

      // Per-target schedules take priority; fall back to global schedules
      const schedulesToCheck = (target.schedules?.length > 0)
        ? target.schedules
        : (cfg.schedules || []);

      for (const schedule of schedulesToCheck) {
        if (shouldFire(schedule, now)) {
          fireList.push({ chatId: target.chatId, prompt: schedule.prompt, label: target.label || target.chatId });
        }
      }
    }

    // Also check global schedules against all targets (if target has no own schedules)
    // Already handled above: falls back to global schedules.

  } else {
    // ── Legacy: single chatId + dailySchedule ──────────────
    const legacyChatId = cfg.chatId;
    if (!legacyChatId) return fireList;

    // Check new-style global schedules first
    for (const schedule of (cfg.schedules || [])) {
      if (shouldFire(schedule, now)) {
        fireList.push({ chatId: legacyChatId, prompt: schedule.prompt, label: legacyChatId });
      }
    }

    // Then legacy dailySchedule
    const ds = cfg.dailySchedule;
    if (ds?.enabled && ds?.prompt && shouldFire(
      { enabled: true, prompt: ds.prompt, scheduleType: 'daily', time: ds.time },
      now
    )) {
      fireList.push({ chatId: legacyChatId, prompt: ds.prompt, label: legacyChatId });
    }
  }

  return fireList;
}

// ── Main scheduler entry point ────────────────────────────────
export const startWahaScheduler = () => {
  console.log('⏳ WAHA Multi-Target Scheduler started (ticks every minute)');

  setInterval(async () => {
    try {
      const now  = new Date();
      // Round to the start of the current minute
      now.setSeconds(0, 0);

      // Find all bots with WAHA enabled
      const bots = await Bot.find({ 'wahaConfig.enabled': true }).lean();

      for (const bot of bots) {
        const cfg = bot.wahaConfig;
        if (!cfg?.endpoint) continue;

        const fireList = resolveFireList(bot, now);
        if (fireList.length === 0) continue;

        console.log(`[WAHA Scheduler] ⏰ Bot "${bot.name}" — ${fireList.length} message(s) to send`);

        for (const { chatId, prompt, label } of fireList) {
          try {
            console.log(`[WAHA Scheduler]   → Target: ${label} | Prompt: "${prompt.substring(0, 60)}..."`);

            const aiText = await generateScheduledResponse(bot, prompt);
            await sendWahaMessage(cfg, chatId, bot.name, prompt, aiText);

          } catch (sendErr) {
            console.error(`[WAHA Scheduler] ❌ Failed to send to ${chatId}:`, sendErr.message);
          }
        }
      }

    } catch (error) {
      console.error('[WAHA Scheduler] ❌ Tick error:', error.message);
    }
  }, 60_000); // Check every minute
};

// ── Helper: forward a single user message to WAHA (used by chat.js) ──
export async function forwardChatToWaha(bot, username, userMessage, aiResponse) {
  const cfg = bot?.wahaConfig;
  if (!cfg?.enabled || !cfg?.endpoint) return;

  // Collect all enabled target chatIds
  const chatIds = [];

  if ((cfg.targets || []).length > 0) {
    for (const t of cfg.targets) {
      if (t.enabled && t.chatId) chatIds.push(t.chatId);
    }
  } else if (cfg.chatId) {
    chatIds.push(cfg.chatId);
  }

  if (chatIds.length === 0) return;

  // const wibTime = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false });
  // Dengan ini (kirim jawaban langsung saja):
  const text = aiResponse;

  for (const chatId of chatIds) {
    try {
      await axios.post(cfg.endpoint, {
        chatId,
        text,
        session: cfg.session || 'default',
      }, {
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey && { 'X-Api-Key': cfg.apiKey }),
        },
        timeout: 10000,
      });
      console.log(`[WAHA Forward] ✅ Forwarded chat to: ${chatId}`);
    } catch (err) {
      console.error(`[WAHA Forward] ❌ Failed to forward to ${chatId}:`, err.message);
    }
  }
}
