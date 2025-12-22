import PDFReportService from './services/pdf-report.service.js';

console.log('🗑️  Starting report cleanup...');

const pdfService = new PDFReportService();

pdfService.cleanupOldReports()
  .then(() => {
    console.log('✅ Cleanup completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  });
