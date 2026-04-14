// server/models/WahaConversation.js
import mongoose from 'mongoose';

const wahaConversationSchema = new mongoose.Schema({
  botId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', required: true },
  phoneNumber: { type: String, required: true }, // e.g. 628123456789@c.us
  displayName: { type: String, default: '' },
  history: [{
    role:      { type: String, enum: ['user', 'assistant'], required: true },
    content:   { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  }],
  lastActivity: { type: Date, default: Date.now },
}, { timestamps: true });

// Index unik per bot+nomor
wahaConversationSchema.index({ botId: 1, phoneNumber: 1 }, { unique: true });

// Auto-hapus percakapan setelah 24 jam tidak aktif
wahaConversationSchema.index({ lastActivity: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export default mongoose.models.WahaConversation
  ?? mongoose.model('WahaConversation', wahaConversationSchema);
