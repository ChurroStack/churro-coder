'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { sendUserFeedback, isOptedOut } from '../../lib/analytics';
import { useAtom } from 'jotai';
import { feedbackDialogOpenAtom } from '../../lib/atoms';
import { toast } from 'sonner';

export function FeedbackDialog() {
  const [open, setOpen] = useAtom(feedbackDialogOpenAtom);
  const [message, setMessage] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [sending, setSending] = useState(false);

  const analyticsDisabled = isOptedOut();

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    setSending(true);
    try {
      sendUserFeedback(trimmed, includeContext);
      toast.success('Feedback sent — thank you!');
      setMessage('');
      setOpen(false);
    } catch {
      toast.error('Failed to send feedback. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setMessage('');
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {analyticsDisabled && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
              Crash reporting is disabled. Enable it in Preferences → Share crash reports to send feedback with
              diagnostic context.
            </p>
          )}

          <Textarea
            placeholder="Describe the issue or what you'd like to see improved…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-[120px] resize-none"
            disabled={analyticsDisabled}
          />

          {!analyticsDisabled && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-context"
                checked={includeContext}
                onCheckedChange={(checked) => setIncludeContext(checked === true)}
              />
              <Label htmlFor="include-context" className="text-xs text-muted-foreground cursor-pointer">
                Include diagnostic context (recent app events, no code or message content)
              </Label>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            We never collect code, prompts, or messages. Only what you type above is sent.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!message.trim() || sending || analyticsDisabled}>
            {sending ? 'Sending…' : 'Send feedback'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
