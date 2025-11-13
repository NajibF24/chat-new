import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const API_KEY = process.env.SMARTSHEET_API_KEY;
const SHEET_ID = process.env.SMARTSHEET_PRIMARY_SHEET_ID || '7472905240661892';
const BASE_URL = 'https://api.smartsheet.com/2.0';

console.log('');
console.log('='.repeat(70));
console.log('🔍 SMARTSHEET SHEET ID VERIFICATION');
console.log('='.repeat(70));
console.log('');

// Check environment
if (!API_KEY) {
  console.error('❌ SMARTSHEET_API_KEY not found in .env');
  console.error('');
  console.error('Please add to your .env file:');
  console.error('SMARTSHEET_API_KEY=your_api_token_here');
  console.error('');
  process.exit(1);
}

console.log('✅ API Key found:', API_KEY.substring(0, 20) + '...');
console.log('📋 Testing Sheet ID:', SHEET_ID);
console.log('');

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

async function testConnection() {
  console.log('1️⃣ Testing API Connection...');
  console.log('-'.repeat(70));
  
  try {
    const response = await client.get('/users/me');
    console.log('✅ SUCCESS - API Connection OK');
    console.log(`   Email: ${response.data.email}`);
    console.log(`   Name: ${response.data.firstName} ${response.data.lastName}`);
    console.log('');
    return true;
  } catch (error) {
    console.error('❌ FAILED - Cannot connect to Smartsheet API');
    console.error(`   Error: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Message: ${error.response.data?.message || 'No message'}`);
    }
    console.error('');
    return false;
  }
}

async function listSheets() {
  console.log('2️⃣ Listing All Available Sheets...');
  console.log('-'.repeat(70));
  
  try {
    const response = await client.get('/sheets', {
      params: { includeAll: true }
    });
    
    const sheets = response.data.data || [];
    console.log(`✅ Found ${sheets.length} sheet(s)`);
    console.log('');
    
    if (sheets.length === 0) {
      console.log('⚠️  No sheets found. Make sure you have access to sheets.');
      console.log('');
      return [];
    }
    
    sheets.forEach((sheet, idx) => {
      console.log(`${idx + 1}. Sheet ID: ${sheet.id}`);
      console.log(`   Name: ${sheet.name}`);
      console.log(`   Modified: ${new Date(sheet.modifiedAt).toLocaleString('id-ID')}`);
      console.log(`   API Endpoint: https://api.smartsheet.com/2.0/sheets/${sheet.id}`);
      console.log('');
    });
    
    return sheets;
  } catch (error) {
    console.error('❌ FAILED - Cannot list sheets');
    console.error(`   Error: ${error.message}`);
    console.error('');
    return [];
  }
}

