import type { ChangedFile, GitChangesStatus } from "../../../shared/changes-types";
import simpleGit from "simple-git";
import { z } from "zod";
import { publicProcedure, router } from "../trpc";
import { assertRegisteredWorktree, secureFs } from "./security";
import { applyNumstatToFiles } from "./utils/apply-numstat";
import {
	parseGitLog,
	parseGitStatus,
	parseNameStatus,
} from "./utils/parse-status";
import { gitCache } from "./cache";

/**
 * True for git errors that mean "this commit/object isn't in this repo"
 * — typically because the selected commit was made on a different
 * worktree/branch and the user has since switched. We treat these as a
 * benign empty-result rather than a hard error: the UI was about to
 * render a stale selection and we just want to show nothing for it.
 *
 * Git's standard "unknown ref" output is along the lines of
 *   fatal: ambiguous argument 'abc': unknown revision or path not in the working tree.
 * — so we require both "ambiguous argument" AND "unknown revision" to
 * co-occur, otherwise legitimate ambiguity errors (a short SHA that
 * matches multiple real commits) would be silently swallowed.
 */
function isUnknownRevisionError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message;
	if (msg.includes("bad object")) return true;
	if (msg.includes("Not a valid object name")) return true;
	if (msg.includes("ambiguous argument") && msg.includes("unknown revision"))
		return true;
	return false;
}

export const createStatusRouter = () => {
	return router({
		getStatus: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					defaultBranch: z.string().optional(),
				}),
			)
			.query(async ({ input }): Promise<GitChangesStatus> => {
				assertRegisteredWorktree(input.worktreePath);

				// Check cache first
				const cached = gitCache.getStatus<GitChangesStatus>(input.worktreePath);
				if (cached) {
					console.log("[getStatus] Cache hit for:", input.worktreePath);
					return cached;
				}

				console.log("[getStatus] Cache miss, fetching:", input.worktreePath);
				const git = simpleGit(input.worktreePath);
				const defaultBranch = input.defaultBranch || "main";

				const status = await git.status();
				const parsed = parseGitStatus(status);

				// Run independent git operations in parallel (VS Code style)
				const [branchComparison, trackingStatus] = await Promise.all([
					getBranchComparison(git, defaultBranch),
					getTrackingBranchStatus(git),
				]);

				// Run numstat operations in parallel
				await Promise.all([
					applyNumstatToFiles(git, parsed.staged, [
						"diff",
						"--cached",
						"--numstat",
					]),
					applyNumstatToFiles(git, parsed.unstaged, ["diff", "--numstat"]),
					applyUntrackedLineCount(input.worktreePath, parsed.untracked),
				]);

				const result: GitChangesStatus = {
					branch: parsed.branch,
					defaultBranch,
					againstBase: branchComparison.againstBase,
					commits: branchComparison.commits,
					staged: parsed.staged,
					unstaged: parsed.unstaged,
					untracked: parsed.untracked,
					ahead: branchComparison.ahead,
					behind: branchComparison.behind,
					pushCount: trackingStatus.pushCount,
					pullCount: trackingStatus.pullCount,
					hasUpstream: trackingStatus.hasUpstream,
					hasRemote: trackingStatus.hasRemote,
				};

				// Store in cache
				gitCache.setStatus(input.worktreePath, result);

				console.log("[getStatus] Cached and returning:", {
					branch: result.branch,
					stagedCount: result.staged.length,
					unstagedCount: result.unstaged.length,
					untrackedCount: result.untracked.length,
					commitsCount: result.commits.length,
				});
				return result;
			}),

		getCommitFiles: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					commitHash: z.string(),
				}),
			)
			.query(async ({ input }): Promise<ChangedFile[]> => {
				console.log("[getCommitFiles] START:", {
					worktreePath: input.worktreePath,
					commitHash: input.commitHash,
				});

				try {
					assertRegisteredWorktree(input.worktreePath);
					console.log("[getCommitFiles] Worktree validated");

					const git = simpleGit(input.worktreePath);

					const nameStatus = await git.raw([
						"diff-tree",
						"--no-commit-id",
						"--name-status",
						"-r",
						input.commitHash,
					]);

					console.log("[getCommitFiles] diff-tree output:", {
						length: nameStatus.length,
						output: nameStatus.substring(0, 500), // First 500 chars
					});

					const files = parseNameStatus(nameStatus);
					console.log("[getCommitFiles] Parsed files:", {
						count: files.length,
						files: files.map((f) => ({ path: f.path, status: f.status })),
					});

					await applyNumstatToFiles(git, files, [
						"diff-tree",
						"--no-commit-id",
						"--numstat",
						"-r",
						input.commitHash,
					]);

					console.log("[getCommitFiles] SUCCESS:", { filesCount: files.length });
					return files;
				} catch (error) {
					// Stale commit hash from a different worktree → treat as empty.
					if (isUnknownRevisionError(error)) {
						console.warn("[getCommitFiles] Unknown revision in this worktree:", {
							worktreePath: input.worktreePath,
							commitHash: input.commitHash,
						});
						return [];
					}
					console.error("[getCommitFiles] ERROR:", {
						error: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
						worktreePath: input.worktreePath,
						commitHash: input.commitHash,
					});
					throw error;
				}
			}),

		/** Check if worktree is registered in database */
		isWorktreeRegistered: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
				}),
			)
			.query(async ({ input }): Promise<boolean> => {
				try {
					assertRegisteredWorktree(input.worktreePath);
					return true;
				} catch (error) {
					return false;
				}
			}),

		/** Get the unified diff for a specific file in a commit */
		getCommitFileDiff: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					commitHash: z.string(),
					filePath: z.string(),
				}),
			)
			.query(async ({ input }): Promise<string> => {
				assertRegisteredWorktree(input.worktreePath);

				const git = simpleGit(input.worktreePath);

				try {
					// Get diff for specific file comparing commit to its parent
					const diff = await git.raw([
						"diff",
						`${input.commitHash}^`,
						input.commitHash,
						"--",
						input.filePath,
					]);

					return diff;
				} catch (error) {
					// Stale commit hash from a different worktree → empty diff.
					if (isUnknownRevisionError(error)) {
						console.warn(
							"[getCommitFileDiff] Unknown revision in this worktree:",
							{ worktreePath: input.worktreePath, commitHash: input.commitHash },
						);
						return "";
					}
					throw error;
				}
			}),
	});
};

