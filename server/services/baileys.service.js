// server/services/baileys.service.js
// ============================================================
// GYS Portal AI — Baileys WhatsApp Service
//
// Single global WhatsApp connection shared across all bots.
// Replaces WAHA for both sending and receiving messages.
//
// Session stored in: data/baileys-session/
// QR: appears in console logs on first run, also available
//     via GET /api/admin/baileys/qr (base64 PNG)
// ============================================================

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidGroup,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import pino from 'pino';
import QRCode from 'qrcode';

// ─── ESM/CJS interop ─────────────────────────────────────────────────────────
let _makeWASocket = makeWASocket;
if (typeof _makeWASocket !== 'function') {
  const baileysMod = makeWASocket;
  _makeWASocket = baileysMod.default || baileysMod.makeWASocket || baileysMod;
}

// ─── Config ──────────────────────────────────────────────────────────────────
const SESSION_PATH = path.join(process.cwd(), 'data', 'baileys-session');
const logger = pino({ level: 'silent' });

// ─── State ───────────────────────────────────────────────────────────────────
let sock        = null;
let qrRaw       = null;
let qrBase64    = null;
let status      = 'offline'; // 'offline' | 'connecting' | 'qr' | 'connected'
let reconnectTimer = null;
let connectedAt    = null;

// ── syncFullHistory tracking ────────────────────────────────────────────────
// CRITICAL BUG FIX: After QR scan, WhatsApp sends 'restartRequired' and Baileys
// reconnects. On that reconnect, creds.me.id already exists → isNewSession=false
// → syncFullHistory=false. The completing connection NEVER gets the full sync,
// so group sender keys are never distributed → persistent 'not-acceptable'.
//
// Fix: use needsFullSync flag that persists across the restartRequired reconnect.
// It's set when a new session is detected, and only cleared AFTER a successful
// 'open' connection completes (meaning the full sync was actually delivered).
let needsFullSync = false;

// In-memory message store for getMessage callback (retransmit support)
const msgStore = new Map();

// ─── Group metadata cache ─────────────────────────────────────────────────────
// CRITICAL: cachedGroupMetadata is the documented Baileys fix for 'not-acceptable'
// on group sends. Without it, Baileys fetches group metadata on every single
// message, which creates timing issues and causes WhatsApp servers to reject
// the sender key distribution message.
//
// With this cache, Baileys can instantly look up group participants and correctly
// build the encrypted group message including sender-key-distribution for new devices.
const groupMetaCache = new Map();

