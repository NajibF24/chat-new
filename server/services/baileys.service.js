// server/services/baileys.service.js
// ============================================================
// GYS Portal AI — Baileys v7 WhatsApp Service
//
// Single global WhatsApp connection shared across all bots.
// Uses @whiskeysockets/baileys v7 (rc.9) with:
//   - LID (Linked Identity) support for reliable group messaging
//   - Batch event processing via sock.ev.process()
//   - cachedGroupMetadata for fast group sends
//   - enableAutoSessionRecreation for automatic session recovery
//
// Session stored in: data/baileys-session/
// ============================================================

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
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
let status      = 'offline';
let reconnectTimer = null;
let connectedAt    = null;
let qrLogCount     = 0;   // Track QR regenerations to avoid log spam

// ─── Caches (v7 requirement) ────────────────────────────────────────────────
// Message retry counter — tracks how many times we've retried decryption
// for a specific message. Required by v7 to handle message retry protocol.
const msgRetryCounterCache = new NodeCache();

// In-memory store for sent messages (for getMessage callback)
const msgStore = new Map();

// Group metadata cache — CRITICAL for group sends.
// Without this, Baileys does a live fetch on every group send which
// can fail and cause 'not-acceptable' / 'No sessions'.
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

    sock = _makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      generateHighQualityLinkPreview: false,
      syncFullHistory: true,
      markOnlineOnConnect: true,
      browser: ['GYS Portal AI', 'Chrome', '120.0.0'],

      // ── v7 features ─────────────────────────────────────────────────────
      msgRetryCounterCache,
      // Auto-recreate Signal sessions when they fail — fixes 'No sessions'
      enableAutoSessionRecreation: true,
      // Cache recent messages for retry handling
      enableRecentMessageCache: true,

      // ── cachedGroupMetadata ─────────────────────────────────────────────
      // Documented fix for group send failures.
      // Baileys calls this before encrypting group messages to get
      // participant list for sender-key-distribution.
      cachedGroupMetadata: async (jid) => {
        return groupMetaCache.get(jid) || undefined;
      },

      // ── getMessage ──────────────────────────────────────────────────────
      // Required for retransmit handling (when WA asks us to re-send)
      getMessage: async (key) => {
        const stored = msgStore.get(key.id);
        if (stored) return stored.message;
        return undefined;
      },
    });

    // ── Batch event processing (v7 API) ─────────────────────────────────
    sock.ev.process(async (events) => {

      // ── Credentials update ──────────────────────────────────────────
      if (events['creds.update']) {
        await saveCreds();
      }

      // ── Connection state changes ────────────────────────────────────
      if (events['connection.update']) {
        const { connection, lastDisconnect, qr } = events['connection.update'];

        if (qr) {
          qrRaw = qr;
          status = 'qr';
          try { qrBase64 = await QRCode.toDataURL(qr); } catch (_) { qrBase64 = null; }
          qrLogCount++;
          // Only log first QR and then every 10th to avoid spam
          if (qrLogCount === 1) {
            log('📱 QR Code ready — scan from WhatsApp → Linked Devices → Link a Device');
            log('   Visit: GET /api/admin/baileys/qr');
          } else if (qrLogCount % 10 === 0) {
            log(`📱 QR Code refreshed ${qrLogCount} times — still waiting for scan. Visit: GET /api/admin/baileys/qr`);
          }
        }

        if (connection === 'connecting') {
          status = 'connecting';
          // Only log once, not on every reconnect attempt
          if (qrLogCount === 0) log('🔄 Connecting to WhatsApp...');
        }

        if (connection === 'open') {
          qrRaw = null;
          qrBase64 = null;
          qrLogCount = 0; // Reset counter on successful connect
          status = 'connected';
          connectedAt = Date.now();
          log('✅ WhatsApp connected! Pre-warming group cache in 10s...');

          // Populate group metadata cache after connection stabilizes
          setTimeout(async () => {
            log('🔥 Fetching group metadata...');
            try {
              const groups = await sock.groupFetchAllParticipating();
              const groupList = Object.values(groups);
              for (const group of groupList) {
                groupMetaCache.set(group.id, group);
              }
              log(`✅ Group cache ready: ${groupList.length} group(s). Ready to send.`);
            } catch (err) {
              log(`⚠️ Group cache warm-up failed: ${err.message}`);
            }
          }, 10000);
        }

        if (connection === 'close') {
          status = 'offline';
          const err = lastDisconnect?.error;
          const code = err instanceof Boom ? err.output?.statusCode : 0;
          const reason = DisconnectReason[code] || code;

          log(`❌ Connection closed — reason: ${reason}`);

          if (code === DisconnectReason.loggedOut) {
            log('⚠️  Logged out! Deleting session — scan QR again.');
            try {
              const files = await fsPromises.readdir(SESSION_PATH);
              await Promise.all(files.map(f => fsPromises.unlink(path.join(SESSION_PATH, f))));
            } catch (_) {}
            groupMetaCache.clear();
            reconnectTimer = setTimeout(connect, 3000);
          } else {
            log(`🔄 Reconnecting in 5s...`);
            reconnectTimer = setTimeout(connect, 5000);
          }
        }
      }

      // ── Group metadata updates ──────────────────────────────────────
      if (events['groups.update']) {
        for (const update of events['groups.update']) {
          if (!update.id) continue;
          const existing = groupMetaCache.get(update.id) || {};
          groupMetaCache.set(update.id, { ...existing, ...update });
        }
      }

      if (events['group-participants.update']) {
        const { id, participants, action } = events['group-participants.update'];
        const meta = groupMetaCache.get(id);
        if (meta) {
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
        }
      }

      // ── Incoming messages ───────────────────────────────────────────
      if (events['messages.upsert']) {
        const upsert = events['messages.upsert'];
        if (upsert.type !== 'notify') return;

        for (const msg of upsert.messages) {
          // Store for getMessage callback
          if (msg.key?.id) msgStore.set(msg.key.id, msg);
          if (msgStore.size > 500) {
            const firstKey = msgStore.keys().next().value;
            msgStore.delete(firstKey);
          }

          // Skip own outbound messages
          if (msg.key.fromMe) continue;

          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
            '';

          if (!text.trim()) continue;

          // Extract @mention JID list (provided by WA in extendedTextMessage context)
          const mentionedJid =
            msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
            msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
            [];

          if (_messageHandler) {
            try {
              await _messageHandler({ msg, text, sock, mentionedJid });
            } catch (err) {
              log('❌ Message handler error:', err.message);
            }
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

// ─── Send helper with retry ──────────────────────────────────────────────────
// 'forbidden' / 'not-authorized' / 'not a participant' → permanent, stop
// 'not-acceptable' / 'No sessions' → retry with group cache refresh
async function sendWithRetry(label, fn, jid, { maxAttempts = 5, delayMs = 10000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return true;
    } catch (err) {
      const msg      = err.message || '';
      const msgLower = msg.toLowerCase();

      log(`❌ Failed to ${label} (attempt ${attempt}/${maxAttempts}): ${msg}`);

      // Permanent failure
      if (
        msgLower.includes('forbidden') ||
        msgLower.includes('not-authorized') ||
        msgLower.includes('not a participant')
      ) {
        log(`⛔ ${label}: Permanent failure. Bot is not a member of this group.`);
        return false;
      }

      if (attempt >= maxAttempts) return false;

      // Soft failure — refresh group cache and retry
      if (msgLower.includes('not-acceptable') || msg.includes('No sessions')) {
        log(`⏳ ${label}: Refreshing group cache, retrying in ${delayMs / 1000}s...`);
        // Re-fetch group metadata to fix stale participant lists
        if (jid?.endsWith('@g.us') && sock) {
          try {
            const meta = await sock.groupMetadata(jid);
            if (meta) groupMetaCache.set(jid, meta);
          } catch (_) {}
        }
        await new Promise(r => setTimeout(r, delayMs));
      } else {
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

  // ── List all groups ────────────────────────────────────────────────────────
  async getGroups() {
    if (!this.isConnected()) return [];
    try {
      const groups = await sock.groupFetchAllParticipating();
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
