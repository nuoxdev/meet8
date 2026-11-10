import {
  SignalResponse,
  LeaveRequest,
  LeaveRequest_Action,
  DisconnectReason,
} from '@livekit/protocol';
import type { WebSocketRoute } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
test('two browsers exchange camera and microphone media, chat, and end together', async ({
  browser,
}) => {
  test.skip(!process.env.LIVEKIT_URL, 'Run with local or dedicated test LiveKit configuration.');
  test.skip(
    process.env.MEET8_TEST_GATEWAY_RECOVERY === 'true' &&
      process.env.LIVEKIT_MODE !== 'self-hosted-gateway',
    'Gateway recovery requires a dedicated local gateway SFU.',
  );
  test.setTimeout(process.env.MEET8_TEST_RECORDING === 'true' ? 240000 : 180000);
  const hostContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  for (const c of [hostContext, guestContext])
    await c.addInitScript(() => {
      const sockets: WebSocket[] = [];
      (window as any).__meet8TestSockets = sockets;
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(...args: ConstructorParameters<typeof WebSocket>) {
          super(...args);
          if (new URL(String(args[0]), location.href).pathname.match(/\/rtc(?:\/v1)?$/))
            sockets.push(this);
        }
      };
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
  let guestSignaling: WebSocketRoute | undefined;
  await guestContext.routeWebSocket(/\/media\/rtc(?:\/v1)?(?:\?|$)/, (socket) => {
    guestSignaling = socket;
    socket.connectToServer();
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
  let recordingId = '';
  if (process.env.MEET8_TEST_RECORDING === 'true') {
    await host.getByRole('button', { name: 'Recordings', exact: true }).click();
    await host.getByRole('button', { name: 'Start recording', exact: true }).click();
    await expect
      .poll(
        async () => {
          const result = await (await host.request.get(`/api/meet/${m.code}/recordings`)).json();
          recordingId = result.recordings[0]?.id ?? '';
          return result.recordings[0]?.status;
        },
        { timeout: 45000 },
      )
      .toBe('recording');
    await expect(guest.getByText('Recording in progress', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Close panel', exact: true }).click();
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
  async function inboundReports(page: Page) {
    return page.evaluate(async () => {
      const reports: { id: string; kind: string; count: number }[] = [];
      for (const [index, peer] of (
        (window as any).__meet8TestPeers as RTCPeerConnection[]
      ).entries()) {
        (await peer.getStats()).forEach((report) => {
          if (report.type === 'inbound-rtp' && ['audio', 'video'].includes(report.kind))
            reports.push({
              id: `${index}:${report.id}`,
              kind: report.kind,
              count:
                report.kind === 'audio'
                  ? (report.packetsReceived ?? 0)
                  : (report.framesDecoded ?? 0),
            });
        });
      }
      return reports;
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
  // Changing capture preferences must not replace the joined Room on the next session poll.
  const guestMembershipCalls: string[] = [];
  let guestConnectionRequests = 0;
  guest.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/connection'))
      guestConnectionRequests++;
    if (request.method() === 'POST' && /\/(join|leave)$/.test(new URL(request.url()).pathname))
      guestMembershipCalls.push(request.url());
  });
  const beforeNoise = await mediaReceived(host);
  await guest.getByRole('button', { name: 'Call settings', exact: true }).click();
  await guest.getByRole('button', { name: /Background noise cancellation/ }).click();
  await guest.getByRole('button', { name: 'Close call settings', exact: true }).click();
  await guest.waitForTimeout(6000); // Cross two authoritative 2.5-second session polls.
  await expect(guest.locator('.lk-video-conference')).toBeVisible();
  await expect
    .poll(async () => (await mediaReceived(host)).audio)
    .toBeGreaterThan(beforeNoise.audio);
  await expect
    .poll(async () => (await mediaReceived(host)).video)
    .toBeGreaterThan(beforeNoise.video);
  expect(guestMembershipCalls).toEqual([]);
  if (process.env.MEET8_TEST_GATEWAY_RECOVERY === 'true') {
    // Cross the initial 60-second JWT expiry, then interrupt only signaling.
    // Native SDK resume must preserve the joined Room and published media.
    await guest.waitForTimeout(65000);
    const beforeDrop = await Promise.all([mediaReceived(host), mediaReceived(guest)]);
    await guest.evaluate(() => {
      const sockets = (window as any).__meet8TestSockets as WebSocket[];
      const active = sockets.filter((socket) => socket.readyState === WebSocket.OPEN);
      if (!active.length) throw new Error('No active signaling socket to interrupt');
      for (const socket of active) socket.close(4000, 'Local regression signaling interruption');
    });
    for (const [index, p] of [host, guest].entries()) {
      await expect(p.locator('.lk-video-conference')).toBeVisible();
      await expect
        .poll(async () => (await mediaReceived(p)).audio, { timeout: 30000 })
        .toBeGreaterThan(beforeDrop[index].audio);
      await expect
        .poll(async () => (await mediaReceived(p)).video, { timeout: 30000 })
        .toBeGreaterThan(beforeDrop[index].video);
      await expect(p.getByRole('button', { name: 'Microphone', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(p.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
    await expect
      .poll(
        () =>
          guest.evaluate(
            () =>
              ((window as any).__meet8TestSockets as WebSocket[]).filter(
                (s) => s.readyState === WebSocket.OPEN,
              ).length,
          ),
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    expect(guestMembershipCalls).toEqual([]);
    if (process.env.LIVEKIT_MODE === 'self-hosted-gateway') {
      // Deliver an actual SFU protocol terminal network failure through the real
      // SDK, then require fresh-token recovery and real outgoing media restoration.
      if (!guestSignaling) throw new Error('Missing guest signaling route');
      const beforeTerminalRequests = guestConnectionRequests;
      const beforeTerminalReports = new Set(
        (await inboundReports(host)).map((report) => report.id),
      );
      guestSignaling.send(
        Buffer.from(
          new SignalResponse({
            message: {
              case: 'leave',
              value: new LeaveRequest({
                action: LeaveRequest_Action.DISCONNECT,
                reason: DisconnectReason.SIGNAL_CLOSE,
              }),
            },
          }).toBinary(),
        ),
      );
      await expect(guest.getByText('Reconnecting to the meeting…', { exact: false })).toBeVisible();
      await expect(guest.getByRole('button', { name: 'Microphone', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 20000 },
      );
      await expect(guest.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 20000 },
      );
      await expect.poll(() => guestConnectionRequests).toBe(beforeTerminalRequests + 1);
      // Identify newly subscribed RTP streams before sampling: old stream stats
      // may remain briefly after republishing, and new tracks reset counters.
      for (const kind of ['audio', 'video']) {
        await expect
          .poll(
            async () =>
              (await inboundReports(host)).some(
                (report) =>
                  report.kind === kind && !beforeTerminalReports.has(report.id) && report.count > 0,
              ),
            { timeout: 30000 },
          )
          .toBe(true);
        const fresh = (await inboundReports(host)).find(
          (report) =>
            report.kind === kind && !beforeTerminalReports.has(report.id) && report.count > 0,
        )!;
        await expect
          .poll(
            async () =>
              (await inboundReports(host)).find((report) => report.id === fresh.id)?.count ?? 0,
            { timeout: 30000 },
          )
          .toBeGreaterThan(fresh.count);
      }
      expect(guestMembershipCalls).toEqual([]);
    }
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
  for (const p of [host, guest]) await p.getByRole('button', { name: 'Chat', exact: true }).click();
  await host.getByLabel('Meeting message').fill('A real conversation');
  await host.getByRole('button', { name: 'Send message' }).click();
  await expect(guest.getByText('A real conversation', { exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Raise hand', exact: true }).click();
  await host.getByRole('button', { name: /people$/ }).click();
  await expect(host.getByText('Meeting Guest ✋')).toBeVisible();
  await host.getByRole('button', { name: 'Mute Meeting Guest', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Microphone', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await guest.getByRole('button', { name: 'Microphone', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Microphone', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await guest.getByRole('button', { name: 'Chat', exact: true }).click();
  for (const width of [320, 390, 768, 1280]) {
    await guest.setViewportSize({ width, height: 844 });
    await expect(guest.getByRole('button', { name: 'Microphone', exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Leave', exact: true })).toBeVisible();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const controls = guest.locator('.lk-control-bar');
    const box = await controls.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    const stage = await guest.locator('.room-shell').boundingBox();
    for (const label of ['Microphone', 'Camera', 'Leave']) {
      const button = guest.getByRole('button', { name: label, exact: true });
      const bounds = await button.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(stage!.y);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(stage!.y + stage!.height + 1);
    }
    for (const source of ['microphone', 'camera']) {
      const control = guest.locator(`button[data-lk-source="${source}"]`);
      expect(await control.evaluate((el) => getComputedStyle(el).fontSize)).toBe('0px');
    }
    await guest.screenshot({ path: `.superpowers/live-room-${width}.png` });
  }
  await host.screenshot({ path: '.superpowers/meeting-room-regression.png', fullPage: true });
  if (
    process.env.MEET8_TEST_GATEWAY_RECOVERY === 'true' &&
    process.env.LIVEKIT_MODE === 'self-hosted-gateway'
  ) {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let tokenPending = false;
    let finishRoute!: () => void;
    const routeFinished = new Promise<void>((resolve) => {
      finishRoute = resolve;
    });
    await guest.route(`**/api/meet/${m.code}/connection`, async (route) => {
      tokenPending = true;
      await hold;
      await route.continue();
      finishRoute();
    });
    guestSignaling!.send(
      Buffer.from(
        new SignalResponse({
          message: {
            case: 'leave',
            value: new LeaveRequest({
              action: LeaveRequest_Action.DISCONNECT,
              reason: DisconnectReason.SIGNAL_CLOSE,
            }),
          },
        }).toBinary(),
      ),
    );
    await expect.poll(() => tokenPending).toBe(true);
    await expect(guest.getByRole('button', { name: 'Leave', exact: true })).toBeDisabled();
    await guest.getByRole('button', { name: 'Leave meeting', exact: true }).click();
    release();
    await routeFinished;
    await guest.unroute(`**/api/meet/${m.code}/connection`);
    await expect(guest.getByRole('button', { name: 'Join meeting', exact: true })).toBeVisible();
    await guest.waitForTimeout(2800);
    expect(
      guestMembershipCalls.filter((url) => new URL(url).pathname.endsWith('/leave')),
    ).toHaveLength(1);
  } else {
    await guest.getByRole('button', { name: 'Leave', exact: true }).click();
  }
  await expect(guest.getByRole('button', { name: 'Join meeting', exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Join meeting', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
  // Host controls apply to the SFU and a guest co-host can moderate without organization access.
  await host.getByRole('button', { name: '2 people', exact: true }).click();
  await host.getByRole('button', { name: 'Host controls', exact: true }).click();
  await host.getByLabel('Microphone access', { exact: true }).selectOption('hosts');
  await host.getByLabel('Camera access', { exact: true }).selectOption('hosts');
  await expect(guest.getByRole('button', { name: 'Camera', exact: true })).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Microphone', exact: true })).toHaveCount(0);
  await guest.getByRole('button', { name: 'Raise hand', exact: true }).click();
  await host.getByRole('button', { name: '2 people', exact: true }).click();
  await host.getByRole('button', { name: 'Lower hand for Meeting Guest', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Raise hand', exact: true })).toBeVisible();
  await host.getByRole('button', { name: 'Make co-host', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Host controls', exact: true })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Host controls', exact: true }).click();
  await guest.getByLabel('Allow attendee chat', { exact: true }).uncheck();
  await expect
    .poll(
      async () =>
        (await (await guest.request.get(`/api/meet/${m.code}/session`)).json()).settings
          .chatEnabled,
    )
    .toBe(false);
  await guest.getByRole('button', { name: 'Chat', exact: true }).click();
  const message = (await (await guest.request.get(`/api/meet/${m.code}/chat`)).json())[0];
  guest.once('dialog', (dialog) => dialog.accept());
  await guest
    .getByRole('button', { name: `Delete message from ${message.name}`, exact: true })
    .click();
  await expect
    .poll(async () => (await (await guest.request.get(`/api/meet/${m.code}/chat`)).json()).length)
    .toBe(0);
  await expect(host.getByText('A real conversation', { exact: true })).toHaveCount(0);
  await host.getByRole('button', { name: 'Remove co-host', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Host controls', exact: true })).toHaveCount(0);
  await expect(guest.getByLabel('Meeting message')).toBeDisabled();
  await host.getByRole('button', { name: 'Host controls', exact: true }).click();
  await host.getByLabel('Microphone access', { exact: true }).selectOption('everyone');
  await host.getByLabel('Camera access', { exact: true }).selectOption('everyone');
  await host.getByLabel('Allow attendee chat', { exact: true }).check();
  await expect(guest.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
  if (recordingId) {
    expect(
      (
        await host.request.post(`/api/meet/${m.code}/recordings/${recordingId}/stop`, {
          headers: { origin: new URL(host.url()).origin },
        })
      ).ok(),
    ).toBe(true);
    await expect
      .poll(
        async () =>
          (await (await host.request.get(`/api/meet/${m.code}/recordings`)).json()).recordings.find(
            (r: any) => r.id === recordingId,
          )?.status,
        { timeout: 60000 },
      )
      .toBe('ready');
    const file = await host.request.get(`/api/meet/${m.code}/recordings/${recordingId}/file`);
    expect(file.status()).toBe(200);
    const data = await file.body();
    expect(data.length).toBeGreaterThan(10000);
    expect(data.subarray(4, 8).toString()).toBe('ftyp');
    await writeFile('.superpowers/recording-verification.mp4', data);
    await writeFile(
      '.superpowers/recording-verification.json',
      JSON.stringify({ recordingId, bytes: data.length }),
    );
    const share = await (
      await host.request.post(`/api/meet/${m.code}/recordings/${recordingId}/share`, {
        headers: { origin: new URL(host.url()).origin },
      })
    ).json();
    const anon = await browser.newContext();
    const playback = await anon.newPage();
    await playback.goto(share.url);
    await playback.locator('video').evaluate(async (video: HTMLVideoElement) => {
      video.muted = true;
      await video.play();
    });
    await expect
      .poll(() => playback.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBeGreaterThan(0);
    await host.request.delete(`/api/meet/${m.code}/recordings/${recordingId}/share`, {
      headers: { origin: new URL(host.url()).origin },
    });
    const raw = new URL(share.url).pathname.split('/').pop();
    expect((await playback.request.get(`/api/recordings/shared/${raw}`)).status()).toBe(404);
    await anon.close();
  }
  host.on('dialog', (d) => d.accept());
  await host.getByRole('button', { name: 'End for everyone' }).click();
  await expect(guest.getByText('That’s a wrap.')).toBeVisible({ timeout: 10000 });
  await hostContext.close();
  await guestContext.close();
});
