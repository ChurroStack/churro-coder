export function stringifyForError(value: unknown): string {
  if (typeof value === 'string') return value;

  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === 'bigint') return currentValue.toString();
      if (currentValue && typeof currentValue === 'object') {
        if (seen.has(currentValue)) return '[Circular]';
        seen.add(currentValue);
      }
      return currentValue;
    });
    if (typeof json === 'string') return json;
  } catch {
    // Fall through to String(value) below.
  }

  return String(value);
}
