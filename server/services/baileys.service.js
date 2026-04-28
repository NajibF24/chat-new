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

// ─── ESM/CJS interop: Baileys is a CJS module ───────────────────────────────
// If named imports fail (makeWASocket is not a function), fall back to this:
let _makeWASocket = makeWASocket;
if (typeof _makeWASocket !== 'function') {
  // CJS default export wraps everything in module.exports
  const baileysMod = makeWASocket; // the whole module object
  _makeWASocket = baileysMod.default || baileysMod.makeWASocket || baileysMod;
}

// ─── Config ──────────────────────────────────────────────────────────────────
const SESSION_PATH = path.join(process.cwd(), 'data', 'baileys-session');
const logger = pino({ level: 'silent' }); // suppress Baileys verbose logs

// ─── State ───────────────────────────────────────────────────────────────────
let sock = null;
let qrRaw = null;       // raw QR string (for terminal)
let qrBase64 = null;    // base64 PNG (for admin UI)
let status = 'offline'; // 'offline' | 'connecting' | 'qr' | 'connected'
let reconnectTimer = null;
let connectedAt = null; // timestamp when connection was established

// In-memory store for sent messages (needed for retry requests / No sessions fix)
// Key: msgId → WAProto.IWebMessageInfo
const msgStore = new Map();

