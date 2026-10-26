import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import { connectDB, isDatabaseConnected } from './config/db.js';
import { requireDatabase } from './middleware/dbReady.js';
import authRoutes from './routes/authRoutes.js';
import bdRoutes from './routes/bdRoutes.js';
import clientRoutes from './routes/clientRoutes.js';
import distributionRoutes from './routes/distributionRoutes.js';
import { seedInitialData } from './utils/seedData.js';
import { ensureDistributionIndexes } from './models/SweetDistribution.js';
import { ensureClientIndexes } from './models/Client.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: [
      'https://adinn-diwali.onrender.com',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      ...(process.env.CORS_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean) ?? []),
    ],
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.status(isDatabaseConnected() ? 200 : 503).json({
    status: isDatabaseConnected() ? 'OK' : 'DATABASE_UNAVAILABLE',
    database: isDatabaseConnected() ? 'connected' : 'disconnected',
    service: 'Diwali Sweet Distribution Management API',
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/api', requireDatabase);
app.use('/api/auth', authRoutes);
app.use('/api/bds', bdRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/distributions', distributionRoutes);

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Start Server
const startServer = async () => {
  try {
    await connectDB();
    await ensureClientIndexes();
    await ensureDistributionIndexes();
    await seedInitialData();

    app.listen(PORT, () => {
      console.log(`[Server] Diwali Sweet Distribution Backend running at http://localhost:${PORT}`);
    });
  } catch (error: any) {
    console.error('[Server] Failed to start application:', error);
    process.exit(1);
  }
};

startServer();

