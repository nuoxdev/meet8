import { useState } from 'react';
import { api } from './api';
import { useLanguage } from './i18n';
export type MeetingSettings = {
  microphoneAccess: 'everyone' | 'hosts';
  cameraAccess: 'everyone' | 'hosts';
  screenShareAccess: 'everyone' | 'hosts';
  chatEnabled: boolean;
  locked: boolean;
};
export const defaultMeetingSettings: MeetingSettings = {
  microphoneAccess: 'everyone',
  cameraAccess: 'everyone',
  screenShareAccess: 'everyone',
  chatEnabled: true,
  locked: false,
};
export function MeetingPolicyFields({
  value,
  onChange,
  disabled = false,
}: {
  value: MeetingSettings;
  onChange: (next: MeetingSettings) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <fieldset className="meeting-policy-fields" disabled={disabled}>
      <legend>{t('Workshop permissions')}</legend>
      <p>
        {t('Hosts and co-hosts retain access. Attendees choose when to enable their own devices.')}
      </p>
      {(
        [
          ['microphoneAccess', 'Microphone access'],
          ['cameraAccess', 'Camera access'],
          ['screenShareAccess', 'Screen sharing access'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {t(label)}
          <select
            aria-label={t(label)}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          >
            <option value="everyone">{t('Everyone')}</option>
            <option value="hosts">{t('Hosts and co-hosts only')}</option>
          </select>
        </label>
      ))}
      <label className="permission-toggle">
        <input
          type="checkbox"
          checked={value.chatEnabled}
          onChange={(e) => onChange({ ...value, chatEnabled: e.target.checked })}
        />
        {t('Allow attendee chat')}
      </label>
      <label className="permission-toggle">
        <input
          type="checkbox"
          checked={value.locked}
          onChange={(e) => onChange({ ...value, locked: e.target.checked })}
        />
        {t('Lock meeting to new attendees')}
      </label>
    </fieldset>
  );
}

export function MeetingSettingsEditor({
  code,
  initial,
  ended = false,
}: {
  code: string;
  initial?: MeetingSettings;
  ended?: boolean;
}) {
  const { t } = useLanguage();
  const [settings, setSettings] = useState({ ...defaultMeetingSettings, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  if (ended) return null;
  return (
    <div className="schedule-permissions">
      <MeetingPolicyFields
        value={settings}
        onChange={(next) => {
          setSettings(next);
          setSaved(false);
        }}
        disabled={busy}
      />
      <button
        className="secondary small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api(`/meet/${code}/settings`, 'PATCH', settings);
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('Save workshop permissions')}
      </button>
      {saved && <p role="status">{t('Workshop permissions saved.')}</p>}
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
    </div>
  );
}
