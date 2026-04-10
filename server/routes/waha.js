// server/routes/waha.js
// ============================================================
// WAHA WhatsApp Webhook Receiver
// ✅ UPDATED: Detailed logging, per-target message routing,
//             two-way chat with full audit trail
//
// Configure WAHA to POST to either:
//   POST /api/waha/webhook/:botId
//   POST /api/webhook/waha/:botId  (alias — set in server.js)
// ============================================================

import express from 'express';
import axios   from 'axios';
import Bot     from '../models/Bot.js';
import AIProviderService from '../services/ai-provider.service.js';
import KnowledgeBaseService from '../services/knowledge-base.service.js';
import AuditService from '../services/audit.service.js';

const router = express.Router();

// ── Logger helper ─────────────────────────────────────────────
const LOG_PREFIX = '[WAHA Webhook]';
function log(level, ...args) {
  const ts = new Date().toISOString();
  const prefix = `${ts} ${LOG_PREFIX}`;
  if (level === 'ERROR') console.error(prefix, '❌', ...args);
  else if (level === 'WARN')  console.warn(prefix,  '⚠️', ...args);
  else if (level === 'INFO')  console.log(prefix,   'ℹ️', ...args);
  else                        console.log(prefix,   '✅', ...args);
}

// ── In-memory conversation history per chatId (max 20 messages) ──
const conversationCache = new Map();
const MAX_HISTORY = 20;

function getHistory(botId, chatId) {
  return conversationCache.get(`${botId}:${chatId}`) || [];
}

function pushHistory(botId, chatId, role, content) {
  const key     = `${botId}:${chatId}`;
  const history = conversationCache.get(key) || [];
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversationCache.set(key, history);
  return history;
}

