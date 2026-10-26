import { Router } from 'express';
import {
  getDistributionRecords,
  createDistribution,
  revertDistribution,
} from '../controllers/distributionController.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);
router.get('/', getDistributionRecords);
router.post('/', createDistribution);
router.post('/:id/revert', authorizeRole('STAFF', 'CMD'), revertDistribution);

export default router;