async function testSheetId() {
  console.log('3️⃣ Testing Specific Sheet ID...');
  console.log('-'.repeat(70));
  console.log(`📋 Sheet ID: ${SHEET_ID}`);
  console.log(`🔗 API URL: https://api.smartsheet.com/2.0/sheets/${SHEET_ID}`);
  console.log('');
  
  try {
    const response = await client.get(`/sheets/${SHEET_ID}`, {
      params: {
        include: 'attachments,discussions',
        level: 2
      }
    });
    
    const sheet = response.data;
    
    console.log('✅ SUCCESS - Sheet ID is VALID!');
    console.log('');
    console.log('📊 Sheet Details:');
    console.log(`   Name: ${sheet.name}`);
    console.log(`   Owner: ${sheet.owner?.name || 'Unknown'}`);
    console.log(`   Created: ${new Date(sheet.createdAt).toLocaleString('id-ID')}`);
    console.log(`   Modified: ${new Date(sheet.modifiedAt).toLocaleString('id-ID')}`);
    console.log(`   Total Rows: ${sheet.rows?.length || 0}`);
    console.log(`   Total Columns: ${sheet.columns?.length || 0}`);
    console.log('');
    
    if (sheet.columns && sheet.columns.length > 0) {
      console.log('📋 Columns:');
      sheet.columns.forEach((col, idx) => {
        console.log(`   ${idx + 1}. ${col.title} (${col.type})`);
      });
      console.log('');
    }
    
    if (sheet.rows && sheet.rows.length > 0) {
      console.log('📝 Sample Data (first 3 rows):');
      sheet.rows.slice(0, 3).forEach((row, idx) => {
        console.log(`   Row ${row.rowNumber}:`);
        row.cells.forEach((cell, cellIdx) => {
          const column = sheet.columns?.[cellIdx];
          const value = cell.displayValue || cell.value;
          if (column && value) {
            console.log(`      ${column.title}: ${value}`);
          }
        });
        console.log('');
      });
    }
    
    console.log('🔗 Permalink:');
    console.log(`   ${sheet.permalink}`);
    console.log('');
    
    return sheet;
  } catch (error) {
    console.error('❌ FAILED - Sheet ID is INVALID or inaccessible');
    console.error('');
    console.error(`   Error: ${error.message}`);
    
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Message: ${error.response.data?.message || 'No message'}`);
      
      if (error.response.status === 404) {
        console.error('');
        console.error('🔍 This Sheet ID does not exist or you don\'t have access.');
        console.error('   Please check:');
        console.error('   1. Sheet ID is correct (numeric value)');
        console.error('   2. Sheet is shared with your Smartsheet account');
        console.error('   3. Your API token has access to this sheet');
      } else if (error.response.status === 403) {
        console.error('');
        console.error('🚫 Access Denied - You don\'t have permission to this sheet.');
        console.error('   Please make sure:');
        console.error('   1. Sheet is shared with your account');
        console.error('   2. You have at least "Viewer" permission');
      }
    }
    
    console.error('');
    return null;
  }
}

async function generateCurlCommands() {
  console.log('4️⃣ CURL Commands for Manual Testing');
  console.log('-'.repeat(70));
  console.log('');
  console.log('📋 List all sheets:');
  console.log('```bash');
  console.log(`curl https://api.smartsheet.com/2.0/sheets \\`);
  console.log(`  -H "Authorization: Bearer ${API_KEY.substring(0, 20)}..."`);
  console.log('```');
  console.log('');
  console.log('📊 Get specific sheet:');
  console.log('```bash');
  console.log(`curl https://api.smartsheet.com/2.0/sheets/${SHEET_ID} \\`);
  console.log(`  -H "Authorization: Bearer ${API_KEY.substring(0, 20)}..."`);
  console.log('```');
  console.log('');
}

async function runTests() {
  try {
    // Test 1: Connection
    const connected = await testConnection();
    if (!connected) {
      console.log('❌ Cannot proceed - Fix API connection first');
      process.exit(1);
    }
    
    // Test 2: List sheets
    const sheets = await listSheets();
    
    // Test 3: Test specific sheet
    const sheet = await testSheetId();
    
    // Test 4: Show CURL commands
    await generateCurlCommands();
    
    // Summary
    console.log('='.repeat(70));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log(`API Connection:     ${connected ? '✅ OK' : '❌ FAILED'}`);
    console.log(`Sheets Found:       ${sheets.length > 0 ? `✅ ${sheets.length} sheet(s)` : '⚠️  None'}`);
    console.log(`Sheet ID Valid:     ${sheet ? '✅ OK' : '❌ INVALID'}`);
    console.log('');
    
    if (sheet) {
      console.log('🎉 SUCCESS! Your Sheet ID is valid and accessible.');
      console.log('');
      console.log('✅ You can use this in your .env file:');
      console.log(`   SMARTSHEET_PRIMARY_SHEET_ID=${SHEET_ID}`);
      console.log('');
      console.log('Next steps:');
      console.log('1. Add the Sheet ID to .env file');
      console.log('2. Run: npm run fetch-smartsheet');
      console.log('3. Test the Smartsheet Bot');
    } else {
      console.log('❌ FAILED! Sheet ID is not valid or accessible.');
      console.log('');
      console.log('Please:');
      console.log('1. Check the Sheet ID from the list above');
      console.log('2. Verify sheet is shared with your account');
      console.log('3. Update SMARTSHEET_PRIMARY_SHEET_ID in .env');
    }
    
    console.log('');
    console.log('='.repeat(70));
    console.log('');
    
    process.exit(sheet ? 0 : 1);
    
  } catch (error) {
    console.error('');
    console.error('❌ UNEXPECTED ERROR');
    console.error('='.repeat(70));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(70));
    console.error('');
    process.exit(1);
  }
}

runTests();