// ── Send a WhatsApp message via WAHA ─────────────────────────
async function sendWahaMessage(wahaConfig, chatId, text) {
  if (!wahaConfig.endpoint || !chatId) {
    log('WARN', `sendWahaMessage: missing endpoint or chatId. endpoint=${wahaConfig.endpoint}, chatId=${chatId}`);
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

  log('INFO', `Sending to chatId=${chatId} | len=${text.length} | url=${sendUrl}`);
  log('INFO', `  Message preview: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

  try {
    const res = await axios.post(sendUrl, payload, { headers, timeout: 20000 });
    log('OK', `Delivered to ${chatId} | status=${res.status}`);
    return true;
  } catch (err) {
    const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    log('ERROR', `Failed to send to ${chatId}: ${errMsg}`);
    return false;
  }
}

// ── Determine if bot should respond to this message ───────────
function shouldRespond(wahaConfig, target, messageBody, isGroup, mentionedIds = []) {
  if (!isGroup) {
    log('INFO', `  → Private chat: always respond`);
    return true;
  }

  if (!target?.tagOnly) {
    log('INFO', `  → Group chat (tagOnly=false): always respond`);
    return true;
  }

  // tagOnly mode: check if bot is mentioned
  const botPhone = (wahaConfig.botPhoneNumber || '').replace(/\D/g, '');
  if (!botPhone) {
    log('WARN', `  → tagOnly=true but botPhoneNumber not configured — responding anyway`);
    return true;
  }

  // Check mentionedIds array (WAHA provides this)
  const mentionedById = mentionedIds.some(id => id.replace(/\D/g, '').includes(botPhone));

  // Check @mention in body text
  const bodyLower = (messageBody || '').toLowerCase();
  const mentionedInBody = bodyLower.includes('@' + botPhone) || bodyLower.includes(botPhone);

  const willRespond = mentionedById || mentionedInBody;
  log('INFO', `  → Group tagOnly=true | botPhone=${botPhone} | mentionedById=${mentionedById} | mentionedInBody=${mentionedInBody} | willRespond=${willRespond}`);
  return willRespond;
}

// ── Extract message details from WAHA payload ─────────────────
function extractMessageInfo(body) {
  const payload = body.payload || body;

  // WAHA v2 format
  const fromId      = payload.from || payload.chatId || payload.key?.remoteJid || '';
  const msgBody     = payload.body || payload.text || payload.content || payload.message?.conversation || '';
  const fromMe      = payload.fromMe === true || payload.key?.fromMe === true;
  const isGroup     = fromId.includes('@g.us');
  const senderName  = payload.notifyName || payload._data?.notifyName || payload.sender?.pushname || 'Unknown';
  const senderPhone = payload.sender?.id || payload.key?.participant || '';
  const mentionedIds = payload.mentionedIds || payload._data?.mentionedJidList || [];
  const msgId       = payload.id || payload.key?.id || '';
  const msgType     = payload.type || 'text';
  const timestamp   = payload.timestamp || payload.t || Date.now();

  return { fromId, msgBody, fromMe, isGroup, senderName, senderPhone, mentionedIds, msgId, msgType, timestamp };
}

// ── Main webhook endpoint ─────────────────────────────────────
router.post('/webhook/:botId', async (req, res) => {
  const startTime = Date.now();

  // Acknowledge immediately to prevent WAHA timeout
  res.status(200).json({ ok: true, received: true });

  const { botId } = req.params;
  const body      = req.body;
  const event     = body.event || 'unknown';
  const session   = body.session || body.sessionName || 'unknown';

  log('INFO', `─────────────────────────────────────────`);
  log('INFO', `Received event="${event}" session="${session}" botId=${botId}`);
  log('INFO', `Raw body keys: ${Object.keys(body).join(', ')}`);

  try {
    // Only process incoming message events
    const validEvents = ['message', 'message.any', 'message.received'];
    if (!validEvents.includes(event)) {
      log('INFO', `Skipping non-message event: ${event}`);
      return;
    }

    // Extract message info
    const {
      fromId, msgBody, fromMe, isGroup,
      senderName, senderPhone, mentionedIds, msgId, msgType, timestamp
    } = extractMessageInfo(body);

    log('INFO', `Message details:`);
    log('INFO', `  msgId     = ${msgId}`);
    log('INFO', `  fromId    = ${fromId}`);
    log('INFO', `  fromMe    = ${fromMe}`);
    log('INFO', `  isGroup   = ${isGroup}`);
    log('INFO', `  msgType   = ${msgType}`);
    log('INFO', `  sender    = ${senderName} (${senderPhone})`);
    log('INFO', `  body      = "${(msgBody || '').substring(0, 100)}"`);
    log('INFO', `  mentions  = [${mentionedIds.join(', ')}]`);

    // Skip own messages
    if (fromMe) {
      log('INFO', `Skipping own message (fromMe=true)`);
      return;
    }

    // Skip empty messages
    if (!msgBody || !msgBody.trim()) {
      log('INFO', `Skipping empty message body`);
      return;
    }

    // Skip non-text types (for now)
    if (!['text', 'chat', 'extendedTextMessage', ''].includes(msgType) && msgBody) {
      log('WARN', `Message type "${msgType}" — processing body text anyway`);
    }

    // Load bot config
    const bot = await Bot.findById(botId).lean();
    if (!bot) {
      log('ERROR', `Bot not found: ${botId}`);
      return;
    }
    if (!bot.wahaConfig?.enabled) {
      log('WARN', `Bot "${bot.name}" has WAHA disabled`);
      return;
    }

    log('INFO', `Bot loaded: "${bot.name}" | provider=${bot.aiProvider?.provider} | model=${bot.aiProvider?.model}`);

    const wahaConfig = bot.wahaConfig;

    // Find matching target config for this chatId
    const allTargets = wahaConfig.targets || [];
    const target = allTargets.find(t => {
      if (!t.active) return false;
      return t.chatId === fromId ||
             fromId.startsWith(t.chatId.split('@')[0]) ||
             t.chatId === fromId.split('@')[0];
    });

    log('INFO', `Target matching: ${allTargets.length} targets configured | matched=${target ? `"${target.label || target.chatId}"` : 'none'}`);

    // If targets are configured but this chatId is NOT in the list → ignore
    if (allTargets.length > 0 && !target) {
      log('INFO', `Ignoring message from unregistered chatId: ${fromId}`);
      log('INFO', `  Registered targets: ${allTargets.map(t => t.chatId).join(', ')}`);
      return;
    }

    // Check tag-only rule for groups
    if (!shouldRespond(wahaConfig, target, msgBody, isGroup, mentionedIds)) {
      log('INFO', `Not responding (tagOnly rule)`);
      return;
    }

    // Clean message: strip @mentions for AI processing
    const botPhone = (wahaConfig.botPhoneNumber || '').replace(/\D/g, '');
    const cleanMessage = msgBody
      .replace(new RegExp('@' + botPhone, 'g'), '')
      .replace(/@\d+/g, '')
      .trim();

    if (!cleanMessage) {
      log('INFO', `Clean message is empty after stripping mentions — skipping`);
      return;
    }

    log('INFO', `Clean message for AI: "${cleanMessage.substring(0, 150)}"`);

    // Get conversation history
    const history = getHistory(botId, fromId);
    log('INFO', `Conversation history: ${history.length} messages for ${fromId}`);
    pushHistory(botId, fromId, 'user', cleanMessage);

    // Build knowledge context
    let knowledgeCtx = '';
    if (bot.knowledgeFiles?.length > 0 && bot.knowledgeMode !== 'disabled') {
      knowledgeCtx = KnowledgeBaseService.buildKnowledgeContext(
        bot.knowledgeFiles, cleanMessage, bot.knowledgeMode || 'relevant'
      );
      log('INFO', `Knowledge context: ${knowledgeCtx.length} chars from ${bot.knowledgeFiles.length} files`);
    }

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // Build system prompt
    const contextParts = [
      bot.prompt || bot.systemPrompt || 'You are a professional AI assistant.',
      `[TODAY: ${today}]`,
      isGroup ? `[CONTEXT: Group chat. Sender: ${senderName}]` : `[CONTEXT: Private chat. Sender: ${senderName}]`,
      knowledgeCtx,
    ].filter(Boolean);

    const systemPrompt = contextParts.join('\n\n');

    // Generate AI response
    log('INFO', `Calling AI provider: ${bot.aiProvider?.provider}/${bot.aiProvider?.model}`);
    const aiStart = Date.now();

    const aiResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt,
      messages: history.slice(-10),
      userContent: cleanMessage,
    });

    const aiDuration = Date.now() - aiStart;
    const aiResponse = aiResult.text || 'Maaf, saya tidak dapat memproses pesan Anda.';

    log('OK', `AI responded in ${aiDuration}ms | length=${aiResponse.length}`);
    log('INFO', `AI response preview: "${aiResponse.substring(0, 150)}"`);

    // Push AI response to history
    pushHistory(botId, fromId, 'assistant', aiResponse);

    // Send response back to WhatsApp
    const sendStart = Date.now();
    const sent = await sendWahaMessage(wahaConfig, fromId, aiResponse);
    const sendDuration = Date.now() - sendStart;

    const totalDuration = Date.now() - startTime;
    log(sent ? 'OK' : 'ERROR', `Total processing time: ${totalDuration}ms | aiMs=${aiDuration} | sendMs=${sendDuration} | sent=${sent}`);

    // Audit log
    await AuditService.log({
      req:        { ip: req.ip, headers: req.headers, session: {} },
      category:   'chat',
      action:     sent ? 'AI_RESPONSE' : 'AI_RESPONSE_ERROR',
      targetId:   botId,
      targetName: bot.name,
      username:   `waha:${senderName || fromId}`,
      detail: {
        source:       'waha_webhook',
        chatId:       fromId,
        senderName,
        senderPhone,
        isGroup,
        isTagOnly:    target?.tagOnly || false,
        model:        bot.aiProvider?.model,
        msgLength:    cleanMessage.length,
        responseLen:  aiResponse.length,
        aiDurationMs: aiDuration,
        totalMs:      totalDuration,
        sent,
        tokens:       aiResult.usage || undefined,
      },
    });

  } catch (err) {
    const totalDuration = Date.now() - startTime;
    log('ERROR', `Unhandled error after ${totalDuration}ms: ${err.message}`);
    log('ERROR', err.stack);

    // Try to log audit even on error
    try {
      await AuditService.log({
        req:      { ip: req.ip, headers: req.headers, session: {} },
        category: 'chat',
        action:   'AI_RESPONSE_ERROR',
        targetId: botId,
        username: 'waha_webhook',
        detail:   { error: err.message, totalMs: Date.now() - startTime },
      });
    } catch (_) {}
  }
});

// ── Send to specific targets (used by scheduler) ──────────────
export async function sendWahaToTargets(bot, targets, message) {
  const wahaConfig = bot.wahaConfig;
  if (!wahaConfig?.enabled || !wahaConfig?.endpoint) {
    log('WARN', `sendWahaToTargets: WAHA disabled or no endpoint for bot "${bot.name}"`);
    return [];
  }

  const activeTargets = targets.length > 0
    ? targets
    : (wahaConfig.targets || []).filter(t => t.active);

  log('INFO', `sendWahaToTargets: sending to ${activeTargets.length} targets`);

  const results = [];
  for (const target of activeTargets) {
    log('INFO', `  → Target: "${target.label || target.chatId}" (${target.type})`);
    const ok = await sendWahaMessage(wahaConfig, target.chatId, message);
    results.push({ chatId: target.chatId, label: target.label, ok });
  }

  return results;
}

// ── Legacy single-target send (backward compat) ──────────────
export async function sendWahaLegacy(bot, message) {
  const wahaConfig = bot.wahaConfig;
  if (!wahaConfig?.enabled) return;

  if (wahaConfig.chatId) {
    await sendWahaMessage(wahaConfig, wahaConfig.chatId, message);
  }

  const activeTargets = (wahaConfig.targets || []).filter(t => t.active);
  for (const target of activeTargets) {
    await sendWahaMessage(wahaConfig, target.chatId, message);
  }
}

export default router;