// Registered incoming message handler (set by waha.js or server.js)
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

    // ── Detect new vs existing session ──────────────────────────────────────
    // On a FRESH link (no creds.me = no registered account yet) we enable
    // syncFullHistory so WhatsApp distributes ALL group sender keys to this
    // new linked device. Without this, every group send fails with 'No sessions'
    // until organic message exchange happens — same issue as WhatsApp Web fresh login.
    //
    // On RECONNECTS (creds already registered) we keep syncFullHistory: false
    // for fast startup — sender keys are already cached in session files.
    const isNewSession = !state.creds?.me?.id;
    if (isNewSession) {
      log('🆕 New session detected — enabling syncFullHistory to obtain group sender keys...');
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
      // ✅ KEY FIX: sync full history on new sessions so sender keys for ALL groups
      // are distributed to this device immediately after linking.
      // On reconnects this is false (fast path — keys are already stored).
      syncFullHistory: isNewSession,
      markOnlineOnConnect: false,
      browser: ['GYS Portal AI', 'Chrome', '120.0.0'],
      // Required for WhatsApp to retry message delivery (retransmit requests)
      getMessage: async (key) => {
        const stored = msgStore.get(key.id);
        if (stored) return stored.message;
        return { conversation: '(retry)' };
      },
    });

    // ── Save credentials on update ──────────────────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── Connection state changes ────────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // New QR code
      if (qr) {
        qrRaw = qr;
        status = 'qr';
        try {
          qrBase64 = await QRCode.toDataURL(qr);
        } catch (_) {
          qrBase64 = null;
        }
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
        log('✅ WhatsApp connected! Starting 20s warmup before group session pre-warm...');

        // After 20s, fetch ALL groups and pre-establish sender key sessions.
        // This resolves 'not-acceptable' for group sends on a freshly linked device.
        // Personal messages work immediately; groups need explicit session warm-up.
        setTimeout(async () => {
          log('🔥 Pre-warming group sessions...');
          try {
            const groups = await sock.groupFetchAllParticipating();
            const groupList = Object.values(groups);
            log(`🔥 Found ${groupList.length} group(s) — establishing sessions...`);
            for (const group of groupList) {
              const jid = group.id;
              try {
                const participants = (group.participants || []).map(p => p.id).filter(Boolean);
                if (typeof sock.assertSessions === 'function' && participants.length > 0) {
                  await sock.assertSessions(participants, false).catch(() => {});
                }
                await sock.sendPresenceUpdate('available', jid).catch(() => {});
              } catch (_) {}
            }
            log('✅ Group session pre-warm complete — ready to send to all groups.');
          } catch (err) {
            log(`⚠️ Group pre-warm failed (non-fatal): ${err.message}`);
            log('✅ Session warmup complete — ready to send messages.');
          }
        }, 20000);
      }

      if (connection === 'close') {
        status = 'offline';
        const err = lastDisconnect?.error;
        const code = err instanceof Boom ? err.output?.statusCode : 0;
        const reason = DisconnectReason[code] || code;

        log(`❌ Connection closed — reason: ${reason}`);

        if (code === DisconnectReason.loggedOut) {
          log('⚠️  Logged out! Deleting session — you must scan QR again.');
          // Delete session so next connect triggers new QR
          try {
            const files = await fsPromises.readdir(SESSION_PATH);
            await Promise.all(files.map(f => fsPromises.unlink(path.join(SESSION_PATH, f))));
          } catch (_) {}
          reconnectTimer = setTimeout(connect, 3000);
        } else {
          // Normal disconnect — reconnect after delay
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
        // Store all messages for getMessage callback (retry support)
        if (msg.key?.id) msgStore.set(msg.key.id, msg);
        // Keep store bounded
        if (msgStore.size > 500) {
          const firstKey = msgStore.keys().next().value;
          msgStore.delete(firstKey);
        }

        // Skip own outbound messages
        if (msg.key.fromMe) continue;

        // Skip non-text messages (images, stickers, etc.)
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

// ─── Internal retry helper ─────────────────────────────────────────────────────────────
// ⛔ IMMEDIATELY FAILS on permanent errors (forbidden/not-acceptable/not-authorized).
//    Bot is not in group, or group doesn't exist — retrying wastes time.
// ⏳ Waits delayMs on 'No sessions' — sender keys may arrive later from WA servers.
async function sendWithRetry(label, fn, { maxAttempts = 20, delayMs = 30000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return true;
    } catch (err) {
      const msg               = err.message || '';
      const msgLower          = msg.toLowerCase();
      const isPermanentFail   = msgLower.includes('forbidden') ||
                                msgLower.includes('not-authorized') ||
                                msgLower.includes('not a participant') ||
                                msgLower.includes('not-acceptable');   // bot not in group
      const isNoSessions      = msg.includes('No sessions');

      log(`❌ Failed to ${label} (attempt ${attempt}/${maxAttempts}): ${msg}`);

      // ⛔ Hard permanent failure — retrying will NEVER fix this
      if (isPermanentFail) {
        log(`⛔ ${label}: Permanent failure (${msg}). Bot is likely not a member of this group. Use GET /api/admin/baileys/groups to see which groups the bot has joined.`);
        return false;
      }

      // ⏳ Soft failure — wait for sender key distribution
      if (isNoSessions && attempt < maxAttempts) {
        log(`⏳ No sessions — waiting ${delayMs / 1000}s for WhatsApp to distribute sender keys...`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        return false;
      }
    }
  }
  return false;
}

// ─── Force sender key sync for a group ─────────────────────────────────────────────
// 'No sessions' = Baileys doesn't have group sender keys yet.
// Fix: fetch group metadata → assert Signal sessions with participants
//      → send 'composing' presence (stimulates WA to push pending key distributions).
//
// This is what production Baileys bots do. syncFullHistory:true on first connect
// is the more reliable long-term fix; this is the per-send fallback.
async function forceGroupKeySync(jid) {
  if (!sock || !jid.endsWith('@g.us')) return;
  try {
    const metadata = await sock.groupMetadata(jid);

    // 1. assertSessions: establish Signal prekey sessions with all participants
    if (typeof sock.assertSessions === 'function') {
      const participantIds = (metadata?.participants || []).map(p => p.id).filter(Boolean);
      if (participantIds.length > 0) {
        await sock.assertSessions(participantIds, false).catch(() => {});
      }
    }

    // 2. Presence update: stimulates WhatsApp to distribute pending sender keys
    await sock.sendPresenceUpdate('composing', jid).catch(() => {});
    await sock.sendPresenceUpdate('paused',    jid).catch(() => {});
  } catch (_) {}
}


const BaileysService = {

  // Initialize and connect
  async init() {
    log('🚀 Starting WhatsApp Baileys service...');
    await connect();
  },

  // Register incoming message handler
  // fn({ msg, text, sock }) — called for each incoming text message
  setMessageHandler(fn) {
    _messageHandler = fn;
  },

  // Connection status
  isConnected() {
    return status === 'connected' && sock !== null;
  },

  getStatus() {
    return status; // 'offline' | 'connecting' | 'qr' | 'connected'
  },

  getQRBase64() {
    return qrBase64; // base64 PNG string or null
  },

  // ── Send text ─────────────────────────────────────────────────────────────
  async sendText(jid, text) {
    if (!this.isConnected()) {
      log(`⚠️  Cannot send text — not connected (status: ${status})`);
      return false;
    }
    return sendWithRetry(`send text to ${jid}`, async () => {
      await forceGroupKeySync(jid);   // establishes Signal sessions with all group participants
      await sock.sendMessage(jid, { text });
      log(`✅ Text sent to ${jid}`);
    });
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
      await forceGroupKeySync(jid);   // establishes Signal sessions with all group participants
      await sock.sendMessage(jid, { image: buffer, caption, mimetype: 'image/png' });
      log(`✅ Image sent to ${jid}`);
    });
  },

  // ── List all groups the bot is currently a member of ──────────────────
  // Use this to find the correct group JID / verify membership.
  // Returns array of { id, subject, size } sorted by name.
  async getGroups() {
    if (!this.isConnected()) return [];
    try {
      const groups = await sock.groupFetchAllParticipating();
      return Object.values(groups)
        .map(g => ({
          id:         g.id,
          name:       g.subject || '(no name)',
          size:       g.participants?.length || 0,
          creation:   g.creation,
          restricted: g.restrict || false,
          announce:   g.announce || false,  // announce=true means only admins can send
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
    log('👋 Logged out');
  },

};

export default BaileysService;
