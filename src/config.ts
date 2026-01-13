import path from 'path';

const isDev = process.env.NODE_ENV !== 'production';

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || '3000'}`,
  dbFileName: process.env.DB_FILE_NAME || path.join('data', 'credentials.db'),
  apiSecret: process.env.API_SECRET || (isDev ? 'default-insecure-secret-change-me' : ''),
  gemini: {
    clientSecret: process.env.GEMINI_CLIENT_SECRET || '',
  },
  antigravity: {
    clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET || '',
  },
  proxy: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '',
};

// Runtime Validation
if (!isDev) {
    if (!config.apiSecret) throw new Error("API_SECRET is required in production");
}
