// server/routes/waha.js
// ============================================================
// GYS Portal AI — WhatsApp Message Handler
//
// Incoming messages are handled via Baileys events (see server.js).
// The webhook route (POST /webhook/:botId) is kept as legacy fallback.
//
// Outgoing messages use BaileysService (text + images).
// ============================================================

import express from 'express';
import Bot     from '../models/Bot.js';
import AIProviderService from '../services/ai-provider.service.js';
import KnowledgeBaseService from '../services/knowledge-base.service.js';
import AuditService from '../services/audit.service.js';
import BaileysService from '../services/baileys.service.js';

const router = express.Router();

// ── In-memory conversation history per chatId (max 10 messages) ──
const conversationCache = new Map();
const MAX_HISTORY = 10;

function getCacheKey(botId, chatId) { return `${botId}:${chatId}`; }
function getHistory(botId, chatId)  { return conversationCache.get(getCacheKey(botId, chatId)) || []; }
function pushHistory(botId, chatId, role, content) {
  const key = getCacheKey(botId, chatId);
  const history = conversationCache.get(key) || [];
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversationCache.set(key, history);
}

// ── Check if this group message should be responded to ─────────────
// For GROUP messages: only respond when bot is explicitly @mentioned
// (Groups require a tag by default. Set replyAll=true in target config to reply to all messages)
function shouldRespond(wahaConfig, target, mentionedJid, isGroup) {
  if (!isGroup) return true; // Always respond in private/DM chats

  // Always require mentions in groups by default to prevent spamming
  // If explicitly configured to replyAll, bypass the mention requirement
  if (target?.replyAll === true) return true;

  // Check if the bot's own JID is in the mentionedJid list sent by WhatsApp
  const botJid = wahaConfig.botJid || '';
  const botPhone = (wahaConfig.botPhoneNumber || '').replace(/\D/g, '');

  if (mentionedJid && mentionedJid.length > 0) {
    // mentionedJid entries look like "628xxx@s.whatsapp.net"
    const isMentioned = mentionedJid.some(jid => {
      const jidPhone = jid.replace(/\D/g, '').replace(/^0/, '62');
      return jid === botJid ||
             (botPhone && jidPhone.includes(botPhone)) ||
             (botPhone && botPhone.includes(jidPhone));
    });
    if (isMentioned) return true;
  }

  console.log(`[WA] Group msg ignored — bot not @mentioned (mentionedJid: ${JSON.stringify(mentionedJid)})`);
  return false;
}

// ── Core message processor (shared by Baileys events + legacy webhook) ──
export async function processIncomingMessage({ botId, fromId, msgBody, isGroup, mentionedJid = [], sourceIp, sourceHeaders }) {
  try {
    if (!msgBody?.trim()) return;

    const bot = await Bot.findById(botId).lean();
    if (!bot || !bot.wahaConfig?.enabled) return;

    const wahaConfig = bot.wahaConfig;

    // Find matching target
    const target = (wahaConfig.targets || []).find(t => {
      if (!t.active) return false;
      return t.chatId === fromId || fromId.startsWith(t.chatId.split('@')[0]);
    });

    // If targets configured but this chatId not in list, ignore
    if (wahaConfig.targets?.length > 0 && !target) {
      console.log(`[WA] Ignoring message from unknown chatId: ${fromId}`);
      return;
    }

    if (!shouldRespond(wahaConfig, target, mentionedJid, isGroup)) {
      return;
    }

    // Clean @mentions
    const botPhone = (wahaConfig.botPhoneNumber || '').replace(/\D/g, '');
    const cleanMessage = msgBody
      .replace(new RegExp('@' + botPhone, 'g'), '')
      .replace(/@\d+/g, '')
      .trim();

    if (!cleanMessage) return;

    console.log(`[WA] Bot=${bot.name} | From=${fromId} | Group=${isGroup} | Msg="${cleanMessage.substring(0, 80)}"`);

    const history = getHistory(botId, fromId);
    pushHistory(botId, fromId, 'user', cleanMessage);

    // Knowledge context
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

    const aiResponse = aiResult.text || 'Sorry, I could not process your message.';
    pushHistory(botId, fromId, 'assistant', aiResponse);

    // ── Send reply via Baileys ──────────────────────────────────────────────
    await BaileysService.sendText(fromId, aiResponse);

    // Audit log
    await AuditService.log({
      req: { ip: sourceIp || '0.0.0.0', headers: sourceHeaders || {}, session: {} },
      category:   'chat',
      action:     'AI_RESPONSE',
      targetId:   botId,
      targetName: bot.name,
      username:   'whatsapp',
      detail: { source: 'baileys', chatId: fromId, isGroup, model: bot.aiProvider?.model, msgLength: cleanMessage.length },
    });

  } catch (err) {
    console.error('[WA] processIncomingMessage error:', err.message);
  }
}

// ── Baileys incoming message handler ──────────────────────────────
// Called by BaileysService for every incoming message.
// Routes the message to the correct bot based on wahaConfig targets.
export async function handleBaileysMessage({ msg, text, sock, mentionedJid = [] }) {
  try {
    const fromId  = msg.key.remoteJid || '';   // e.g. "628xxx@s.whatsapp.net" or "120363...@g.us"
    const isGroup = fromId.endsWith('@g.us');

    // Find all bots that have this chatId in their targets
    const bots = await Bot.find({ 'wahaConfig.enabled': true }).lean();

    for (const bot of bots) {
      const wahaConfig = bot.wahaConfig;
      if (!wahaConfig) continue;

      const allChatIds = [
        wahaConfig.chatId,
        ...(wahaConfig.targets || []).filter(t => t.active).map(t => t.chatId),
      ].filter(Boolean);

      const matches = allChatIds.some(cid =>
        cid === fromId || fromId.startsWith(cid.split('@')[0])
      );

      if (matches) {
        await processIncomingMessage({
          botId:         String(bot._id),
          fromId,
          msgBody:       text,
          isGroup,
          mentionedJid,
          sourceIp:      '127.0.0.1',
          sourceHeaders: {},
        });
        break; // first matching bot handles it
      }
    }
  } catch (err) {
    console.error('[WA] handleBaileysMessage error:', err.message);
  }
}

// ── Legacy WAHA webhook (kept as fallback, no longer primary path) ──
router.post('/webhook/:botId', async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const { botId } = req.params;
    const body      = req.body;

    if (body.event !== 'message' && body.event !== 'message.any') return;

    const payload = body.payload || body;
    const fromId  = payload.from || payload.chatId || '';
    const msgBody = payload.body || payload.text || payload.content || '';
    const isGroup = fromId.includes('@g.us');
    if (payload.fromMe === true) return;

    await processIncomingMessage({
      botId,
      fromId,
      msgBody,
      isGroup,
      sourceIp:      req.ip,
      sourceHeaders: req.headers,
    });

  } catch (err) {
    console.error('[WAHA Webhook] Error:', err.message);
  }
});

// ── Helper: send text to specific targets via Baileys ──────────────
export async function sendToTargets(bot, targets, message) {
  const wahaConfig = bot.wahaConfig;
  if (!wahaConfig?.enabled) return;

  const activeTargets = targets.length > 0
    ? targets
    : (wahaConfig.targets || []).filter(t => t.active);

  for (const target of activeTargets) {
    await BaileysService.sendText(target.chatId, message);
  }

  // Legacy single chatId
  if (activeTargets.length === 0 && wahaConfig.chatId) {
    await BaileysService.sendText(wahaConfig.chatId, message);
  }
}

export default router;
