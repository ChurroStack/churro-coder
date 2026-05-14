/**
 * Re-exports the shared repo-name rules so renderer callers keep their import
 * path stable. The canonical implementation lives in shared/repo-name-rules.ts
 * and is also consumed by the main-process new-project router.
 */
export type { NameValidationResult } from '../../../../shared/repo-name-rules';
export { validateRepoNameRules as validateRepoName } from '../../../../shared/repo-name-rules';
