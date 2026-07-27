import { Router } from 'express';
import { connectionsValidationMiddleware } from './shared/context';
import statusRoutes from './statusRoutes';
import dashboardRoutes from './dashboardRoutes';
import reportRoutes from './reportRoutes';
import integrationRoutes from './integrationRoutes';
import projectsRoutes from './projectsRoutes';
import legacyInputRoutes from './legacyInputRoutes';

/**
 * Composition root for the `/api` surface. Holds no route logic itself -
 * each resource area (status/generate, dashboard, reports, integrations,
 * projects, legacy input) is a self-contained router in this folder that
 * shares common infrastructure through `./shared/context`.
 */
const router = Router();

router.use(connectionsValidationMiddleware);

router.use(statusRoutes);
router.use(dashboardRoutes);
router.use(reportRoutes);
router.use(integrationRoutes);
router.use(projectsRoutes);
router.use(legacyInputRoutes);

export default router;
