import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { globalLimiter } from './middleware/rateLimit';
import { authRouter } from './modules/auth/auth.routes';
import { productRouter } from './modules/products/product.routes';

/**
 * Builds the Express application without binding a port, so the integration
 * tests can drive it through supertest while `server.ts` owns the listening
 * socket and process lifecycle.
 */
export function createApp(): Express {
  const app = express();

  // Security headers first, so they are present even on error responses.
  app.use(helmet());
  app.disable('x-powered-by');

  app.use(cors({ origin: env.corsOrigin }));

  // A body-size cap keeps a huge payload from being parsed at all.
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  if (!env.isTest) {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  app.use(globalLimiter);

  /** Unauthenticated liveness probe. Reports the database connection state. */
  app.get('/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({
      success: connected,
      data: {
        status: connected ? 'ok' : 'degraded',
        database: mongoose.STATES[mongoose.connection.readyState],
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  });

  app.use('/auth', authRouter);
  app.use('/products', productRouter);

  // Order matters: unmatched routes first, then the single error renderer.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
