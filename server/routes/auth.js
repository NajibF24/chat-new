import express  from 'express';
import bcrypt   from 'bcryptjs';
import User     from '../models/User.js';
import Bot      from '../models/Bot.js';
import LDAPService from '../services/ldap.service.js';
import { requireAuth } from '../middleware/auth.js';
import AuditService from '../services/audit.service.js';

const router = express.Router();
const ldapService = new LDAPService();

// ── Helper: deteksi apakah input berformat email ──────────────
const isEmailFormat = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);

// ============================================================
// 🔐 LOGIN
// ============================================================
router.post('/login', async (req, res) => {
  try {
    console.log('='.repeat(70));
    console.log('🔐 LOGIN ATTEMPT');

    let { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username/email and password required' });

    const rawIdentifier = username.trim();
    username = rawIdentifier.toLowerCase();
    const loginByEmail = isEmailFormat(username);

    console.log(`   Login identifier: "${username}" (${loginByEmail ? 'email' : 'username'})`);

    // ── SKENARIO 1: LDAP ──────────────────────────────────────
    if (ldapService.isEnabled()) {
      console.log(`🔐 STEP 1: Checking LDAP for: ${username}`);

      const ldapUsername = loginByEmail ? username.split('@')[0] : username;

      try {
        const ldapResult = await ldapService.authenticate(ldapUsername, password);

        if (ldapResult.success) {
          console.log('✅ LDAP Authentication SUCCESSFUL');

          const finalUsername = (ldapResult.user.username || ldapUsername).toLowerCase();
          const userGroups    = ldapResult.user.groups || [];
          console.log(`   User Groups: ${userGroups.join(', ')}`);

          const envAdminGroups  = process.env.LDAP_ADMIN_GROUPS || 'MIS';
          const allowedGroups   = envAdminGroups.toLowerCase().split(',').map(g => g.trim());
          console.log(`   🎯 Allowed Admin Groups: ${allowedGroups.join(', ')}`);

          const isAdminAccess = userGroups.some(userGroup => {
            const g = userGroup.toLowerCase();
            return allowedGroups.some(allowed => g.includes(allowed));
          });
          if (isAdminAccess) console.log('   🛡️ PRIVILEGE DETECTED: User granted ADMIN Access');

          let defaultBots = [];
          if (isAdminAccess) {
            defaultBots = await Bot.find({});
          } else {
            defaultBots = await Bot.find({ name: { $regex: /chatgpt/i } });
            if (defaultBots.length === 0) {
              const anyBot = await Bot.findOne();
              if (anyBot) defaultBots = [anyBot];
            }
          }

          let user = await User.findOne({ username: finalUsername });

          if (!user && ldapResult.user.email) {
            user = await User.findOne({ email: ldapResult.user.email });
            if (user) console.log(`   📧 User found by email: ${ldapResult.user.email}`);
          }

          if (user && user.username !== finalUsername && user.authMethod === 'local') {
            console.warn(`⚠️  Conflict: LDAP "${finalUsername}" would overwrite local user "${user.username}". Creating new LDAP user.`);
            user = null;
          }

          const isNewUser = !user;
          if (!user) {
            console.log(`🆕 Creating NEW user: ${finalUsername}`);
            user = new User({
              username:    finalUsername,
              password:    await bcrypt.hash(Math.random().toString(36), 10),
              isAdmin:     isAdminAccess,
              isBotCreator: false, // Default false untuk user baru LDAP
              assignedBots: defaultBots.map(b => b._id),
              email:       ldapResult.user.email || null,
              displayName: ldapResult.user.displayName,
              department:  ldapResult.user.department,
              authMethod:  'ldap',
              lastLogin:   new Date(),
            });
          } else {
            console.log(`🔄 User FOUND: ${user.username}`);
            user.email       = ldapResult.user.email || user.email;
            user.displayName = ldapResult.user.displayName || user.displayName;
            user.department  = ldapResult.user.department  || user.department;
            user.authMethod  = 'ldap';
            user.lastLogin   = new Date();

            if (isAdminAccess) {
              console.log('   🛡️ Enforcing ADMIN Privileges');
              user.isAdmin = true;
              const allBots = await Bot.find({});
              user.assignedBots = allBots.map(b => b._id);
            } else if (!user.assignedBots || user.assignedBots.length === 0) {
              user.assignedBots = defaultBots.map(b => b._id);
            }
          }

          await user.save();
          await user.populate('assignedBots');

          // ✅ Menyimpan ke sesi LDAP
          req.session.userId     = user._id;
          req.session.username   = user.username;
          req.session.isAdmin    = user.isAdmin;
          req.session.isBotCreator = user.isBotCreator;
          req.session.authMethod = 'ldap';

          console.log(`✅ Session set for: ${user.username} (${user._id})`);

          // ── Audit ──────────────────────────────────────────
          AuditService.log({
            req,
            category:   'auth',
            action:     'LOGIN_SUCCESS',
            targetId:   user._id,
            targetName: user.username,
            username:   user.username,
            userId:     user._id,
            detail: {
              authMethod:  'ldap',
              isAdmin:     user.isAdmin,
              isBotCreator: user.isBotCreator,
              isNewUser,
              groups:      userGroups,
            },
          });

          return res.json({
            user: {
              id:          user._id,
              username:    user.username,
              displayName: user.displayName,
              isAdmin:     user.isAdmin,
              isBotCreator: user.isBotCreator,
              assignedBots: user.assignedBots,
              authMethod:  'ldap',
            },
          });
        }
      } catch (ldapError) {
        console.error('❌ LDAP Error:', ldapError.message);
        // Fall through to local auth
      }
    }

    // ── SKENARIO 2: Local DB ──────────────────────────────────
    console.log(`🔐 STEP 2: Checking Local Database for: ${username}`);

    const user = await User.findOne(
      loginByEmail ? { email: username } : { username },
    ).populate('assignedBots');

    if (!user || !(await bcrypt.compare(password, user.password))) {
      AuditService.log({
        req,
        category:   'auth',
        action:     'LOGIN_FAILED',
        status:     'failed',
        targetName: username,
        username:   username,
        detail: { authMethod: 'local', reason: !user ? 'user_not_found' : 'wrong_password' },
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // ✅ Menyimpan isBotCreator ke dalam sesi Local DB
    req.session.userId     = user._id;
    req.session.username   = user.username;
    req.session.isAdmin    = user.isAdmin;
    req.session.isBotCreator = user.isBotCreator;
    req.session.authMethod = 'local';

    user.lastLogin = new Date();
    await user.save();

    // ── Audit ────────────────────────────────────────────────
    AuditService.log({
      req,
      category:   'auth',
      action:     'LOGIN_SUCCESS',
      targetId:   user._id,
      targetName: user.username,
      username:   user.username,
      userId:     user._id,
      detail: { authMethod: 'local', isAdmin: user.isAdmin, isBotCreator: user.isBotCreator },
    });

    res.json({
      user: {
        id:          user._id,
        username:    user.username,
        displayName: user.displayName,
        isAdmin:     user.isAdmin,
        isBotCreator: user.isBotCreator, // ✅ Mengirim isBotCreator ke Frontend React
        assignedBots: user.assignedBots,
        authMethod:  'local',
      },
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 🚪 LOGOUT
// ============================================================
router.post('/logout', (req, res) => {
  const uid  = req.session?.userId;
  const uname = req.session?.username;

  AuditService.log({
    req,
    category:   'auth',
    action:     'LOGOUT',
    targetId:   uid,
    targetName: uname,
    username:   uname,
    userId:     uid,
  });

  req.session.destroy();
  res.json({ message: 'Logged out' });
});

// ============================================================
// 👤 ME / LDAP TEST
// ============================================================
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId)
    .populate('assignedBots').select('-password');

  // Memastikan data sesi juga diupdate jika ada GET /me
  if (user) {
    req.session.isAdmin = user.isAdmin;
    req.session.isBotCreator = user.isBotCreator;
  }

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
