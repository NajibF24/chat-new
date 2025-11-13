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

    // Clear existing data
    await User.deleteMany({});
    await Bot.deleteMany({});
    console.log('✅ Old data cleared');

    // Create bots
    const bots = await Bot.insertMany([
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

    // Create admin user
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    const admin = await User.create({
      username: 'admin',
      password: hashedPassword,
      isAdmin: true,
      assignedBots: bots.map(bot => bot._id)
    });

    console.log('✅ Admin user created');
    console.log('');
    console.log('='.repeat(60));
    console.log('🎉 Database seeding completed!');
    console.log('='.repeat(60));
    console.log('📊 Smartsheet Bot Configuration:');
    console.log(`   - Primary Sheet ID: ${process.env.SMARTSHEET_PRIMARY_SHEET_ID || '7472905240661892'}`);
    console.log(`   - API Key: ${process.env.SMARTSHEET_API_KEY ? 'Configured ✓' : 'NOT SET ⚠️'}`);
    console.log('');
    console.log('🤖 Other Bots: Standard ChatGPT mode (no vector store)');
    console.log('');
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
