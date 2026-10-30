import { Router } from 'express';
import {
  getDistributionRecords,
  getDistributionAnalytics,
  createDistribution,
  updateDeliveryStatus,
  getDeliveryProof,
  getDeliveryProofUrl,
  revertDistribution,
} from '../controllers/distributionController.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { uploadProof } from '../middleware/proofUpload.js';

const router = Router();

router.use(authenticate);
router.get('/', getDistributionRecords);
router.get('/analytics', getDistributionAnalytics);
router.post('/', createDistribution);
router.patch('/:id/status', authorizeRole('STAFF', 'CMD'), uploadProof, updateDeliveryStatus);
router.get('/:id/proof', authorizeRole('STAFF', 'CMD'), getDeliveryProof);
router.get('/:id/proof-url', authorizeRole('STAFF', 'CMD'), getDeliveryProofUrl);
router.post('/:id/revert', authorizeRole('STAFF', 'CMD'), revertDistribution);

export default router;
