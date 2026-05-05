import React, { useState, useCallback } from 'react';
import { cn } from '../../../lib/utils';
import { GitHubLogo } from '../../../components/ui/icons';

const GitHubAvatar = React.memo(function GitHubAvatar({
  gitOwner,
  className = 'h-4 w-4'
}: {
  gitOwner: string;
  className?: string;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleLoad = useCallback(() => setIsLoaded(true), []);
  const handleError = useCallback(() => setHasError(true), []);

  if (hasError) {
    return <GitHubLogo className={cn(className, 'text-muted-foreground flex-shrink-0')} />;
  }

  return (
    <div className={cn(className, 'relative flex-shrink-0')}>
      {!isLoaded && <div className="absolute inset-0 rounded-sm bg-muted" />}
      <img
        src={`https://github.com/${gitOwner}.png?size=64`}
        alt={gitOwner}
        className={cn(className, 'rounded-sm flex-shrink-0', isLoaded ? 'opacity-100' : 'opacity-0')}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  );
});

export const WorkspaceIcon = React.memo(function WorkspaceIcon({
  gitOwner,
  gitProvider,
  className = 'h-4 w-4'
}: {
  gitOwner?: string | null;
  gitProvider?: string | null;
  className?: string;
}) {
  if (gitOwner && gitProvider === 'github') {
    return <GitHubAvatar gitOwner={gitOwner} className={className} />;
  }
  return <GitHubLogo className={cn(className, 'flex-shrink-0 text-muted-foreground')} />;
});
