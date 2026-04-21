import mongoose from 'mongoose';
import { env } from './config/env.js';

export async function connectDatabase() {
  if (!env.mongoUri) {
    throw new Error('MONGODB_URI is required: game data persistence and TTL cleanup depend on MongoDB.');
  }

  await mongoose.connect(env.mongoUri);
}
