export function isAbortError(e: unknown): boolean {
  const name = (e as any)?.name;
  if (name === "AbortError") return true;
  // Cobertura adicional para navegadores: DOMException AbortError
  try {
    // DOMException nem sempre existe (SSR/Node); por isso o typeof
    if (typeof DOMException !== "undefined") {
      return e instanceof DOMException && (e as any)?.name === "AbortError";
    }
  } catch {}
  return false;
}

export function logAbortDev(scope: string, action: string) {
  if (process.env.NODE_ENV === "development") {
    console.debug(`[${scope}] ${action} abortado`);
  }
}