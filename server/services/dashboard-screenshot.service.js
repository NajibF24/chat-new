// server/services/dashboard-screenshot.service.js - FIXED VERSION
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DashboardScreenshotService {
  constructor() {
    this.screenshotDir = path.join(__dirname, '..', 'data', 'screenshots');
    this.cacheMaxAge = 15 * 60 * 1000; // 15 minutes cache
    
    // Dashboard mapping untuk setiap project
    this.dashboardMap = {
      'iot calipers': {
        url: 'https://app.smartsheet.com/b/publish?EQBCT=37169955fa384f98a293eca519a53185',
        name: 'IoT Calipers Dashboard',
        projectName: 'IoT Calipers with Wireless Data Receiver'
      }
      // Tambahkan dashboard lain di sini
    };
  }

  async ensureScreenshotDir() {
    try {
      await fs.mkdir(this.screenshotDir, { recursive: true });
    } catch (error) {
      console.error('Error creating screenshot directory:', error);
    }
  }

  /**
   * Find dashboard URL by project name (fuzzy matching)
   */
  findDashboardByProject(projectName) {
    const lowerName = projectName.toLowerCase();
    
    for (const [key, dashboard] of Object.entries(this.dashboardMap)) {
      if (lowerName.includes(key) || key.includes(lowerName)) {
        return dashboard;
      }
    }
    
    return null;
  }

  /**
   * Get screenshot filename for a dashboard
   */
  getScreenshotFilename(dashboardKey) {
    return `dashboard-${dashboardKey.replace(/\s+/g, '-')}-${Date.now()}.png`;
  }

  /**
   * Get cached screenshot path
   */
  async getCachedScreenshot(dashboardKey) {
    try {
      const files = await fs.readdir(this.screenshotDir);
      const pattern = `dashboard-${dashboardKey.replace(/\s+/g, '-')}`;
      
      // Find most recent screenshot
      const screenshots = files
        .filter(f => f.startsWith(pattern) && f.endsWith('.png'))
        .map(f => ({
          name: f,
          path: path.join(this.screenshotDir, f),
          time: parseInt(f.split('-').pop().replace('.png', ''))
        }))
        .sort((a, b) => b.time - a.time);

      if (screenshots.length === 0) return null;

      const latest = screenshots[0];
      const age = Date.now() - latest.time;

      // Return if cache is fresh
      if (age < this.cacheMaxAge) {
        console.log(`✅ Using cached screenshot (age: ${Math.floor(age / 1000)}s)`);
        return latest.path;
      }

      // Clean old screenshots
      for (const old of screenshots) {
        await fs.unlink(old.path).catch(() => {});
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * ✅ FIXED: Capture screenshot using Puppeteer with proper config
   */
  async captureScreenshotWithPuppeteer(dashboardUrl, outputPath) {
    try {
      console.log('📸 Launching Puppeteer...');
      
      // Dynamic import for Puppeteer
      const puppeteer = await import('puppeteer');
      
      const browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        timeout: 60000 // 60 seconds
      });

      const page = await browser.newPage();
      
      // Set viewport
      await page.setViewport({ 
        width: 1920, 
        height: 1080,
        deviceScaleFactor: 1
      });

      // Set user agent (important for Smartsheet)
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      console.log('🌐 Loading dashboard...');
      console.log(`   URL: ${dashboardUrl}`);
      
      // Navigate with extended timeout and wait for network idle
      await page.goto(dashboardUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000 // 60 seconds
      });

      // Wait extra time for dashboard to fully render
      console.log('⏳ Waiting for dashboard to render...');
      await page.waitForTimeout(8000); // 8 seconds

      console.log('📸 Taking screenshot...');
      await this.ensureScreenshotDir();
      
      await page.screenshot({
        path: outputPath,
        fullPage: true,
        type: 'png'
      });

      await browser.close();
      
      console.log('✅ Screenshot saved successfully');
      console.log(`   Path: ${outputPath}`);
      
      return outputPath;
    } catch (error) {
      console.error('❌ Puppeteer screenshot failed:', error.message);
      throw error;
    }
  }

  /**
   * Get dashboard screenshot (cached or new)
   */
  async getDashboardScreenshot(projectName, forceRefresh = false) {
    try {
      const dashboard = this.findDashboardByProject(projectName);
      
      if (!dashboard) {
        return {
          success: false,
          error: 'Dashboard not found for this project',
          message: 'Dashboard URL belum dikonfigurasi untuk project ini.'
        };
      }

      const dashboardKey = Object.keys(this.dashboardMap)
        .find(key => this.dashboardMap[key] === dashboard);

      // Check cache
      if (!forceRefresh) {
        const cached = await this.getCachedScreenshot(dashboardKey);
        if (cached) {
          return {
            success: true,
            path: cached,
            dashboardName: dashboard.name,
            projectName: dashboard.projectName,
            cached: true
          };
        }
      }

      // Capture new screenshot with Puppeteer
      const filename = this.getScreenshotFilename(dashboardKey);
      const outputPath = path.join(this.screenshotDir, filename);

      console.log('');
      console.log('='.repeat(70));
      console.log('📸 DASHBOARD SCREENSHOT CAPTURE');
      console.log('='.repeat(70));
      console.log(`Project: ${dashboard.projectName}`);
      console.log(`Dashboard: ${dashboard.name}`);
      console.log(`URL: ${dashboard.url}`);
      console.log(`Output: ${outputPath}`);
      console.log('='.repeat(70));
      console.log('');

      const screenshotPath = await this.captureScreenshotWithPuppeteer(
        dashboard.url, 
        outputPath
      );

      console.log('');
      console.log('✅ SCREENSHOT CAPTURE SUCCESS');
      console.log('='.repeat(70));
      console.log('');

      return {
        success: true,
        path: screenshotPath,
        dashboardName: dashboard.name,
        projectName: dashboard.projectName,
        cached: false
      };
    } catch (error) {
      console.error('');
      console.error('❌ SCREENSHOT CAPTURE FAILED');
      console.error('='.repeat(70));
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);
      console.error('='.repeat(70));
      console.error('');
      
      return {
        success: false,
        error: error.message,
        message: 'Gagal mengambil screenshot dashboard. Pastikan URL dashboard valid dan accessible.'
      };
    }
  }

  /**
   * Get dashboard info text (for AI context)
   */
  getDashboardInfo(projectName) {
    const dashboard = this.findDashboardByProject(projectName);
    
    if (!dashboard) {
      return null;
    }

    return {
      name: dashboard.name,
      url: dashboard.url,
      projectName: dashboard.projectName,
      sections: [
        'Project Objective',
        'Task by Status',
        'Project Milestone',
        'Picture Update',
        'Progress Chart',
        'Timeline View'
      ]
    };
  }

  /**
   * List all available dashboards
   */
  listDashboards() {
    return Object.entries(this.dashboardMap).map(([key, dashboard]) => ({
      key,
      name: dashboard.name,
      projectName: dashboard.projectName,
      url: dashboard.url
    }));
  }

  /**
   * Add new dashboard mapping
   */
  addDashboard(key, url, name, projectName) {
    this.dashboardMap[key] = {
      url,
      name,
      projectName
    };
  }
}

export default DashboardScreenshotService;
