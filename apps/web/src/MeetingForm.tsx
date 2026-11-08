import { useDialog } from './useDialog';
import { useState } from 'react';
import { X, ArrowRight, Link2, LockKeyhole } from 'lucide-react';
import { api, type Organization, type Meeting } from './api';
import { inputToISO, toDateInput } from './time';
export function MeetingForm({
  org,
  meeting,
  onClose,
  onSaved,
}: {
  org: Organization;
  meeting?: Meeting;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialogRef = useDialog(onClose);
  const [access, setAccess] = useState(meeting?.access ?? 'link');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="modal meeting-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-form-title"
      >
        <div className="modal-heading">
          <span className="eyebrow">{org.name.toUpperCase()} / MEET8</span>
          <button
            autoFocus
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </button>
        </div>
        <h2 id="meeting-form-title">
          {meeting ? 'Fine-tune the details.' : 'Put a conversation on the calendar.'}
        </h2>
        <p>A link to your company’s space. Ready whenever you are.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const f = new FormData(e.currentTarget);
              const scheduledAt = inputToISO(
                String(f.get('scheduledAt')),
                String(f.get('timeZone')),
              );
              const body = {
                title: f.get('title'),
                description: f.get('description'),
                scheduledAt,
                durationMinutes: Number(f.get('duration')),
                timeZone: f.get('timeZone'),
                access,
                invitees: String(f.get('invitees') ?? '')
                  .split(/[,;\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              };
              await api(
                `/orgs/${org.id}/meetings${meeting ? `/${meeting.id}` : ''}`,
                meeting ? 'PATCH' : 'POST',
                body,
              );
              await onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Meeting title
            <input
              required
              name="title"
              maxLength={160}
              defaultValue={meeting?.title}
              placeholder="Let’s talk about what’s next"
            />
          </label>
          <div className="form-grid">
            <label>
              Date and time
              <input
                required
                type="datetime-local"
                name="scheduledAt"
                defaultValue={toDateInput(
                  meeting?.scheduledAt ?? new Date(Date.now() + 3600000).toISOString(),
                  meeting?.timeZone ?? org.timeZone,
                )}
              />
            </label>
            <label>
              Duration
              <select name="duration" defaultValue={meeting?.durationMinutes ?? 30}>
                {[15, 30, 45, 60, 90, 120, 180, 240, 480].map((n) => (
                  <option key={n} value={n}>
                    {n} minutes
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Time zone
            <input
              required
              name="timeZone"
              defaultValue={meeting?.timeZone ?? org.timeZone}
              placeholder="Asia/Dubai"
            />
            <small>The selected date and time use this time zone.</small>
          </label>
          <fieldset className="access-options">
            <legend>Who can join?</legend>
            <label className={access === 'link' ? 'access-option checked' : 'access-option'}>
              <input
                type="radio"
                name="access"
                value="link"
                checked={access === 'link'}
                onChange={() => setAccess('link')}
              />
              <Link2 size={18} />
              <span>
                <strong>Anyone with the link</strong>
                <small>Clients can join with just their name.</small>
              </span>
            </label>
            <label className={access === 'invited' ? 'access-option checked' : 'access-option'}>
              <input
                type="radio"
                name="access"
                value="invited"
                checked={access === 'invited'}
                onChange={() => setAccess('invited')}
              />
              <LockKeyhole size={18} />
              <span>
                <strong>Invited email addresses only</strong>
                <small>Each guest verifies their email before joining.</small>
              </span>
            </label>
          </fieldset>
          <label>
            Invite email addresses
            <textarea
              name="invitees"
              required={access === 'invited'}
              defaultValue={meeting?.invitees.join(', ')}
              placeholder="alex@client.com, sam@company.com"
              rows={2}
            />
            <small>Separate addresses with commas. Send invitations from the meeting page.</small>
          </label>
          <label>
            Meeting notes <span className="optional">optional</span>
            <textarea
              name="description"
              maxLength={2000}
              defaultValue={meeting?.description ?? ''}
              placeholder="What would you like to discuss?"
              rows={2}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="secondary" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : meeting ? 'Save changes' : 'Create meeting'}
              <ArrowRight size={17} />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
