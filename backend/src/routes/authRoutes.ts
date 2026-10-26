import { Router } from 'express';
import { login, getMe, seedDefaultUsers } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/login', login);
router.get('/me', authenticate, getMe);
router.post('/seed', seedDefaultUsers);

export default router;

