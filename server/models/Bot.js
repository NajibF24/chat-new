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
    required: false
  },
  vectorStoreId: {
    type: String,
    required: false
  },
  smartsheetEnabled: {
    type: Boolean,
    default: false
  },
  smartsheetConfig: {
    useGlobalApiKey: {
      type: Boolean,
      default: true
    },
    customApiKey: String,
    primarySheetId: String, // ✅ NEW: Sheet ID utama
    workspaces: [String],
    sheets: [String],
    dashboards: [String]
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('Bot', botSchema);
