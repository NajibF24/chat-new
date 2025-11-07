import mongoose from 'mongoose';

const botSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: String,
  promptId: {
    type: String,
    required: true
  },
  vectorStoreId: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('Bot', botSchema);
