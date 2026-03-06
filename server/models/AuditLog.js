// server/models/AuditLog.js
import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    // ── Who ──────────────────────────────────────────────────
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    username:   { type: String, default: 'system' },

    // ── What ─────────────────────────────────────────────────
    category: {
      type: String,
      enum: ['auth', 'bot', 'user', 'knowledge', 'export', 'chat', 'system'],
      required: true,
    },
    action: {
      type: String,
      required: true,
      // auth:      LOGIN_SUCCESS | LOGIN_FAILED | LOGOUT
      // bot:       BOT_CREATE | BOT_UPDATE | BOT_DELETE
      // user:      USER_CREATE | USER_UPDATE | USER_DELETE
      // knowledge: KNOWLEDGE_UPLOAD | KNOWLEDGE_DELETE
      // export:    EXPORT_CHATS
      // chat:      AI_RESPONSE | AI_RESPONSE_EMPTY | AI_RESPONSE_ERROR | IMAGE_GENERATE
    },
    status: { type: String, enum: ['success', 'failed'], default: 'success' },

    // ── Target ───────────────────────────────────────────────
    targetId:   { type: String, default: null },   // MongoDB _id as string
    targetName: { type: String, default: null },   // human-readable name

    // ── Payload (before/after diffs, token counts, etc.) ─────
    detail: { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Request context ──────────────────────────────────────
    ip:        { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  {
    timestamps: true,   // createdAt, updatedAt
    versionKey: false,
  }
);

// Auto-delete after 90 days
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

// Query indexes
auditLogSchema.index({ category: 1, createdAt: -1 });
auditLogSchema.index({ username: 1, createdAt: -1 });
auditLogSchema.index({ action: 1 });

// Avoid OverwriteModelError on hot-reload
const AuditLog = mongoose.models.AuditLog ?? mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;