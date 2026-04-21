import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes/index.js';
import { env } from './config/env.js';

export function createApp() {
  const app = express();

  const isLocalDevOrigin = (origin: string | undefined) => {
    if (!origin) {
      return true;
    }

    try {
      const url = new URL(origin);
      return url.port === '5173';
    } catch {
      return false;
    }
  };

  // Dynamic CORS configuration to allow both localhost and IP addresses
  const corsOptions = {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      // If CLIENT_ORIGIN env var is set, use it strictly
      if (env.clientOrigin && env.clientOrigin !== 'http://localhost:5173') {
        if (origin === env.clientOrigin) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      } else {
        // In development, allow any Vite dev server origin on port 5173
        if (isLocalDevOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    },
    credentials: true
  };

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(morgan('dev'));
  app.use('/api', routes);

  app.use((_request, response) => {
    response.status(404).json({ message: 'Route not found' });
  });

  return app;
}

