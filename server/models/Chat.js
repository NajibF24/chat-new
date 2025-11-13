import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true,
    // ✅ ADD: Convert to string if object is passed
    set: function(value) {
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    }
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const chatSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  botId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bot',
    required: true
  },
  messages: [messageSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
chatSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// ✅ ADD: Validate messages before saving
chatSchema.pre('save', function(next) {
  // Ensure all message contents are strings
  this.messages.forEach((msg, index) => {
    if (typeof msg.content !== 'string') {
      console.warn(`⚠️ Converting message[${index}].content to string`);
      msg.content = String(msg.content);
    }
  });
  next();
});

export default mongoose.model('Chat', chatSchema);
