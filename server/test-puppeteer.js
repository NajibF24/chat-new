// server/test-puppeteer.js - Quick Puppeteer Test
import puppeteer from 'puppeteer';

console.log('');
console.log('='.repeat(70));
console.log('🔍 PUPPETEER TEST');
console.log('='.repeat(70));
console.log('');

async function testPuppeteer() {
  try {
    console.log('1️⃣ Testing Puppeteer availability...');
    console.log('   Puppeteer version:', puppeteer.version || 'unknown');
    console.log('');

    console.log('2️⃣ Testing browser launch...');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      timeout: 30000
    });
    console.log('   ✅ Browser launched successfully');
    console.log('');

    console.log('3️⃣ Testing page creation...');
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    console.log('   ✅ Page created');
    console.log('');

    console.log('4️⃣ Testing navigation (Google)...');
    await page.goto('https://www.google.com', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    console.log('   ✅ Navigation successful');
    console.log('');

    console.log('5️⃣ Testing screenshot...');
    await page.screenshot({
      path: '/tmp/test-screenshot.png',
      type: 'png'
    });
    console.log('   ✅ Screenshot saved to /tmp/test-screenshot.png');
    console.log('');

    await browser.close();
    console.log('6️⃣ Browser closed');
    console.log('');

    console.log('='.repeat(70));
    console.log('✅ ALL TESTS PASSED');
    console.log('='.repeat(70));
    console.log('');
    console.log('Puppeteer is working correctly!');
    console.log('You can now use dashboard screenshot feature.');
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('');
    console.error('='.repeat(70));
    console.error('❌ TEST FAILED');
    console.error('='.repeat(70));
    console.error('Error:', error.message);
    console.error('');
    
    if (error.message.includes('Could not find')) {
      console.error('Issue: Chromium not found');
      console.error('Solution:');
      console.error('  1. Install Chromium: apk add chromium');
      console.error('  2. Set env: PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser');
    } else if (error.message.includes('timeout')) {
      console.error('Issue: Navigation timeout');
      console.error('Solution:');
      console.error('  1. Increase timeout value');
      console.error('  2. Check internet connection');
    }
    
    console.error('');
    console.error('Stack:', error.stack);
    console.error('='.repeat(70));
    console.error('');

    process.exit(1);
  }
}

testPuppeteer();