// Registered incoming message handler
let _messageHandler = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function log(msg, ...args) {
  console.log(`[Baileys] ${msg}`, ...args);
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// ─── Core connect function ────────────────────────────────────────────────────
async function connect() {
  clearReconnect();

  try {
    await fsPromises.mkdir(SESSION_PATH, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    log(`Using WA v${version.join('.')} (latest: ${isLatest})`);

    // On a FRESH link (no creds.me), set needsFullSync so that BOTH this
    // connection AND the restartRequired reconnect use syncFullHistory:true.
    // The flag is only cleared after a successful 'open' connection.
    const isNewSession = !state.creds?.me?.id;
    if (isNewSession) {
      needsFullSync = true;
      log('🆕 New session — will sync full history on this + next connection (restartRequired flow)');
    }
    const useFullSync = isNewSession || needsFullSync;
    if (useFullSync && !isNewSession) {
      log('🔄 Continuing post-QR full sync (restartRequired reconnect)...');
    }

    sock = _makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: true,
      generateHighQualityLinkPreview: false,
      syncFullHistory: useFullSync,
      markOnlineOnConnect: false,
      browser: ['GYS Portal AI', 'Chrome', '120.0.0'],

      // ── CRITICAL FIX: cachedGroupMetadata ──────────────────────────────────
      // This is the documented Baileys fix for 'not-acceptable' on group sends.
      // Baileys calls this before encrypting group messages to get the participant
      // list needed to build sender-key-distribution messages.
      // Without this, Baileys does a live fetch that can fail/time out, causing
      // WhatsApp to reject the message with 'not-acceptable'.
      cachedGroupMetadata: async (jid) => {
        return groupMetaCache.get(jid) || undefined;
      },

      // Required for WhatsApp to handle retransmit requests
      getMessage: async (key) => {
        const stored = msgStore.get(key.id);
        if (stored) return stored.message;
        return { conversation: '(retry)' };
      },
    });

    // ── Save credentials on update ──────────────────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── Keep group metadata cache in sync ───────────────────────────────────
    sock.ev.on('groups.update', (updates) => {
      for (const update of updates) {
        if (!update.id) continue;
        const existing = groupMetaCache.get(update.id) || {};
        groupMetaCache.set(update.id, { ...existing, ...update });
      }
    });

    sock.ev.on('group-participants.update', ({ id, participants, action }) => {
      const meta = groupMetaCache.get(id);
      if (!meta) return;
      if (action === 'remove') {
        meta.participants = (meta.participants || []).filter(
          p => !participants.includes(p.id)
        );
      } else if (action === 'add') {
        for (const jid of participants) {
          if (!meta.participants?.find(p => p.id === jid)) {
            meta.participants = [...(meta.participants || []), { id: jid }];
          }
        }
      }
      groupMetaCache.set(id, meta);
    });

    // ── Connection state changes ────────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrRaw = qr;
        status = 'qr';
        try { qrBase64 = await QRCode.toDataURL(qr); } catch (_) { qrBase64 = null; }
        log('📱 QR Code ready — scan from WhatsApp → Linked Devices → Link a Device');
        log('   Or visit: GET /api/admin/baileys/qr');
      }

      if (connection === 'connecting') {
        status = 'connecting';
        log('🔄 Connecting to WhatsApp...');
      }

      if (connection === 'open') {
        qrRaw = null;
        qrBase64 = null;
        status = 'connected';
        connectedAt = Date.now();
        log('✅ WhatsApp connected! Pre-warming group metadata cache in 15s...');
        // Mark full sync as delivered — clear the flag so reconnects are fast
        needsFullSync = false;
        log('📋 syncFullHistory delivered — subsequent reconnects will use fast path.');

        // After 15s, fetch ALL groups and populate the metadata cache.
        // This ensures cachedGroupMetadata returns valid data immediately on
        // the first send, preventing 'not-acceptable' from live-fetch failures.
        setTimeout(async () => {
          log('🔥 Fetching group metadata to populate cache...');
          try {
            const groups = await sock.groupFetchAllParticipating();
            const groupList = Object.values(groups);
            for (const group of groupList) {
              groupMetaCache.set(group.id, group);
            }
            log(`✅ Cache populated: ${groupList.length} group(s) ready. Bot can now send to groups.`);
          } catch (err) {
            log(`⚠️ Group cache warm-up failed (non-fatal): ${err.message}`);
            log('✅ Session warmup complete.');
          }
        }, 15000);
      }

      if (connection === 'close') {
        status = 'offline';
        const err = lastDisconnect?.error;
        const code = err instanceof Boom ? err.output?.statusCode : 0;
        const reason = DisconnectReason[code] || code;

        log(`❌ Connection closed — reason: ${reason}`);

        if (code === DisconnectReason.loggedOut) {
          log('⚠️  Logged out! Deleting session — you must scan QR again.');
          try {
            const files = await fsPromises.readdir(SESSION_PATH);
            await Promise.all(files.map(f => fsPromises.unlink(path.join(SESSION_PATH, f))));
          } catch (_) {}
          reconnectTimer = setTimeout(connect, 3000);
        } else {
          const delay = 5000;
          log(`🔄 Reconnecting in ${delay / 1000}s...`);
          reconnectTimer = setTimeout(connect, delay);
        }
      }
    });

    // ── Incoming messages ───────────────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key?.id) msgStore.set(msg.key.id, msg);
        if (msgStore.size > 500) {
          const firstKey = msgStore.keys().next().value;
          msgStore.delete(firstKey);
        }

        if (msg.key.fromMe) continue;

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
          '';

        if (!text.trim()) continue;

        if (_messageHandler) {
          try {
            await _messageHandler({ msg, text, sock });
          } catch (err) {
            log('❌ Message handler error:', err.message);
          }
        }
      }
    });

  } catch (err) {
    log('❌ Failed to connect:', err.message);
    status = 'offline';
    reconnectTimer = setTimeout(connect, 10000);
  }
}

