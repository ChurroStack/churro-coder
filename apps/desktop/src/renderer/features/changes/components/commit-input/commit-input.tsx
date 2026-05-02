import { Button } from "../../../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { useState } from "react";
import { cn } from "../../../../lib/utils";
import { IconSpinner } from "../../../../components/ui/icons";
import { useCommitActions } from "./use-commit-actions";

interface CommitInputProps {
	worktreePath: string;
	hasStagedChanges: boolean;
	onRefresh: () => void;
	/** Called after a successful commit to reset UI state */
	onCommitSuccess?: () => void;
	stagedCount?: number;
	currentBranch?: string;
	/** File paths selected for commit - will be staged before committing */
	selectedFilePaths?: string[];
	/** Chat ID for AI-generated commit messages */
	chatId?: string;
}

export function CommitInput({
	worktreePath,
	hasStagedChanges,
	onRefresh,
	onCommitSuccess,
	stagedCount,
	currentBranch,
	selectedFilePaths,
	chatId,
}: CommitInputProps) {
	const [summary, setSummary] = useState("");
	const [description, setDescription] = useState("");
	const { commit, isPending, isGenerating } = useCommitActions({
		worktreePath,
		chatId,
		onRefresh,
		onCommitSuccess: () => {
			setSummary("");
			setDescription("");
			onCommitSuccess?.();
		},
		onMessageGenerated: ({ title, description: desc }) => {
			setSummary(title);
			setDescription(desc);
		},
	});

	const canCommit = hasStagedChanges;

	const handleCommit = async () => {
		if (!canCommit) return;
		await commit({ title: summary, description, filePaths: selectedFilePaths });
	};

	// Build dynamic commit label
	const getCommitLabel = () => {
		if (stagedCount && stagedCount > 0 && currentBranch) {
			return `Commit ${stagedCount} to ${currentBranch}`;
		}
		if (currentBranch) {
			return `Commit to ${currentBranch}`;
		}
		return "Commit";
	};

	const getTooltip = () => {
		if (!hasStagedChanges) return "No staged changes";
		if (!summary.trim()) return "AI will generate title and description";
		if (!description.trim()) return "AI will generate description";
		return "Commit staged changes";
	};

	return (
		<div className="flex flex-col gap-2 p-2 border-t border-border/50 bg-background">
			{/* Summary input - single line */}
			<input
				type="text"
				placeholder="Commit message"
				value={summary}
				onChange={(e) => setSummary(e.target.value)}
				className={cn(
					"w-full px-2 py-1.5 text-xs rounded-md",
					"bg-background border border-input",
					"placeholder:text-muted-foreground",
					"focus:outline-none focus:ring-1 focus:ring-ring"
				)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canCommit) {
						e.preventDefault();
						handleCommit();
					}
				}}
			/>

			{/* Description textarea - multiline */}
			<textarea
				placeholder="Description"
				value={description}
				onChange={(e) => setDescription(e.target.value)}
				className={cn(
					"w-full px-2 py-1.5 text-xs rounded-md resize-none",
					"bg-background border border-input",
					"placeholder:text-muted-foreground",
					"focus:outline-none focus:ring-1 focus:ring-ring",
					"min-h-[60px]"
				)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canCommit) {
						e.preventDefault();
						handleCommit();
					}
				}}
			/>

			{/* Commit button - simple, no dropdown */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="default"
						size="sm"
						className="w-full h-7 text-xs overflow-hidden"
						onClick={handleCommit}
						disabled={!canCommit || isPending}
					>
						{isPending ? (
							<>
								<IconSpinner className="h-3 w-3 mr-1.5 animate-spin" />
								<span className="truncate">{isGenerating ? "Generating..." : "Committing..."}</span>
							</>
						) : (
							<span className="truncate">{getCommitLabel()}</span>
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">{getTooltip()}</TooltipContent>
			</Tooltip>
		</div>
	);
}
