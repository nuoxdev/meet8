import { test, expect, type Page } from '@playwright/test';
test('two browsers exchange camera and microphone media, chat, and end together', async ({
  browser,
}) => {
  test.skip(!process.env.LIVEKIT_URL, 'Run with local or dedicated test LiveKit configuration.');
  test.setTimeout(90000);
  const hostContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  for (const c of [hostContext, guestContext])
    await c.addInitScript(() => {
      const peers: RTCPeerConnection[] = [];
      (window as any).__meet8TestPeers = peers;
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Original {
        constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
          super(...args);
          peers.push(this);
        }
      };
    });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await host.goto('/');
  const challenge = await host.request.post('/api/auth/request', {
    data: { email: 'owner@example.com', name: 'Meeting Host' },
  });
  await host.request.post('/api/auth/verify', {
    data: { email: 'owner@example.com', code: (await challenge.json()).developmentCode },
  });
  const suffix = Date.now();
  const org = await (
    await host.request.post('/api/orgs', {
      data: { name: 'Media Company', slug: `media-${suffix}`, managerEmail: 'owner@example.com' },
    })
  ).json();
  const m = await (
    await host.request.post(`/api/orgs/${org.id}/meetings`, {
      data: {
        title: 'Real media verification',
        description: '',
        scheduledAt: new Date().toISOString(),
        timeZone: 'Asia/Dubai',
        durationMinutes: 30,
        access: 'link',
        invitees: [],
      },
    })
  ).json();
  const path = `/o/${org.slug}/meet/${m.code}`;
  await host.goto(path);
  await host.getByRole('button', { name: 'Join meeting', exact: true }).click();
  await expect(host.getByText('Waiting for the host')).toBeVisible();
  await host.getByRole('button', { name: 'Start meeting', exact: true }).click();
  await guest.goto(path);
  await guest.getByLabel('Your name').fill('Meeting Guest');
  await guest.getByRole('button', { name: 'Join meeting', exact: true }).click();
  for (const p of [host, guest]) {
    await expect(p.locator('.lk-video-conference')).toBeVisible();
    await p.locator('button[data-lk-source="microphone"]').click();
    await p.locator('button[data-lk-source="camera"]').click();
  }
  async function mediaReceived(page: Page) {
    return page.evaluate(async () => {
      const result = { audio: 0, video: 0 };
      for (const peer of (window as any).__meet8TestPeers as RTCPeerConnection[]) {
        const stats = await peer.getStats();
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio')
            result.audio += report.packetsReceived ?? 0;
          if (report.type === 'inbound-rtp' && report.kind === 'video')
            result.video += report.framesDecoded ?? 0;
        });
      }
      return result;
    });
  }
  for (const p of [host, guest]) {
    await expect
      .poll(async () => mediaReceived(p), { timeout: 30000 })
      .toMatchObject({ audio: expect.any(Number), video: expect.any(Number) });
    await expect
      .poll(async () => (await mediaReceived(p)).audio, { timeout: 30000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await mediaReceived(p)).video, { timeout: 30000 })
      .toBeGreaterThan(0);
  }
  if (process.env.MEET8_TEST_EXPECT_RELAY === 'true') {
    const relayPeer = process.env.MEET8_TEST_RELAY_PEER_IP ?? '';
    for (const page of [host, guest])
      await expect
        .poll(
          () =>
            page.evaluate(async (expectedPeer) => {
              const peers = ((window as any).__meet8TestPeers as RTCPeerConnection[]).filter(
                (p) => p.connectionState === 'connected',
              );
              if (!peers.length) return false;
              for (const peer of peers) {
                if (peer.getConfiguration().iceTransportPolicy !== 'relay') return false;
                const reports = await peer.getStats();
                const selected: any[] = [];
                reports.forEach((report) => {
                  if (report.type === 'transport' && report.selectedCandidatePairId) {
                    const pair = reports.get(report.selectedCandidatePairId);
                    const candidate = reports.get(pair?.localCandidateId);
                    if (candidate) selected.push(candidate);
                  }
                });
                if (!selected.length) return false;
                for (const candidate of selected) {
                  // TURN traversing the office VPN can be reported as a peer-reflexive candidate.
                  const vpnRelay =
                    candidate.candidateType === 'prflx' &&
                    expectedPeer &&
                    (candidate.address ?? candidate.ip) === expectedPeer &&
                    /^turns?:/.test(candidate.url ?? '') &&
                    ['udp', 'tcp', 'tls'].includes(candidate.relayProtocol);
                  if (candidate.candidateType !== 'relay' && !vpnRelay) return false;
                }
              }
              return true;
            }, relayPeer),
          { timeout: 15000 },
        )
        .toBe(true);
  }
  await host.getByLabel('Meeting message').fill('A real conversation');
  await host.getByRole('button', { name: 'Send message' }).click();
  await expect(guest.getByText('A real conversation', { exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Raise hand', exact: true }).click();
  await host.getByRole('button', { name: /people$/ }).click();
  await expect(host.getByText('Meeting Guest ✋')).toBeVisible();
  await host.screenshot({ path: 'docs/meeting-room.png', fullPage: true });
  await guest.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Join meeting', exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Join meeting', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
  host.on('dialog', (d) => d.accept());
  await host.getByRole('button', { name: 'End for everyone' }).click();
  await expect(guest.getByText('That’s a wrap.')).toBeVisible({ timeout: 10000 });
  await hostContext.close();
  await guestContext.close();
});
