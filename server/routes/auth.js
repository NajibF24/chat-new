// server/routes/auth.js - FINAL STABLE VERSION
import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import LDAPService from '../services/ldap.service.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const ldapService = new LDAPService();

// ==================== LOGIN ROUTE ====================
router.post('/login', async (req, res) => {
  try {
    console.log('='.repeat(70));
    console.log('🔐 LOGIN ATTEMPT');
    
    // Ambil input dan paksa lowercase agar konsisten
    let { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // ✅ FIX: Normalisasi username input ke lowercase
    username = username.toLowerCase().trim();

    // ------------------------------------------------------------------
    // SKENARIO 1: LDAP USER (Primary)
    // ------------------------------------------------------------------
    if (ldapService.isEnabled()) {
      console.log(`🔐 STEP 1: Checking LDAP for: ${username}`);

      try {
        const ldapResult = await ldapService.authenticate(username, password);

        if (ldapResult.success) {
          console.log('✅ LDAP Authentication SUCCESSFUL');
          
          // ✅ FIX: Ambil username dari LDAP tapi tetap paksa lowercase
          // (Jaga-jaga jika AD mengembalikan Najib.Fauzan)
          const finalUsername = (ldapResult.user.username || username).toLowerCase();
          
          const userGroups = ldapResult.user.groups || [];
          console.log(`   User Groups: ${userGroups.join(', ')}`);

          // 1. Cek Spesial Privilege (Grup MIS)
          const isMIS = userGroups.some(group => 
            group.toLowerCase().includes('mis')
          );

          // 2. Siapkan Default Bot
          let defaultBots = [];
          if (isMIS) {
            defaultBots = await Bot.find({});
          } else {
            defaultBots = await Bot.find({ name: { $regex: /chatgpt/i } });
            if (defaultBots.length === 0) {
              const anyBot = await Bot.findOne();
              if (anyBot) defaultBots = [anyBot];
            }
          }

          // 3. Cari User di Database (Pencarian Konsisten Lowercase)
          let user = await User.findOne({ username: finalUsername });

          if (!user) {
            // ================= KONDISI A: USER BARU =================
            console.log(`🆕 Creating NEW user: ${finalUsername}`);
            user = new User({
              username: finalUsername, // Disimpan sebagai lowercase
              password: await bcrypt.hash(Math.random().toString(36), 10),
              isAdmin: isMIS,
              assignedBots: defaultBots.map(b => b._id),
              email: ldapResult.user.email,
              displayName: ldapResult.user.displayName,
              department: ldapResult.user.department,
              authMethod: 'ldap',
              lastLogin: new Date()
            });
          } else {
            // ================= KONDISI B: USER LAMA =================
            console.log(`🔄 User FOUND: ${finalUsername} (ID: ${user._id})`);
            console.log('   Updating metadata...');
            
            user.email = ldapResult.user.email || user.email;
            user.displayName = ldapResult.user.displayName || user.displayName;
            user.department = ldapResult.user.department || user.department;
            user.authMethod = 'ldap';
            user.lastLogin = new Date();

            // Smart Merge Logic (Akses)
            if (isMIS) {
                console.log('   🛡️ Enforcing MIS Privileges (Root Access)');
                user.isAdmin = true;
                user.assignedBots = defaultBots.map(b => b._id);
            } else {
                console.log('   🛡️ Respecting Manual Dashboard Configuration');
                if (!user.assignedBots || user.assignedBots.length === 0) {
                   console.log('   ⚠️ No bots assigned, giving default');
                   user.assignedBots = defaultBots.map(b => b._id);
                }
            }
          }

          await user.save();
          await user.populate('assignedBots');

          // 4. Set Session
          req.session.userId = user._id;
          req.session.isAdmin = user.isAdmin;
          req.session.authMethod = 'ldap';

          return res.json({
            user: {
              id: user._id,
              username: user.username,
              displayName: user.displayName,
              isAdmin: user.isAdmin,
              assignedBots: user.assignedBots,
              authMethod: 'ldap'
            }
          });
        }
      } catch (ldapError) {
        console.error('❌ LDAP Error (Continuing to local):', ldapError.message);
      }
    }

    // ------------------------------------------------------------------
    // SKENARIO 2: LOCAL DB (Fallback)
    // ------------------------------------------------------------------
    console.log(`🔐 STEP 2: Checking Local Database for: ${username}`);
    
    // Cari dengan lowercase juga
    const user = await User.findOne({ username }).populate('assignedBots');

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log(`✅ Local Login Successful: ${user.username}`);

    req.session.userId = user._id;
    req.session.isAdmin = user.isAdmin;
    req.session.authMethod = 'local';
    
    user.lastLogin = new Date();
    await user.save();

    res.json({
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        assignedBots: user.assignedBots,
        authMethod: 'local'
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out successfully' });
});

// Me
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).populate('assignedBots').select('-password');
  res.json({ user });
});

// Test LDAP
router.get('/test-ldap', requireAuth, async (req, res) => {
  if (!ldapService.isEnabled()) return res.json({ enabled: false });
  try {
    const result = await ldapService.testConnection();
    res.json({ enabled: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
