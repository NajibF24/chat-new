import express from 'express';
import SmartsheetService from '../services/smartsheet.service.js';
import Bot from '../models/Bot.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Get Smartsheet API key for bot
const getSmartsheetApiKey = async (botId) => {
  const bot = await Bot.findById(botId);
  
  if (!bot || !bot.smartsheetEnabled) {
    throw new Error('Smartsheet not enabled for this bot');
  }

  // Use custom API key if provided, otherwise use global
  if (bot.smartsheetConfig?.customApiKey) {
    return bot.smartsheetConfig.customApiKey;
  }

  if (!process.env.SMARTSHEET_API_KEY) {
    throw new Error('Smartsheet API key not configured');
  }

  return process.env.SMARTSHEET_API_KEY;
};

// Test Smartsheet connection
router.get('/test/:botId', requireAuth, async (req, res) => {
  try {
    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const userInfo = await smartsheet.getUserInfo();
    
    res.json({
      success: true,
      message: 'Smartsheet connection successful',
      user: {
        email: userInfo.email,
        firstName: userInfo.firstName,
        lastName: userInfo.lastName
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get all sheets
router.get('/sheets/:botId', requireAuth, async (req, res) => {
  try {
    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const sheets = await smartsheet.listSheets();
    
    res.json({
      success: true,
      total: sheets.length,
      sheets: sheets
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get specific sheet data
router.get('/sheets/:botId/:sheetId', requireAuth, async (req, res) => {
  try {
    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const sheet = await smartsheet.getSheet(req.params.sheetId);
    const formatted = smartsheet.formatSheetForAI(sheet);
    
    res.json({
      success: true,
      sheet: formatted
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get all workspaces
router.get('/workspaces/:botId', requireAuth, async (req, res) => {
  try {
    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const workspaces = await smartsheet.listWorkspaces();
    
    res.json({
      success: true,
      total: workspaces.length,
      workspaces: workspaces
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get all dashboards (sights)
router.get('/dashboards/:botId', requireAuth, async (req, res) => {
  try {
    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const dashboards = await smartsheet.listSights();
    
    res.json({
      success: true,
      total: dashboards.length,
      dashboards: dashboards
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get specific dashboard
router.get('/dashboards/:botId/:dashboardId', requireAuth, async (req, res) => {
  try {
    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const dashboard = await smartsheet.getSight(req.params.dashboardId);
    
    res.json({
      success: true,
      dashboard: dashboard
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Download dashboard as PDF
router.get('/dashboards/:botId/:dashboardId/pdf', requireAuth, async (req, res) => {
  try {
    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const pdfBuffer = await smartsheet.getSightAsPDF(req.params.dashboardId);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dashboard-${req.params.dashboardId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Download sheet as PDF
router.get('/sheets/:botId/:sheetId/pdf', requireAuth, async (req, res) => {
  try {
    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const pdfBuffer = await smartsheet.getSheetAsPDF(req.params.sheetId);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sheet-${req.params.sheetId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get comprehensive summary
router.get('/summary/:botId', requireAuth, async (req, res) => {
  try {
    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const summary = await smartsheet.getComprehensiveSummary();
    
    res.json({
      success: true,
      summary: summary
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Search sheets
router.get('/search/:botId', requireAuth, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const apiKey = await getSmartsheetApiKey(req.params.botId);
    const smartsheet = new SmartsheetService(apiKey);
    
    const results = await smartsheet.searchSheets(query);
    
    res.json({
      success: true,
      query: query,
      total: results.length,
      results: results
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

export default router;
