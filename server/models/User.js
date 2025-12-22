// server/models/User.js - WITH LDAP FIELDS
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  assignedBots: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bot'
  }],
  // ✅ NEW: LDAP/AD fields
  email: {
    type: String,
    default: null
  },
  displayName: {
    type: String,
    default: null
  },
  firstName: {
    type: String,
    default: null
  },
  lastName: {
    type: String,
    default: null
  },
  department: {
    type: String,
    default: null
  },
  title: {
    type: String,
    default: null
  },
  authMethod: {
    type: String,
    enum: ['local', 'ldap'],
    default: 'local'
  },
  lastLogin: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('User', userSchema);
