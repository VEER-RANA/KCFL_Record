import { config } from 'dotenv';

config();

const required = {
  port: process.env.PORT ?? '4000',
  mongoUri: process.env.MONGODB_URI ?? '',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
};

export const env = {
  port: Number(required.port),
  mongoUri: required.mongoUri,
  clientOrigin: required.clientOrigin
};
