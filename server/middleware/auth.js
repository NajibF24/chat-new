import User from '../models/User.js';

// ── Helper: populate req.user dari session ────────────────────
// Dipanggil oleh semua middleware agar route bisa pakai req.user
async function populateUser(req) {
  if (req.user) return; // sudah ada, skip
  if (!req.session?.userId) return;
  try {
    const user = await User.findById(req.session.userId)
      .select('_id username isAdmin isBotCreator assignedBots')
      .lean();
    if (user) req.user = user;
  } catch {}
}

export const requireAuth = async (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  await populateUser(req);
  next();
};

export const requireAdmin = async (req, res, next) => {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  await populateUser(req);
  next();
};

export const requireAdminOrBotCreator = async (req, res, next) => {
  if (!req.session.userId || (!req.session.isAdmin && !req.session.isBotCreator)) {
    return res.status(403).json({ error: 'Admin or Bot Creator access required' });
  }
  await populateUser(req);
  next();
};
