import mongoose from 'mongoose'; const userSchema = new mongoose.Schema({ 
  username: {
    type: String, required: true, unique: true, trim: true
  },
  password: { type: String, required: true
  },
  isAdmin: { type: Boolean, default: false
  },
  assignedBots: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bot'
  }],
  createdAt: { type: Date, default: Date.now
  }
});
export default mongoose.model('User', userSchema);
