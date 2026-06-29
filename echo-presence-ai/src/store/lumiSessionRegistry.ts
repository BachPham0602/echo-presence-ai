let currentApiSessionId = "";

export function setCurrentApiSessionId(sessionId: string): void {
  currentApiSessionId = sessionId;
}

export function getCurrentApiSessionId(): string {
  return currentApiSessionId;
}
