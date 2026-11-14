export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export const TOKEN_KEY = 'daybook.accessToken';
export const REFRESH_TOKEN_KEY = 'daybook.refreshToken';
export const ACTIVE_ORG_KEY = 'daybook.activeOrgId';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getActiveOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_ORG_KEY);
}

export function setActiveOrgId(organizationId: string | null): void {
  if (organizationId) {
    window.localStorage.setItem(ACTIVE_ORG_KEY, organizationId);
  } else {
    window.localStorage.removeItem(ACTIVE_ORG_KEY);
  }
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(ACTIVE_ORG_KEY);
}

export function saveSession(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function authHeaders(organizationId?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (organizationId) headers['X-Organization-Id'] = organizationId;
  return headers;
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

export interface ActiveOrganization {
  organizationId: string;
  organizationName: string;
  role: string;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

export async function fetchActiveOrganization(
  organizationId: string,
): Promise<ActiveOrganization> {
  const res = await fetch(`${API_URL}/organizations/active`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Organization not accessible');
  return res.json();
}

export async function fetchMembers(organizationId: string): Promise<Member[]> {
  const res = await fetch(`${API_URL}/memberships`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Members not available');
  const body = (await res.json()) as { memberships: Member[] };
  return body.memberships;
}
