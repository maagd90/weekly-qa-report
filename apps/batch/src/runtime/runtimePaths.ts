import fs from 'fs';
import path from 'path';

/**
 * Absolute directories used by the batch and API applications at runtime.
 *
 * Keeping these paths in one value prevents callers from accidentally mixing
 * input, output, and configuration directories resolved from different roots.
 */
export interface RuntimePaths {
  /** Repository or deployment root from which default directories are derived. */
  rootDir: string;
  /** Directory containing staged spreadsheet and import files. */
  inputDir: string;
  /** Directory containing generated datasets, dashboards, reports, and caches. */
  outputDir: string;
  /** Directory containing runtime and integration configuration. */
  configDir: string;
}

/**
 * Inputs accepted by {@link resolveRuntimePaths}.
 *
 * Explicit directory options have the highest precedence, followed by the
 * supplied environment, then directories derived from the resolved root.
 */
export interface ResolveRuntimePathsOptions {
  /** Explicit runtime root. Overrides `PROJECT_ROOT`. */
  rootDir?: string;
  /** Explicit input directory. Overrides `INPUT_DIR`. */
  inputDir?: string;
  /** Explicit output directory. Overrides `OUTPUT_DIR`. */
  outputDir?: string;
  /** Explicit configuration directory. Overrides `CONFIG_DIR`. */
  configDir?: string;
  /** Environment to inspect. Defaults to `process.env`; injectable for tests. */
  env?: NodeJS.ProcessEnv;
  /** Caller-specific root used only when no explicit or environment root exists. */
  fallbackRoot?: string;
}

/**
 * Converts a configured path into a stable absolute path.
 *
 * Relative paths are resolved from the current process directory, matching
 * Node's normal filesystem behavior while avoiding ambiguous paths in logs.
 *
 * @param value Configured absolute or relative path.
 * @returns A normalized absolute path.
 */
function absolutePath(value: string): string {
  return path.resolve(value);
}

/**
 * Resolves the shared runtime directory set for API and batch processes.
 *
 * Precedence for each path is:
 *
 * 1. An explicit option supplied by the caller.
 * 2. The corresponding environment variable.
 * 3. A conventional directory below the resolved root.
 *
 * The root itself follows explicit `rootDir`, `PROJECT_ROOT`, `fallbackRoot`,
 * and finally the current working directory. Callers whose compiled files sit
 * at different depths should provide their own `fallbackRoot`; this function
 * centralizes policy without guessing from its own module location.
 *
 * @param options Optional explicit paths, environment, and root fallback.
 * @returns One internally consistent set of absolute runtime paths.
 */
export function resolveRuntimePaths(options: ResolveRuntimePathsOptions = {}): RuntimePaths {
  const env = options.env ?? process.env;
  const rootDir = absolutePath(options.rootDir || env.PROJECT_ROOT || options.fallbackRoot || process.cwd());

  return {
    rootDir,
    inputDir: absolutePath(options.inputDir || env.INPUT_DIR || path.join(rootDir, 'input')),
    outputDir: absolutePath(options.outputDir || env.OUTPUT_DIR || path.join(rootDir, 'output')),
    configDir: absolutePath(options.configDir || env.CONFIG_DIR || path.join(rootDir, 'config')),
  };
}

/**
 * Creates every writable runtime directory if it does not already exist.
 *
 * The operation is idempotent. Filesystem failures, such as missing write
 * permissions, are intentionally allowed to propagate so application startup
 * fails with the original actionable error.
 *
 * @param paths Runtime paths returned by {@link resolveRuntimePaths}.
 */
export function ensureRuntimeDirectories(paths: RuntimePaths): void {
  fs.mkdirSync(paths.inputDir, { recursive: true });
  fs.mkdirSync(paths.outputDir, { recursive: true });
  fs.mkdirSync(paths.configDir, { recursive: true });
}
