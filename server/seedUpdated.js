// server/seedUpdated.js
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Bot from './models/Bot.js';

dotenv.config();

const seedDatabase = async () => {
  try {
    console.log('🔄 Starting database seed...');
    await connectDB();

    // 1. Bersihkan data lama
    await User.deleteMany({});
    await Bot.deleteMany({});
    console.log('✅ Old data cleared');

    // 2. Buat Semua Bot (Termasuk ChatGPT)
    const bots = await Bot.insertMany([
      {
        name: 'ChatGPT Bot', // Bot standar untuk non-MIS
        description: 'Standard AI Assistant powered by OpenAI',
        promptId: null,
        vectorStoreId: null,
        smartsheetEnabled: false
      },
      {
        name: 'Smartsheet Bot',
        description: 'Project tracking expert with real-time access to all project data',
        promptId: null,
        vectorStoreId: null,
        smartsheetEnabled: true,
        smartsheetConfig: {
          useGlobalApiKey: true,
          customApiKey: null,
          primarySheetId: process.env.SMARTSHEET_PRIMARY_SHEET_ID || '7472905240661892',
          workspaces: [],
          sheets: [],
          dashboards: []
        }
      },
      {
        name: 'SAP Bot',
        description: 'General SAP systems assistant',
        promptId: null,
        vectorStoreId: null,
        smartsheetEnabled: false
      },
      {
        name: 'MekariSign Bot',
        description: 'Digital signature and document management assistant',
        promptId: null,
        vectorStoreId: null,
        smartsheetEnabled: false
      },
      {
        name: 'GlobalServices Bot',
        description: 'Global services and operations support assistant',
        promptId: null,
        vectorStoreId: null,
        smartsheetEnabled: false
      }
    ]);

    console.log(`✅ Bots created: ${bots.length}`);

    // 3. Buat Local Admin (Super User / Root)
    // Admin ini dibuat di Database Lokal, bukan LDAP.
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    const admin = await User.create({
      username: 'admin',
      password: hashedPassword,
      isAdmin: true, // ✅ PENTING: Flag ini memberi akses Dashboard
      assignedBots: bots.map(bot => bot._id), // ✅ PENTING: Admin dapat SEMUA bot
      displayName: 'System Administrator',
      authMethod: 'local'
    });

    console.log('✅ Admin user created (Local Root)');
    console.log('');
    console.log('='.repeat(60));
    console.log('🎉 Database seeding completed!');
    console.log('Login credentials:');
    console.log('   Username: admin');
    console.log('   Password: Admin@123');
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
};

seedDatabase();
