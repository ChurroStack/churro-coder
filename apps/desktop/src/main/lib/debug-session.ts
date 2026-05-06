let enabled = false;

export function setDebugSession(value: boolean): void {
  enabled = value;
}

export function isDebugSession(): boolean {
  return enabled;
}
