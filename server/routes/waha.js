// server/routes/waha.js
// ============================================================
// WAHA WhatsApp Webhook Receiver
// 
// Configure WAHA to POST to: POST /api/waha/webhook/:botId
// WAHA webhook payload format (WAHA API v2):
//   { event: "message", session: "...", payload: { ... } }
//
// Tag detection in groups:
//   Bot only responds if message contains @botPhoneNumber
//   (configured in wahaConfig.botPhoneNumber)
// ============================================================

import express from 'express';
import axios   from 'axios';
import Bot     from '../models/Bot.js';
import AIProviderService from '../services/ai-provider.service.js';
import KnowledgeBaseService from '../services/knowledge-base.service.js';
import AuditService from '../services/audit.service.js';

const router = express.Router();

// ── In-memory conversation history per chatId (max 10 messages) ──
// Key: `${botId}:${chatId}` → array of {role, content}
const conversationCache = new Map();
const MAX_HISTORY = 10;

function getCacheKey(botId, chatId) {
  return `${botId}:${chatId}`;
}

function getHistory(botId, chatId) {
  return conversationCache.get(getCacheKey(botId, chatId)) || [];
}

function pushHistory(botId, chatId, role, content) {
  const key = getCacheKey(botId, chatId);
  const history = conversationCache.get(key) || [];
  history.push({ role, content });
  // Keep last MAX_HISTORY messages
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversationCache.set(key, history);
}

// ── Send a WhatsApp message via WAHA ─────────────────────────
async function sendWahaMessage(wahaConfig, chatId, text) {
  if (!wahaConfig.endpoint || !chatId) return;

  // Determine the correct send URL
  // WAHA API v2: POST /api/sendText
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
    console.log(`[WAHA] ✅ Sent to ${chatId}: ${text.substring(0, 80)}...`);
  } catch (err) {
    console.error(`[WAHA] ❌ Failed to send to ${chatId}:`, err.response?.data || err.message);
  }
}

// ── Check if this message should be processed ─────────────────
// Rules:
//   1. Private chat → always process
//   2. Group chat, tagOnly=false → always process
//   3. Group chat, tagOnly=true → only if bot phone number is mentioned
function shouldRespond(wahaConfig, target, messageBody, isGroup) {
  if (!isGroup) return true;
  if (!target?.tagOnly) return true;

  // Check if bot's phone number is mentioned in the message
  const botPhone = (wahaConfig.botPhoneNumber || '').replace(/\D/g, '');
  if (!botPhone) return true; // if not configured, respond to all

  // WAHA includes @mentions in message body or in mentionedIds
  // Check body text for @phone pattern
  const bodyLower = (messageBody || '').toLowerCase();
  return bodyLower.includes('@' + botPhone) || bodyLower.includes(botPhone);
}

