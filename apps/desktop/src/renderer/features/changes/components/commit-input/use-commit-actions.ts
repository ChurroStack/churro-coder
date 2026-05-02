import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import { trpc } from "../../../../lib/trpc";
import { selectedOllamaModelAtom, showOfflineModeFeaturesAtom } from "../../../../lib/atoms";

interface CommitActionInput {
	title?: string;
	description?: string;
	filePaths?: string[];
}

interface UseCommitActionsOptions {
	worktreePath?: string | null;
	chatId?: string;
	onRefresh?: () => void;
	onCommitSuccess?: () => void;
	onMessageGenerated?: (msg: { title: string; description: string }) => void;
}

export function useCommitActions({
	worktreePath,
	chatId,
	onRefresh,
	onCommitSuccess,
	onMessageGenerated,
}: UseCommitActionsOptions) {
	const [isGenerating, setIsGenerating] = useState(false);
	const queryClient = useQueryClient();
	const selectedOllamaModel = useAtomValue(selectedOllamaModelAtom);
	const useOllamaFallback = useAtomValue(showOfflineModeFeaturesAtom);

	const handleSuccess = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: [["changes", "getStatus"]] });
		onRefresh?.();
		onCommitSuccess?.();
	}, [queryClient, onRefresh, onCommitSuccess]);

	const handleError = useCallback((error: { message?: string }) => {
		toast.error(`Commit failed: ${error.message ?? "Unknown error"}`);
	}, []);

	const generateCommitMutation = trpc.chats.generateCommitMessage.useMutation();
	const atomicCommitMutation = trpc.changes.atomicCommit.useMutation();
	const commitMutation = trpc.changes.commit.useMutation();

	const commit = useCallback(
		async ({ title, description, filePaths }: CommitActionInput): Promise<boolean> => {
			if (!worktreePath) {
				toast.error("Worktree path is required");
				return false;
			}

			let commitTitle = title?.trim() ?? "";
			let commitDescription = description?.trim() ?? "";

			const needsTitle = !commitTitle && !!chatId;
			const needsDescription = !commitDescription && !!chatId;

			if ((needsTitle || needsDescription) && chatId) {
				console.log("[CommitActions] Generating with AI — needsTitle:", needsTitle, "needsDescription:", needsDescription);
				setIsGenerating(true);
				try {
					const result = await generateCommitMutation.mutateAsync({
						chatId,
						filePaths,
						ollamaModel: selectedOllamaModel,
						existingTitle: needsTitle ? undefined : commitTitle,
						useOllamaFallback,
					});
					console.log("[CommitActions] AI generated:", result.title, "provider:", result.provider);

					if (needsTitle) {
						commitTitle = result.title;
						commitDescription = result.description;
					} else {
						// Only description was missing — keep user's title
						commitDescription = result.description;
					}
					onMessageGenerated?.({ title: commitTitle, description: commitDescription });
				} catch (error) {
					console.error("[CommitActions] Failed to generate message:", error);
					toast.error("Failed to generate commit message");
					return false;
				} finally {
					setIsGenerating(false);
				}
			}

			if (!commitTitle) {
				toast.error("Please enter a commit message");
				return false;
			}

			const commitMessage = commitDescription
				? `${commitTitle}\n\n${commitDescription}`
				: commitTitle;

			try {
				if (filePaths && filePaths.length > 0) {
					await atomicCommitMutation.mutateAsync({ worktreePath, filePaths, message: commitMessage });
				} else {
					await commitMutation.mutateAsync({ worktreePath, message: commitMessage });
				}
				handleSuccess();
				return true;
			} catch (error) {
				handleError(error as { message?: string });
				return false;
			}
		},
		[
			worktreePath,
			chatId,
			generateCommitMutation,
			selectedOllamaModel,
			useOllamaFallback,
			onMessageGenerated,
			atomicCommitMutation,
			commitMutation,
			handleSuccess,
			handleError,
		],
	);

	const isPending = isGenerating || atomicCommitMutation.isPending || commitMutation.isPending;

	return { commit, isPending, isGenerating };
}
