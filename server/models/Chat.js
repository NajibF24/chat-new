import mongoose from 'mongoose';

// ============================================================================
// 📋 SUB-SCHEMA: Attachment File Object
// ============================================================================
const attachedFileSchema = new mongoose.Schema({
  name: { type: String, required: true },
  path: { type: String, required: true },
  type: { type: String, default: 'other' },
  size: { type: String, default: '0' }
}, { _id: false }); // ← Penting: Sub-dokumen tidak butuh _id sendiri disini

// ============================================================================
// 📋 MAIN SCHEMA: Chat Document
// ============================================================================
const chatSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  botId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Bot', 
    required: true,
    index: true
  },
  // ✅ UPDATE PENTING: Field Thread ID
  threadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Thread', 
    required: false, // Boleh kosong untuk backward compatibility
    index: true
  },
  
  // Data Pesan (Langsung di root, tidak di dalam array messages lagi)
  role: { 
    type: String, 
    enum: ['user', 'assistant', 'system'] 
  },
  content: { 
    type: String, 
    default: '' 
  },
  
  attachedFiles: {
    type: [attachedFileSchema],
    default: []
  },
  
  // Field lama (Legacy) dibiarkan opsional jika masih ada data lama
  attachment: {
    filename: String,
    url: String,
    mimetype: String
  },
  
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
}, { 
  timestamps: true,
  strict: true,
  strictQuery: false
});

// ============================================================================
// 🔧 INDEXES
// ============================================================================
// Index diperbarui untuk support query by threadId
chatSchema.index({ userId: 1, botId: 1, threadId: 1, createdAt: -1 });
chatSchema.index({ threadId: 1, createdAt: -1 });

export default mongoose.model('Chat', chatSchema);
