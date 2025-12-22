// server/check-files.js - Verify files exist and paths are correct
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filesDir = path.join(__dirname, 'data', 'files');

console.log('');
console.log('='.repeat(70));
console.log('📁 FILE VERIFICATION');
console.log('='.repeat(70));
console.log('');

async function checkFiles() {
  try {
    console.log('📂 Files Directory:', filesDir);
    console.log('');
    
    // Check if directory exists
    try {
      await fs.access(filesDir);
      console.log('✅ Directory exists');
    } catch (error) {
      console.log('❌ Directory does not exist!');
      console.log('   Creating directory...');
      await fs.mkdir(filesDir, { recursive: true });
      console.log('✅ Directory created');
    }
    
    console.log('');
    console.log('📋 Files in directory:');
    console.log('-'.repeat(70));
    
    const files = await fs.readdir(filesDir);
    
    if (files.length === 0) {
      console.log('⚠️  No files found!');
      console.log('');
      console.log('Please add your files to:');
      console.log(`   ${filesDir}`);
      console.log('');
      console.log('Example files to add:');
      console.log('   - dashboard-iot.jpeg');
      console.log('   - dashboard-iot-caliper.pdf');
      console.log('');
      return;
    }
    
    console.log(`Found ${files.length} file(s):`);
    console.log('');
    
    for (const file of files) {
      const filePath = path.join(filesDir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isFile()) {
        const ext = path.extname(file).toLowerCase();
        const sizeKB = (stats.size / 1024).toFixed(2);
        const relativePath = `/api/files/${encodeURIComponent(file)}`;
        
        console.log(`📄 ${file}`);
        console.log(`   Path: ${filePath}`);
        console.log(`   Size: ${sizeKB} KB`);
        console.log(`   Extension: ${ext}`);
        console.log(`   URL: http://localhost:5000${relativePath}`);
        console.log(`   Relative Path: ${relativePath}`);
        console.log('');
      }
    }
    
    console.log('='.repeat(70));
    console.log('✅ VERIFICATION COMPLETE');
    console.log('='.repeat(70));
    console.log('');
    console.log('Next steps:');
    console.log('1. Make sure server is running');
    console.log('2. Test file access: http://localhost:5000/api/files/dashboard-iot.jpeg');
    console.log('3. Check browser console for any CORS errors');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ ERROR');
    console.error('='.repeat(70));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(70));
    console.error('');
  }
}

checkFiles();
