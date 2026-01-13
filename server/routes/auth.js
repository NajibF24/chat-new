// server/routes/auth.js - DYNAMIC ADMIN GROUPS VERSION
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
    
    let { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Normalisasi input
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
          
          const finalUsername = (ldapResult.user.username || username).toLowerCase();
          const userGroups = ldapResult.user.groups || [];
          console.log(`   User Groups: ${userGroups.join(', ')}`);

          // ============================================================
          // 🔥 FIX: LOGIC DINAMIS DARI .ENV
          // ============================================================
          // 1. Ambil setting dari .env (Contoh: "MIS, IT Infrastructure, Managers")
          const envAdminGroups = process.env.LDAP_ADMIN_GROUPS || 'MIS';
          
          // 2. Pecah jadi array & bersihkan spasi -> ['mis', 'it infrastructure', 'managers']
          const allowedGroups = envAdminGroups.toLowerCase().split(',').map(g => g.trim());
          
          console.log(`   🎯 Allowed Admin Groups: ${allowedGroups.join(', ')}`);

          // 3. Cek apakah user punya SALAH SATU grup tersebut
          const isAdminAccess = userGroups.some(userGroup => {
            const g = userGroup.toLowerCase();
            return allowedGroups.some(allowed => g.includes(allowed));
          });
          
          if (isAdminAccess) {
             console.log('   🛡️ PRIVILEGE DETECTED: User granted ADMIN Access');
          }

          // 2. Siapkan Bot
          let defaultBots = [];
          if (isAdminAccess) {
            // Admin dapat SEMUA Bot
            defaultBots = await Bot.find({});
          } else {
            // User Biasa hanya dapat ChatGPT
            defaultBots = await Bot.find({ name: { $regex: /chatgpt/i } });
            if (defaultBots.length === 0) {
              const anyBot = await Bot.findOne();
              if (anyBot) defaultBots = [anyBot];
            }
          }

          // 3. Proses User Database
          let user = await User.findOne({ username: finalUsername });

          if (!user) {
            // USER BARU
            console.log(`🆕 Creating NEW user: ${finalUsername}`);
            user = new User({
              username: finalUsername,
              password: await bcrypt.hash(Math.random().toString(36), 10),
              isAdmin: isAdminAccess, // Pakai hasil cek dinamis tadi
              assignedBots: defaultBots.map(b => b._id),
              email: ldapResult.user.email,
              displayName: ldapResult.user.displayName,
              department: ldapResult.user.department,
              authMethod: 'ldap',
              lastLogin: new Date()
            });
          } else {
            // USER LAMA
            console.log(`🔄 User FOUND: ${finalUsername}`);
            
            user.email = ldapResult.user.email || user.email;
            user.displayName = ldapResult.user.displayName || user.displayName;
            user.department = ldapResult.user.department || user.department;
            user.authMethod = 'ldap';
            user.lastLogin = new Date();

            // Update Akses jika user masuk grup Admin
            if (isAdminAccess) {
                console.log('   🛡️ Enforcing ADMIN Privileges');
                user.isAdmin = true;
                const allBots = await Bot.find({}); 
                user.assignedBots = allBots.map(b => b._id);
            } else {
                // Jika dulunya admin tapi sekarang dikeluarkan dari grup, cabut akses? 
                // Opsional: user.isAdmin = false; (Hati-hati jika ingin menerapkan ini)
                if (!user.assignedBots || user.assignedBots.length === 0) {
                   user.assignedBots = defaultBots.map(b => b._id);
                }
            }
          }

          await user.save();
          await user.populate('assignedBots');

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
        console.error('❌ LDAP Error:', ldapError.message);
      }
    }

    // ------------------------------------------------------------------
    // SKENARIO 2: LOCAL DB
    // ------------------------------------------------------------------
    console.log(`🔐 STEP 2: Checking Local Database for: ${username}`);
    const user = await User.findOne({ username }).populate('assignedBots');

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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

// Logout & Other Routes...
router.post('/logout', (req, res) => { req.session.destroy(); res.json({ message: 'Logged out' }); });
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).populate('assignedBots').select('-password');
  res.json({ user });
});
router.get('/test-ldap', requireAuth, async (req, res) => {
  if (!ldapService.isEnabled()) return res.json({ enabled: false });
  try {
    const result = await ldapService.testConnection();
    res.json({ enabled: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;