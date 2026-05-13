export interface NameValidationResult {
  valid: boolean;
  error?: string;
}

const RESERVED = new Set(['.git', 'con', 'prn', 'aux', 'nul', 'com0', 'com1', 'lpt0', 'lpt1']);

export function validateRepoName(name: string, provider: 'github' | 'azure' | 'local'): NameValidationResult {
  if (!name) return { valid: false, error: 'Name is required' };
  if (name.length > 100) return { valid: false, error: 'Name must be 100 characters or fewer' };

  if (provider === 'github') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      return { valid: false, error: 'Only letters, numbers, hyphens, underscores, and dots are allowed' };
    }
    if (/\.\./.test(name)) return { valid: false, error: 'Name cannot contain consecutive dots' };
    if (name === '.' || name === '..') return { valid: false, error: 'Invalid name' };
  } else if (provider === 'azure') {
    if (/[/\\:*?"<>|]/.test(name)) return { valid: false, error: 'Name contains invalid characters' };
  }

  if (RESERVED.has(name.toLowerCase())) return { valid: false, error: 'That name is reserved' };

  return { valid: true };
}
