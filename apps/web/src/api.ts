export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(response.status, data.error ?? 'Request failed.');
  return data as T;
}
export type Organization = {
  id: string;
  slug: string;
  name: string;
  role: 'owner' | 'manager' | 'member';
  color: string;
  secondaryColor?: string;
  accentColor?: string;
  logoDataUrl: string;
  timeZone: string;
};
export type Identity = {
  user: { id: string; name: string; email: string };
  platformAdmin: boolean;
  organizations: Organization[];
};
export type Meeting = {
  id: string;
  orgId: string;
  code: string;
  title: string;
  description: string;
  scheduledAt: string;
  durationMinutes: number;
  timeZone: string;
  access: 'link' | 'invited';
  invitees: string[];
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  canHost: boolean;
};
export type Preview = {
  code: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  timeZone: string;
  access: 'link' | 'invited';
  status: Meeting['status'];
  organization: Pick<
    Organization,
    'name' | 'slug' | 'color' | 'secondaryColor' | 'accentColor' | 'logoDataUrl'
  >;
};
export const meetingLink = (org: { slug: string }, meeting: { code: string }) =>
  `${window.location.origin}/o/${org.slug}/meet/${meeting.code}`;
export const dateLabel = (date: string, zone: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short',
  }).format(new Date(date));
