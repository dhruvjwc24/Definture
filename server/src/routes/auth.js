import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { login, signToken, authenticate, sessionPayload, HttpError, hashPassword, invalidateUser } from '../security/auth.js';
import { one, query } from '../db.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts, try again later' } });

r.post('/login', limiter, async (req, res, next) => {
  try {
    const { company, email, password } = req.body || {};
    if (!company || !email || !password) throw new HttpError(400, 'Company code, email and password are required');
    const u = await login(String(company), String(email), String(password), req.ip);
    res.json({ token: signToken(u) });
  } catch (e) { next(e); }
});

r.get('/me', authenticate, async (req, res, next) => {
  try { res.json(await sessionPayload(req.ctx)); } catch (e) { next(e); }
});

r.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { current, next: pw } = req.body || {};
    if (!pw || pw.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
    const row = await one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!(await bcrypt.compare(current || '', row.password_hash))) throw new HttpError(400, 'Current password is incorrect');
    await query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, await hashPassword(pw)]);
    invalidateUser(req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;
