import { useEffect, useState } from 'react';
import { api } from './api';
import { LanguageSwitcher, useLanguage } from './i18n';
import './recordings.css';
type Recording = {
  id: string;
  createdAt: string;
  status: string;
  shared: boolean;
  shareExpiresAt?: number;
};
export function RecordingsPanel({
  code,
  canManage,
  live,
  canShare = canManage,
}: {
  code: string;
  canManage: boolean;
  live: boolean;
  canShare?: boolean;
}) {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<Recording[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const base = `/meet/${code}/recordings`;
  async function load() {
    try {
      const r = await api<{ enabled: boolean; recordings: Recording[] }>(base);
      setItems(r.recordings);
      setEnabled(r.enabled);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!canManage) return;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [code, canManage]);
  async function action(path: string, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      const result = await api(base + path, method);
      if (result.url) setLinks((v) => ({ ...v, [path.split('/')[1]]: result.url }));
      if (method === 'DELETE')
        setLinks((v) => {
          const next = { ...v };
          delete next[path.split('/')[1]];
          return next;
        });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!canManage) return null;
  const active = items.some((r) => ['starting', 'recording', 'processing'].includes(r.status));
  return (
    <section className="recordings-panel" aria-label={t('Recordings')}>
      <div className="recordings-heading">
        <h3>{t('Recordings')}</h3>
        {live && enabled && (
          <button disabled={busy || active} onClick={() => void action('/start')}>
            {t('Start recording')}
          </button>
        )}
      </div>
      <p className="recording-note">
        {t('Recordings are private. Share a link only when the recording is ready.')}
      </p>
      {!enabled && <p>{t('Recording is not configured on this server.')}</p>}
      {error && <p role="alert">{t(error)}</p>}
      {!items.length && <p>{t('No recordings yet.')}</p>}
      <ul>
        {items.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{new Date(r.createdAt).toLocaleString(language)}</strong>
              <span className={`recording-status recording-${r.status}`}>{t(r.status)}</span>
            </div>
            {['recording', 'processing'].includes(r.status) && (
              <button disabled={busy} onClick={() => void action(`/${r.id}/stop`)}>
                {t('Stop recording')}
              </button>
            )}
            {r.status === 'ready' && (
              <div className="recording-actions">
                <a href={`/api${base}/${r.id}/file`} target="_blank" rel="noreferrer">
                  {t('Watch or download')}
                </a>
                {canShare && (
                  <>
                    <button disabled={busy} onClick={() => void action(`/${r.id}/share`)}>
                      {t(r.shared ? 'Replace share link' : 'Create share link')}
                    </button>
                    {r.shared && (
                      <button
                        disabled={busy}
                        onClick={() => void action(`/${r.id}/share`, 'DELETE')}
                      >
                        {t('Revoke share link')}
                      </button>
                    )}
                  </>
                )}
                {links[r.id] && (
                  <label>
                    {t('Link expires in 7 days')}
                    <input readOnly value={links[r.id]} onFocus={(e) => e.currentTarget.select()} />
                  </label>
                )}
                {r.shared && !links[r.id] && (
                  <small>{t('A share link is active. Replace it to obtain a new link.')}</small>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
export function SharedRecording({ token }: { token: string }) {
  const { t } = useLanguage();
  const [failed, setFailed] = useState(false);
  return (
    <main className="shared-recording">
      <LanguageSwitcher />
      <h1>{t('Meeting recording')}</h1>
      <p>{t('This private link may expire or be revoked by the host.')}</p>
      {failed && <p role="alert">{t('This recording link is unavailable or expired.')}</p>}
      <video
        onError={() => setFailed(true)}
        controls
        preload="metadata"
        src={`/api/recordings/shared/${encodeURIComponent(token)}`}
      />
      <p>
        <a href={`/api/recordings/shared/${encodeURIComponent(token)}`} download>
          {t('Download recording')}
        </a>
      </p>
    </main>
  );
}
