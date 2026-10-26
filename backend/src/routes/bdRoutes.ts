import { Router } from 'express';
import { getBDs, createBD, deleteBD } from '../controllers/bdController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, getBDs);
router.post('/', authenticate, createBD);
router.delete('/:id', authenticate, deleteBD);

export default router;
