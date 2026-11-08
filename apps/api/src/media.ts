import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import type { Config } from './config.js';
export interface Media {
  ready: boolean;
  cloud: boolean;
  token(room: string, identity: string, name: string): Promise<{ url: string; token: string }>;
  end(room: string): Promise<void>;
  remove(room: string, identity: string): Promise<void>;
}
export function createMedia(c: Config): Media {
  const ready = Boolean(c.livekitUrl && c.livekitKey && c.livekitSecret);
  const service = ready
    ? new RoomServiceClient(c.livekitUrl!.replace(/^ws/, 'http'), c.livekitKey, c.livekitSecret)
    : null;
  return {
    ready,
    cloud: c.livekitCloud ?? false,
    async token(room, identity, name) {
      if (!ready) throw new Error('Media service is not configured.');
      const access = new AccessToken(c.livekitKey, c.livekitSecret, { identity, name, ttl: '60s' });
      access.addGrant({
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: false,
      });
      return { url: c.livekitUrl!, token: await access.toJwt() };
    },
    async end(room) {
      await service?.deleteRoom(room);
    },
    async remove(room, identity) {
      await service?.removeParticipant(room, identity);
    },
  };
}
