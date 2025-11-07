import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    console.log('🔍 Login attempt received');
    console.log('🔍 Request body:', JSON.stringify(req.body));
    console.log('🔍 Content-Type:', req.get('Content-Type'));
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      console.log('❌ Missing username or password');
      return res.status(400).json({ error: 'Username and password required' });
    }

    console.log('🔍 Looking for user:', username);
    const user = await User.findOne({ username }).populate('assignedBots');
    
    if (!user) {
      console.log('❌ User not found:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('✅ User found:', user.username);
    console.log('🔍 Password hash in DB:', user.password.substring(0, 30) + '...');
    console.log('🔍 Comparing password with bcryptjs...');
    
    const isValid = await bcrypt.compare(password, user.password);
    console.log('🔍 Password comparison result:', isValid);
    
    if (!isValid) {
      console.log('❌ Invalid password for user:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('✅ Password valid, creating session...');
    req.session.userId = user._id;
    req.session.isAdmin = user.isAdmin;
    
    console.log('✅ Session data:', {
      userId: req.session.userId,
      isAdmin: req.session.isAdmin,
      sessionID: req.sessionID
    });

    const response = {
      user: {
        id: user._id,
        username: user.username,
        isAdmin: user.isAdmin,
        assignedBots: user.assignedBots
      }
    };
    
    console.log('✅ Sending response:', JSON.stringify(response));
    res.json(response);
  } catch (error) {
    console.error('❌ Login error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out successfully' });
});

// Get current user
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId)
      .populate('assignedBots')
      .select('-password');
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
