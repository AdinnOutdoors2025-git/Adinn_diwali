import { Router } from 'express';
import {
  getClients,
  createClient,
  updateClient,
  deleteClient,
  bulkImportClients,
  downloadSampleTemplate,
} from '../controllers/clientController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Sample template can be public or authenticated
router.get('/sample-template', downloadSampleTemplate);

// Protected routes
router.use(authenticate);
router.get('/', getClients);
router.post('/', createClient);
router.put('/:id', updateClient);
router.delete('/:id', deleteClient);
router.post('/bulk-import', bulkImportClients);

export default router;

