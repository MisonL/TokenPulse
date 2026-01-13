import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { db } from '../db';
import { logSystem } from './logger';

async function main() {
    try {
        console.log("Running migrations...");
        await migrate(db, { migrationsFolder: './drizzle' });
        console.log("Migrations complete.");
        logSystem('INFO', 'System', 'Database migrations applied successfully.');
    } catch (e: any) {
        console.error("Migration failed:", e);
        logSystem('ERROR', 'System', `Database migration failed: ${e.message}`);
        process.exit(1);
    }
}

main();
