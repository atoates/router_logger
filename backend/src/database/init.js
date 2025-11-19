require('dotenv').config();
const { initializeDatabase } = require('./migrate');
const { logger } = require('../config/database');

// Run migration
initializeDatabase()
  .then(() => {
    logger.info('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Migration failed:', error);
    process.exit(1);
  });
