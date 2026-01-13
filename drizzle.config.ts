import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    // @ts-ignore
    url: process.env.DB_FILE_NAME || 'file:./data/credentials.db',
  },
} satisfies Config;
