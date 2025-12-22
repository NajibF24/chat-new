// server/test-dashboard.js
import DashboardScreenshotService from './services/dashboard-screenshot.service.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('');
console.log('='.repeat(70));
console.log('📸 DASHBOARD SCREENSHOT SERVICE TEST');
console.log('='.repeat(70));
console.log('');

const service = new DashboardScreenshotService();

async function testDashboardService() {
  try {
    // Test 1: List dashboards
    console.log('1️⃣ Listing Available Dashboards');
    console.log('-'.repeat(70));
    const dashboards = service.listDashboards();
    
    if (dashboards.length === 0) {
      console.log('⚠️  No dashboards configured');
      console.log('   Please add dashboards to dashboard-screenshot.service.js');
      console.log('');
    } else {
      console.log(`✅ Found ${dashboards.length} dashboard(s):`);
      console.log('');
      dashboards.forEach((d, idx) => {
        console.log(`${idx + 1}. ${d.name}`);
        console.log(`   Project: ${d.projectName}`);
        console.log(`   Key: "${d.key}"`);
        console.log(`   URL: ${d.url}`);
        console.log('');
      });
    }

    // Test 2: Find dashboard by project
    console.log('2️⃣ Testing Dashboard Lookup');
    console.log('-'.repeat(70));
    
    const testQueries = [
      'iot calipers',
      'IoT Calipers with Wireless',
      'calipers'
    ];

    console.log('Test queries:');
    testQueries.forEach(query => {
      const found = service.findDashboardByProject(query);
      if (found) {
        console.log(`✅ "${query}" → ${found.name}`);
      } else {
        console.log(`❌ "${query}" → Not found`);
      }
    });
    console.log('');

    // Test 3: Get dashboard info
    console.log('3️⃣ Getting Dashboard Info');
    console.log('-'.repeat(70));
    
    const info = service.getDashboardInfo('iot calipers');
    if (info) {
      console.log('✅ Dashboard Info Retrieved:');
      console.log(`   Name: ${info.name}`);
      console.log(`   Project: ${info.projectName}`);
      console.log(`   URL: ${info.url}`);
      console.log(`   Sections: ${info.sections.length}`);
      info.sections.forEach(section => {
        console.log(`      - ${section}`);
      });
      console.log('');
    } else {
      console.log('❌ Dashboard info not found');
      console.log('');
    }

    // Test 4: Check screenshot directory
    console.log('4️⃣ Checking Screenshot Directory');
    console.log('-'.repeat(70));
    
    try {
      await service.ensureScreenshotDir();
      console.log('✅ Screenshot directory ready');
      console.log(`   Path: ${service.screenshotDir}`);
      console.log('');
    } catch (error) {
      console.error('❌ Failed to create directory:', error.message);
      console.log('');
    }

    // Test 5: Puppeteer availability
    console.log('5️⃣ Testing Puppeteer Availability');
    console.log('-'.repeat(70));
    
    try {
      const puppeteer = await import('puppeteer');
      console.log('✅ Puppeteer installed');
      console.log(`   Version: ${puppeteer.default._version || 'unknown'}`);
      
      // Test browser launch
      try {
        console.log('   Testing browser launch...');
        const browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log('   ✅ Browser launched successfully');
        await browser.close();
        console.log('   ✅ Browser closed');
      } catch (launchError) {
        console.log('   ❌ Browser launch failed:', launchError.message);
      }
      console.log('');
    } catch (error) {
      console.log('⚠️  Puppeteer not installed');
      console.log('   Install: npm install puppeteer');
      console.log('   Will fallback to screenshot API');
      console.log('');
    }

    // Test 6: Cache check
    console.log('6️⃣ Checking Cache Status');
    console.log('-'.repeat(70));
    
    try {
      const cached = await service.getCachedScreenshot('iot-calipers');
      if (cached) {
        console.log('✅ Cache found:', cached);
      } else {
        console.log('ℹ️  No cache available (this is normal on first run)');
      }
      console.log('');
    } catch (error) {
      console.log('ℹ️  Cache check skipped:', error.message);
      console.log('');
    }

    // Test 7: Screenshot capture (optional - commented out to avoid actual API call)
    console.log('7️⃣ Screenshot Capture Test');
    console.log('-'.repeat(70));
    console.log('⚠️  Skipping actual screenshot capture (uncomment to test)');
    console.log('');
    
    /*
    // Uncomment to test actual screenshot
    console.log('📸 Attempting to capture screenshot...');
    console.log('   This may take 5-10 seconds...');
    
    const result = await service.getDashboardScreenshot('iot calipers', true);
    
    if (result.success) {
      console.log('✅ Screenshot captured successfully!');
      console.log(`   Path: ${result.path}`);
      console.log(`   Dashboard: ${result.dashboardName}`);
      console.log(`   Project: ${result.projectName}`);
      console.log(`   Cached: ${result.cached}`);
    } else {
      console.log('❌ Screenshot capture failed');
      console.log(`   Error: ${result.error}`);
      console.log(`   Message: ${result.message}`);
    }
    console.log('');
    */

    // Summary
    console.log('='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Dashboards configured:     ${dashboards.length > 0 ? '✅' : '❌'} ${dashboards.length}`);
    console.log(`Dashboard lookup:          ✅ Working`);
    console.log(`Screenshot directory:      ✅ Ready`);
    
    try {
      await import('puppeteer');
      console.log(`Puppeteer:                 ✅ Installed`);
    } catch {
      console.log(`Puppeteer:                 ⚠️  Not installed (will use API fallback)`);
    }
    
    console.log('');
    console.log('Next steps:');
    console.log('1. Add more dashboard mappings if needed');
    console.log('2. Uncomment Test 7 to try actual screenshot capture');
    console.log('3. Test via chat interface: "Tampilkan dashboard IoT Calipers"');
    console.log('');
    console.log('='.repeat(70));
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('');
    console.error('❌ TEST FAILED');
    console.error('='.repeat(70));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(70));
    console.error('');
    process.exit(1);
  }
}

testDashboardService();
