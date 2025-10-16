require('dotenv').config();
const { initializeDatabase } = require('./migrate');

// Run migration
initializeDatabase()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
