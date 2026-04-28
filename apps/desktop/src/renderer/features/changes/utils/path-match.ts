/**
 * True if two repo-relative paths refer to the same file. Tolerates a
 * leading prefix on either side (e.g. worktree-absolute vs repo-relative)
 * by requiring a `/` boundary — so "auth.ts" doesn't accidentally match
 * "oauth.ts", and "lib/foo.ts" doesn't match "mylib/foo.ts".
 */
export function matchesFilePath(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	if (a.endsWith(`/${b}`)) return true;
	if (b.endsWith(`/${a}`)) return true;
	return false;
}
