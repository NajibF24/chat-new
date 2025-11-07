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
    console.log('✅ MongoDB connected successfully');

    // Clear existing data
    console.log('🗑️  Clearing existing data...');
    await User.deleteMany({});
    await Bot.deleteMany({});
    console.log('✅ Old data cleared');

    // Create bots
    console.log('🤖 Creating bots...');
    const bots = await Bot.insertMany([
      {
        name: 'SAP Bot',
        description: 'Expert in SAP systems and processes',
        promptId: 'pmpt_sap_xxx',
        vectorStoreId: 'vs_sap_xxx'
      },
      {
        name: 'Smartsheet Bot',
        description: 'Smartsheet platform expert',
        promptId: 'pmpt_690b1ec8035081939a856b726efe574601be7398a70a0b13',
        vectorStoreId: 'vs_690b1e947b8c8191a1d8f4601f3cc21a'
      },
      {
        name: 'MekariSign Bot',
        description: 'Digital signature and document management',
        promptId: 'pmpt_mekarisign_xxx',
        vectorStoreId: 'vs_mekarisign_xxx'
      },
      {
        name: 'GlobalServices Bot',
        description: 'Global services and operations support',
        promptId: 'pmpt_globalservices_xxx',
        vectorStoreId: 'vs_globalservices_xxx'
      }
    ]);
    
    console.log(`✅ Bots seeded: ${bots.length}`);
    bots.forEach(bot => {
      console.log(`   - ${bot.name}`);
    });

    // Create admin user
    console.log('👤 Creating admin user...');
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    const admin = await User.create({
      username: 'admin',
      password: hashedPassword,
      isAdmin: true,
      assignedBots: bots.map(bot => bot._id)
    });
    
    console.log('✅ Admin user created successfully');
    console.log('   Username: admin');
    console.log('   Password: Admin@123');
    console.log(`   Assigned Bots: ${admin.assignedBots.length}`);

    // Verify user was created
    const userCount = await User.countDocuments();
    console.log(`✅ Total users in database: ${userCount}`);
    console.log('');
    console.log('🎉 Database seeding completed successfully!');
    console.log('');
    console.log('You can now login with:');
    console.log('   Username: admin');
    console.log('   Password: Admin@123');
    console.log('');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
};

seedDatabase();
