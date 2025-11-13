import dotenv from 'dotenv';
import SmartsheetJSONService from './services/smartsheet-json.service.js';

dotenv.config();

const SHEET_ID = '7472905240661892';

async function fetchData() {
  try {
    console.log('');
    console.log('='.repeat(70));
    console.log('🚀 SMARTSHEET DATA FETCHER');
    console.log('='.repeat(70));
    console.log('');

    // Check API key
    if (!process.env.SMARTSHEET_API_KEY) {
      console.error('❌ SMARTSHEET_API_KEY not found in .env');
      console.error('');
      console.error('Please add to your .env file:');
      console.error('SMARTSHEET_API_KEY=your_api_key_here');
      process.exit(1);
    }

    console.log('✅ API Key found');
    console.log(`📋 Sheet ID: ${SHEET_ID}`);
    console.log('');

    // Create service
    const service = new SmartsheetJSONService();

    // Fetch and cache data
    const data = await service.fetchAndCacheSheet(SHEET_ID);

    // Display summary
    console.log('');
    console.log('='.repeat(70));
    console.log('📊 DATA SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log(`📋 Sheet Name: ${data.metadata.name}`);
    console.log(`🏢 Owner: ${data.metadata.owner}`);
    console.log(`📅 Last Modified: ${new Date(data.metadata.modifiedAt).toLocaleString('id-ID')}`);
    console.log('');
    console.log(`📊 Total Projects: ${data.statistics.totalProjects}`);
    console.log(`✅ Completion Rate: ${data.statistics.completionRate}`);
    console.log('');

    if (Object.keys(data.statistics.statusSummary).length > 0) {
      console.log('📈 Status Breakdown:');
      Object.entries(data.statistics.statusSummary)
        .sort((a, b) => b[1] - a[1])
        .forEach(([status, count]) => {
          const percentage = ((count / data.statistics.totalProjects) * 100).toFixed(1);
          console.log(`   ${status}: ${count} (${percentage}%)`);
        });
      console.log('');
    }

    console.log(`📋 Total Columns: ${data.columns.length}`);
    console.log('Columns:');
    data.columns.forEach((col, idx) => {
      console.log(`   ${idx + 1}. ${col.title} (${col.type})`);
    });
    console.log('');

    console.log('📝 Sample Projects (first 3):');
    data.projects.slice(0, 3).forEach((project, idx) => {
      console.log('');
      console.log(`   Project ${idx + 1} (Row ${project.rowNumber}):`);
      Object.entries(project.data)
        .filter(([key, val]) => val.value)
        .slice(0, 5)
        .forEach(([colName, cellData]) => {
          let value = cellData.value;
          if (typeof value === 'string' && value.length > 50) {
            value = value.substring(0, 50) + '...';
          }
          console.log(`      ${colName}: ${value}`);
        });
    });
    console.log('');

    console.log('='.repeat(70));
    console.log('✅ SUCCESS!');
    console.log('='.repeat(70));
    console.log('');
    console.log('Data has been saved to: server/data/smartsheet-data.json');
    console.log('');
    console.log('You can now use the Smartsheet Bot to query this data.');
    console.log('The bot will use cached data and auto-refresh every 5 minutes.');
    console.log('');
    console.log('Try asking:');
    console.log('  - "Berapa total project yang ada?"');
    console.log('  - "Tampilkan semua project"');
    console.log('  - "Project mana yang sudah selesai?"');
    console.log('  - "Berapa completion rate?"');
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('');
    console.error('='.repeat(70));
    console.error('❌ FETCH FAILED');
    console.error('='.repeat(70));
    console.error('');
    console.error('Error:', error.message);
    
    if (error.response) {
      console.error('');
      console.error('API Response:');
      console.error('  Status:', error.response.status);
      console.error('  Message:', error.response.data?.message || 'No message');
      
      if (error.response.status === 401) {
        console.error('');
        console.error('🔐 Authentication failed - Check your API key');
      } else if (error.response.status === 404) {
        console.error('');
        console.error('🔍 Sheet not found - Check your Sheet ID');
      } else if (error.response.status === 403) {
        console.error('');
        console.error('🚫 Access denied - You don\'t have permission to this sheet');
      }
    }
    
    console.error('');
    console.error('Stack:', error.stack);
    console.error('');
    console.error('='.repeat(70));
    console.error('');
    
    process.exit(1);
  }
}

fetchData();
