import { Loader2 } from 'lucide-react';
import { ChatMarkdownRenderer } from '../../components/chat-markdown-renderer';
import { trpc } from '../../lib/trpc';
import type { ChangeFileKind } from '../../../main/lib/openspec/types';

interface OpenSpecDocumentProps {
  chatId: string;
  changeId: string;
  kind: ChangeFileKind;
}

export function OpenSpecDocument({ chatId, changeId, kind }: OpenSpecDocumentProps) {
  const { data, isLoading, error } = trpc.openspec.readChangeFile.useQuery(
    { chatId, changeId, kind },
    { staleTime: 30_000 }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading {kind}.md…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center text-sm text-destructive">
        Failed to load {kind}.md: {error.message}
      </div>
    );
  }

  if (!data) {
    return <div className="py-20 text-center text-sm text-muted-foreground">{kind}.md not found in this change.</div>;
  }

  return (
    <div className="prose-container">
      <ChatMarkdownRenderer content={data.content} size="lg" />
    </div>
  );
}
