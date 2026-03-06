// server/services/audit.service.js
// Lazy-loads AuditLog model via mongoose registry first, then direct import.
// Silent-fail on every path — audit must NEVER crash the main request.

let _AuditLog  = null;
let _attempted = false;

async function getModel() {
  if (_AuditLog) return _AuditLog;
  if (_attempted) return null;
  _attempted = true;

  // ── Strategy 1: pull from mongoose model registry ─────────
  // This works if AuditLog was already registered elsewhere (normal case).
  try {
    const { default: mongoose } = await import('mongoose');
    if (mongoose.modelNames().includes('AuditLog')) {
      _AuditLog = mongoose.model('AuditLog');
      return _AuditLog;
    }
  } catch (_) {}

  // ── Strategy 2: direct file import ─────────────────────────
  try {
    const mod = await import('../models/AuditLog.js');
    const candidate = mod.default ?? mod;
    if (typeof candidate?.create === 'function') {
      _AuditLog = candidate;
      return _AuditLog;
    }
  } catch (err) {
    console.error('[AuditService] Could not load AuditLog model:', err.message);
  }

  return null;
}

/**
 * Log an audit event. Never throws.
 *
 * @param {object} opts
 * @param {import('express').Request} [opts.req]
 * @param {string}  opts.category   - 'auth'|'bot'|'user'|'knowledge'|'export'|'chat'|'system'
 * @param {string}  opts.action     - e.g. 'LOGIN_SUCCESS', 'BOT_UPDATE', 'AI_RESPONSE'
 * @param {string}  [opts.status]   - 'success'|'failed'  (default: 'success')
 * @param {string}  [opts.targetId]
 * @param {string}  [opts.targetName]
 * @param {object}  [opts.detail]
 * @param {string}  [opts.username] - overrides req.session.username
 * @param {string}  [opts.userId]   - overrides req.session.userId
 */
async function log({
  req,
  category,
  action,
  status     = 'success',
  targetId   = null,
  targetName = null,
  detail     = null,
  username,
  userId,
}) {
  try {
    const AuditLog = await getModel();
    if (!AuditLog) return;

    const resolvedUserId   = userId   ?? req?.session?.userId   ?? null;
    const resolvedUsername = username ?? req?.session?.username ?? 'system';

    const ip =
      req?.ip ||
      req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req?.connection?.remoteAddress ||
      null;

    await AuditLog.create({
      userId:     resolvedUserId  ? String(resolvedUserId)  : null,
      username:   resolvedUsername,
      category,
      action,
      status,
      targetId:   targetId   ? String(targetId)   : null,
      targetName: targetName ? String(targetName) : null,
      detail,
      ip,
      userAgent:  req?.headers?.['user-agent'] || null,
    });
  } catch (err) {
    console.error('[AuditService] log() error:', err.message);
  }
}

async function logFail(opts) {
  return log({ ...opts, status: 'failed' });
}

const AuditService = { log, logFail };
export default AuditService;