// ─── Send helper: refresh group metadata before retry ────────────────────────
async function refreshGroupCache(jid) {
  if (!sock || !jid.endsWith('@g.us')) return;
  try {
    const meta = await sock.groupMetadata(jid);
    if (meta) groupMetaCache.set(jid, meta);
  } catch (_) {}
}

// ─── Internal retry helper ────────────────────────────────────────────────────
// Error classification:
//   'forbidden' / 'not-authorized' / 'not a participant'
//     → PERMANENT: bot is kicked/not a member, stop immediately.
//
//   'not-acceptable'
//     → SOFT: sender key not yet distributed (WA multi-device timing issue).
//       Retry with group cache refresh between attempts.
//
//   'No sessions'
//     → SOFT: Signal prekey sessions not established yet, retry with delay.
async function sendWithRetry(label, fn, jid, { maxAttempts = 5, delayMs = 10000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return true;
    } catch (err) {
      const msg      = err.message || '';
      const msgLower = msg.toLowerCase();

      log(`❌ Failed to ${label} (attempt ${attempt}/${maxAttempts}): ${msg}`);

      // ⛔ PERMANENT — retrying will never help
      if (
        msgLower.includes('forbidden') ||
        msgLower.includes('not-authorized') ||
        msgLower.includes('not a participant')
      ) {
        log(`⛔ ${label}: Bot is not a member of this group or messaging is restricted. Stopping.`);
        return false;
      }

      if (attempt >= maxAttempts) return false;

      // ⏳ SOFT — refresh state and retry
      if (msgLower.includes('not-acceptable') || msg.includes('No sessions')) {
        log(`⏳ ${label}: Refreshing group cache and retrying in ${delayMs / 1000}s...`);
        await refreshGroupCache(jid);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        // Unknown error — don't retry
        return false;
      }
    }
  }
  return false;
}

// ─── Public API ──────────────────────────────────────────────────────────────
const BaileysService = {

  async init() {
    log('🚀 Starting WhatsApp Baileys service...');
    await connect();
  },

  setMessageHandler(fn) {
    _messageHandler = fn;
  },

  isConnected() {
    return status === 'connected' && sock !== null;
  },

  getStatus() {
    return status;
  },

  getQRBase64() {
    return qrBase64;
  },

  // ── Send text ─────────────────────────────────────────────────────────────
  async sendText(jid, text) {
    if (!this.isConnected()) {
      log(`⚠️  Cannot send text — not connected (status: ${status})`);
      return false;
    }
    return sendWithRetry(`send text to ${jid}`, async () => {
      await sock.sendMessage(jid, { text });
      log(`✅ Text sent to ${jid}`);
    }, jid);
  },

  // ── Send image from file path ─────────────────────────────────────────────
  async sendImage(jid, imagePath, caption = '') {
    if (!this.isConnected()) {
      log(`⚠️  Cannot send image — not connected (status: ${status})`);
      return false;
    }
    if (!fs.existsSync(imagePath)) {
      log(`❌ Image file not found: ${imagePath}`);
      return false;
    }
    const buffer = fs.readFileSync(imagePath);
    return sendWithRetry(`send image to ${jid}`, async () => {
      await sock.sendMessage(jid, { image: buffer, caption, mimetype: 'image/png' });
      log(`✅ Image sent to ${jid}`);
    }, jid);
  },

  // ── List all groups the bot has joined ────────────────────────────────────
  async getGroups() {
    if (!this.isConnected()) return [];
    try {
      const groups = await sock.groupFetchAllParticipating();
      // Also update local cache
      for (const [jid, meta] of Object.entries(groups)) {
        groupMetaCache.set(jid, meta);
      }
      return Object.values(groups)
        .map(g => ({
          id:         g.id,
          name:       g.subject || '(no name)',
          size:       g.participants?.length || 0,
          creation:   g.creation,
          restricted: g.restrict || false,
          announce:   g.announce || false,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      log(`❌ getGroups failed: ${err.message}`);
      return [];
    }
  },

  // ── Disconnect & clear session ────────────────────────────────────────────
  async logout() {
    try {
      clearReconnect();
      if (sock) await sock.logout();
    } catch (_) {}
    status = 'offline';
    sock = null;
    groupMetaCache.clear();
    log('👋 Logged out');
  },

};

export default BaileysService;
