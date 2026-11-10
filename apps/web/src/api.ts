export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new RequestError(503, 'The service is temporarily unavailable. Please try again.');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(contentType))
    throw new RequestError(
      response.ok ? 502 : response.status,
      'The service is temporarily unavailable. Please try again.',
    );
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(502, 'The service returned an invalid response. Please try again.');
  }
  if (!response.ok)
    throw new RequestError(
      response.status,
      typeof data?.error === 'string' ? data.error : 'Request failed.',
    );
  return data as T;
}
export type Organization = {
  id: string;
  slug: string;
  pageSlug?: string;
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
  settings?: import('./MeetingControls').MeetingSettings;
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
    'name' | 'slug' | 'pageSlug' | 'color' | 'secondaryColor' | 'accentColor' | 'logoDataUrl'
  >;
};
export const meetingLink = (org: { slug: string }, meeting: { code: string }) =>
  `${window.location.origin}/o/${org.slug}/meet/${meeting.code}`;
export const dateLabel = (date: string, zone: string, language?: string) =>
  new Intl.DateTimeFormat(
    (language ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'en')) === 'ar'
      ? 'ar-AE'
      : 'en',
    {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
      timeZoneName: 'short',
    },
  ).format(new Date(date));
