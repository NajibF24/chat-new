import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Get all users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .populate('assignedBots')
      .select('-password');
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all bots
router.get('/bots', requireAdmin, async (req, res) => {
  try {
    const bots = await Bot.find();
    res.json({ bots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create user
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, assignedBots } = req.body;

    const hashedPassword = await bcryptjs.hash(password, 10);
    const user = new User({
      username,
      password: hashedPassword,
      isAdmin: isAdmin || false,
      assignedBots: assignedBots || []
    });

    await user.save();
    await user.populate('assignedBots');

    res.status(201).json({
      user: {
        id: user._id,
        username: user.username,
        isAdmin: user.isAdmin,
        assignedBots: user.assignedBots
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user
router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, assignedBots } = req.body;
    const updateData = { username, isAdmin, assignedBots };

    if (password) {
      updateData.password = await bcryptjs.hash(password, 10);
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('assignedBots').select('-password');

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete user
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
