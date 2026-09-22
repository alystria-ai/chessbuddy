export function isMauLimitError(message: string): boolean {
  const normalized = message.toLowerCase();
  return /ltm speaker limit/.test(normalized)
    || /resource_exhausted/.test(normalized)
    || /mau limit/.test(normalized)
    || /monthly active user/.test(normalized);
}
