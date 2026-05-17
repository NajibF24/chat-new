import cleanupService from './cleanup.service.js';
import fs from 'fs';
import path from 'path';

describe('CleanupService', () => {
  it('should be defined', () => {
    expect(cleanupService).toBeDefined();
  });

  it('should have 14 days retention', () => {
    expect(cleanupService.retentionDays).toBe(14);
  });
});
