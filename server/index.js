import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './auth.js';
import { apiRouter } from './tesla-api.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.TESLA_ALLOWED_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// Token storage (in-memory for dev — use a DB in production)
const tokenStore = new Map();

app.use((req, _res, next) => {
  req.tokenStore = tokenStore;
  next();
});

app.use('/auth', authRouter);
app.use('/api', apiRouter);

app.listen(PORT, () => {
  console.log(`QuagoEV server running on http://localhost:${PORT}`);
});