// ── Main webhook endpoint ─────────────────────────────────────
// WAHA should be configured to POST here for each session
// URL: POST /api/waha/webhook/:botId
router.post('/webhook/:botId', async (req, res) => {
  // Acknowledge immediately so WAHA doesn't timeout
  res.status(200).json({ ok: true });

  try {
    const { botId } = req.params;
    const body = req.body;

    // Only process 'message' events
    if (body.event !== 'message' && body.event !== 'message.any') return;

    const payload = body.payload || body;

    // Extract message info
    const fromId  = payload.from || payload.chatId || '';
    const msgBody = payload.body || payload.text || payload.content || '';
    const isGroup = fromId.includes('@g.us');
    const fromMe  = payload.fromMe === true;

    // Ignore own messages
    if (fromMe) return;

    // Ignore empty messages
    if (!msgBody.trim()) return;

    // Load bot config
    const bot = await Bot.findById(botId).lean();
    if (!bot || !bot.wahaConfig?.enabled) return;

    const wahaConfig = bot.wahaConfig;

    // Find matching target config
    const target = (wahaConfig.targets || []).find(t => {
      if (!t.active) return false;
      // Compare chatId (strip any trailing info)
      return t.chatId === fromId || fromId.startsWith(t.chatId.split('@')[0]);
    });

    // If targets are configured but this chatId is not in the list, ignore
    if (wahaConfig.targets?.length > 0 && !target) {
      console.log(`[WAHA Webhook] Ignoring message from unknown chatId: ${fromId}`);
      return;
    }

    // Check tag-only rule for groups
    if (!shouldRespond(wahaConfig, target, msgBody, isGroup)) {
      console.log(`[WAHA Webhook] Ignoring group message (not tagged): ${fromId}`);
      return;
    }

    // Build clean message (strip @mentions for AI processing)
    const botPhone = (wahaConfig.botPhoneNumber || '').replace(/\D/g, '');
    const cleanMessage = msgBody
      .replace(new RegExp('@' + botPhone, 'g'), '')
      .replace(/@\d+/g, '')
      .trim();

    if (!cleanMessage) return;

    console.log(`[WAHA Webhook] Bot=${bot.name} | From=${fromId} | Group=${isGroup} | Msg="${cleanMessage.substring(0, 80)}"`);

    // Get conversation history
    const history = getHistory(botId, fromId);
    pushHistory(botId, fromId, 'user', cleanMessage);

    // Build knowledge context if enabled
    let knowledgeCtx = '';
    if (bot.knowledgeFiles?.length > 0 && bot.knowledgeMode !== 'disabled') {
      knowledgeCtx = KnowledgeBaseService.buildKnowledgeContext(
        bot.knowledgeFiles, cleanMessage, bot.knowledgeMode || 'relevant'
      );
    }

    const systemPrompt = [
      bot.prompt || bot.systemPrompt || 'You are a professional AI assistant.',
      `[TODAY: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}]`,
      knowledgeCtx,
    ].filter(Boolean).join('\n\n');

    // Generate AI response
    const aiResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt,
      messages: history.slice(-6),
      userContent: cleanMessage,
    });

    const aiResponse = aiResult.text || 'Maaf, saya tidak dapat memproses pesan Anda.';
    pushHistory(botId, fromId, 'assistant', aiResponse);

    // Send response back to WhatsApp
    await sendWahaMessage(wahaConfig, fromId, aiResponse);

    // Audit log
    await AuditService.log({
      req: { ip: req.ip, headers: req.headers, session: {} },
      category:   'chat',
      action:     'AI_RESPONSE',
      targetId:   botId,
      targetName: bot.name,
      username:   'waha_webhook',
      detail: {
        source:    'waha_webhook',
        chatId:    fromId,
        isGroup,
        model:     bot.aiProvider?.model,
        msgLength: cleanMessage.length,
      },
    });

  } catch (err) {
    console.error('[WAHA Webhook] Error:', err.message);
  }
});

// ── Helper: send message to specific target(s) ───────────────
// Used by scheduler
export async function sendWahaToTargets(bot, targets, message) {
  const wahaConfig = bot.wahaConfig;
  if (!wahaConfig?.enabled || !wahaConfig?.endpoint) return;

  const activeTargets = targets.length > 0
    ? targets
    : (wahaConfig.targets || []).filter(t => t.active);

  const results = [];
  for (const target of activeTargets) {
    try {
      await sendWahaMessage(wahaConfig, target.chatId, message);
      results.push({ chatId: target.chatId, ok: true });
    } catch (err) {
      results.push({ chatId: target.chatId, ok: false, error: err.message });
    }
  }
  return results;
}

// ── Legacy single-target send (backward compat) ──────────────
export async function sendWahaLegacy(bot, message) {
  const wahaConfig = bot.wahaConfig;
  if (!wahaConfig?.enabled) return;

  // Legacy: use chatId directly
  const chatId = wahaConfig.chatId;
  if (chatId) {
    await sendWahaMessage(wahaConfig, chatId, message);
  }

  // Also send to new targets if any
  const activeTargets = (wahaConfig.targets || []).filter(t => t.active);
  for (const target of activeTargets) {
    await sendWahaMessage(wahaConfig, target.chatId, message);
  }
}

export default router;
