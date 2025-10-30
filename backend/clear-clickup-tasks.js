const { Pool } = require('pg');
require('dotenv').config();

async function clearTasks() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await pool.query(
      'UPDATE routers SET clickup_task_id = NULL, clickup_task_url = NULL, clickup_list_id = NULL'
    );
    console.log('✅ Cleared all ClickUp task associations from database');
  } finally {
    await pool.end();
  }
}

clearTasks().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
