import { config } from 'dotenv';

config();

const required = {
  port: process.env.PORT ?? '4000',
  mongoUri: process.env.MONGODB_URI ?? '',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
};

const clientOrigins = required.clientOrigin
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = {
  port: Number(required.port),
  mongoUri: required.mongoUri,
  clientOrigins
};
