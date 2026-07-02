/**
 * Load repo-root .env before any other module reads process.env.
 * Shared implementation: scripts/loadRepoEnv.cjs (Mac + Windows + Linux).
 */
import path from 'path';

require(path.join(__dirname, '../../../scripts/loadRepoEnv.cjs'));
