// server/clear-chats.js - Clear all chats to fix validation errors
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import Chat from './models/Chat.js';

dotenv.config();

const clearChats = async () => {
  try {
    console.log('🔄 Connecting to database...');
    await connectDB();

    console.log('🗑️  Clearing all chat history...');
    const result = await Chat.deleteMany({});
    
    console.log(`✅ Deleted ${result.deletedCount} chat(s)`);
    console.log('');
    console.log('Chat history cleared successfully!');
    console.log('You can now start fresh with the new schema.');
    console.log('');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

clearChats();
