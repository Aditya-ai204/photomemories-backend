import fs from 'node:fs';
import path from 'node:path';
import { pool } from './index';
import { logger } from '../utils/logger';

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info('Initializing migration tracker table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      logger.warn(`Migrations directory not found at ${migrationsDir}`);
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const { rows: appliedRows } = await client.query<{ migration_name: string }>(
      'SELECT migration_name FROM schema_migrations'
    );
    const appliedSet = new Set(appliedRows.map((r) => r.migration_name));

    for (const file of files) {
      if (!appliedSet.has(file)) {
        logger.info(`Applying migration: ${file}...`);
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
            [file]
          );
          await client.query('COMMIT');
          logger.info(`Migration applied successfully: ${file}`);
        } catch (error) {
          await client.query('ROLLBACK');
          logger.error(`Migration failed: ${file}`, error);
          throw error;
        }
      } else {
        logger.debug(`Migration already applied: ${file}`);
      }
    }

    logger.info('All database migrations up to date.');
  } finally {
    client.release();
  }
}

// Allow CLI execution: tsx src/database/migrator.ts
if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migration run completed.');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Migration run fatal error', err);
      process.exit(1);
    });
}