interface BranchComparison {
	commits: GitChangesStatus["commits"];
	againstBase: ChangedFile[];
	ahead: number;
	behind: number;
}

async function getBranchComparison(
	git: ReturnType<typeof simpleGit>,
	defaultBranch: string,
): Promise<BranchComparison> {
	let commits: GitChangesStatus["commits"] = [];
	let againstBase: ChangedFile[] = [];
	let ahead = 0;
	let behind = 0;

	try {
		const tracking = await git.raw([
			"rev-list",
			"--left-right",
			"--count",
			`origin/${defaultBranch}...HEAD`,
		]);
		const [behindStr, aheadStr] = tracking.trim().split(/\s+/);
		behind = Number.parseInt(behindStr || "0", 10);
		ahead = Number.parseInt(aheadStr || "0", 10);

		const logOutput = await git.raw([
			"log",
			`origin/${defaultBranch}..HEAD`,
			"--format=%H|%h|%s|%b|%an|%aI",
		]);
		commits = parseGitLog(logOutput);

		if (ahead > 0) {
			const nameStatus = await git.raw([
				"diff",
				"--name-status",
				`origin/${defaultBranch}...HEAD`,
			]);
			againstBase = parseNameStatus(nameStatus);

			await applyNumstatToFiles(git, againstBase, [
				"diff",
				"--numstat",
				`origin/${defaultBranch}...HEAD`,
			]);
		}
	} catch {}

	return { commits, againstBase, ahead, behind };
}

/** Max file size for line counting (1 MiB) - skip larger files to avoid OOM */
const MAX_LINE_COUNT_SIZE = 1 * 1024 * 1024;

async function applyUntrackedLineCount(
	worktreePath: string,
	untracked: ChangedFile[],
): Promise<void> {
	for (const file of untracked) {
		try {
			const stats = await secureFs.stat(worktreePath, file.path);
			if (stats.size > MAX_LINE_COUNT_SIZE) continue;

			const content = await secureFs.readFile(worktreePath, file.path);
			const lineCount = content.split("\n").length;
			file.additions = lineCount;
			file.deletions = 0;
		} catch {
			// Skip files that fail validation or reading
		}
	}
}

interface TrackingStatus {
	pushCount: number;
	pullCount: number;
	hasUpstream: boolean;
	hasRemote: boolean;
}

async function getTrackingBranchStatus(
	git: ReturnType<typeof simpleGit>,
): Promise<TrackingStatus> {
	try {
		// Single git call - rev-list will fail if no upstream exists
		// This is faster than checking upstream first, then counting
		const tracking = await git.raw([
			"rev-list",
			"--left-right",
			"--count",
			"@{upstream}...HEAD",
		]);
		const [pullStr, pushStr] = tracking.trim().split(/\s+/);
		return {
			pushCount: Number.parseInt(pushStr || "0", 10),
			pullCount: Number.parseInt(pullStr || "0", 10),
			hasUpstream: true,
			hasRemote: true, // upstream implies a remote exists
		};
	} catch {
		// No upstream branch configured; check if any remote is present
		let hasRemote = false;
		try {
			const remotes = await git.getRemotes();
			hasRemote = remotes.length > 0;
		} catch {
			// `git remote -v` failed for an unexpected reason (corrupt repo,
			// permission issue, etc.). Defensive fall-through: assume no remote
			// rather than reporting hasRemote=true on stale or partial data.
		}
		return { pushCount: 0, pullCount: 0, hasUpstream: false, hasRemote };
	}
}
