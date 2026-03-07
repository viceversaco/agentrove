const RESOLVED_REQUESTS_KEY = 'agentrove_resolved_permission_requests';
const MAX_RESOLVED_REQUESTS = 100;

export function getResolvedRequestIds(): Set<string> {
  try {
    const stored = localStorage.getItem(RESOLVED_REQUESTS_KEY);
    return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function addResolvedRequestId(requestId: string): void {
  try {
    const resolved = getResolvedRequestIds();
    resolved.add(requestId);
    const arr = Array.from(resolved);
    if (arr.length > MAX_RESOLVED_REQUESTS) {
      arr.splice(0, arr.length - MAX_RESOLVED_REQUESTS);
    }
    localStorage.setItem(RESOLVED_REQUESTS_KEY, JSON.stringify(arr));
  } catch {
    // Ignore localStorage errors
  }
}

export function isRequestResolved(requestId: string): boolean {
  return getResolvedRequestIds().has(requestId);
}
