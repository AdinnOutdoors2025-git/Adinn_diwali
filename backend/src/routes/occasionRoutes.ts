import { Router } from 'express';
import { getOccasions, createOccasion } from '../controllers/occasionController.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);
router.get('/', getOccasions);
router.post('/', authorizeRole('STAFF', 'CMD'), createOccasion);

export default router;
