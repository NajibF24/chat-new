import mongoose from 'mongoose';

const threadSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  botId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Bot', 
    required: true
  },
  title: { 
    type: String, 
    default: 'New Chat' 
  },
  lastMessageAt: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

export default mongoose.model('Thread', threadSchema);
