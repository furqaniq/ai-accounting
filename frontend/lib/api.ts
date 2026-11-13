export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export const TOKEN_KEY = 'daybook.accessToken';
export const REFRESH_TOKEN_KEY = 'daybook.refreshToken';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function saveSession(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  memberships: Membership[];
}
