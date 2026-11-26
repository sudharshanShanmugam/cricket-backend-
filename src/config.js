import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const isProduction = process.env.NODE_ENV === 'production';

function required(name, minLength = 1) {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(`Environment variable ${name} is required (min ${minLength} characters). See .env.example`);
  }
  return value;
}

export function loadConfig() {
  const origins = (process.env.CLIENT_ORIGIN || (isProduction ? '' : '*'))
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (!origins.length) throw new Error('Environment variable CLIENT_ORIGIN is required in production');

  return {
    port: Number(process.env.PORT) || 5080,
    mongoUri: required('MONGODB_URI'),
    adminId: required('ADMIN_ID', 3),
    adminPassword: required('ADMIN_PASSWORD', 8),
    jwtSecret: required('JWT_SECRET', 16),
    tokenTtl: process.env.TOKEN_TTL || '12h',
    corsOrigin: origins.includes('*') ? '*' : origins,
  };
}
