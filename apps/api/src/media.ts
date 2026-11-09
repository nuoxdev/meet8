import { turnIceServers } from './turn.js';
import { AccessToken, RoomServiceClient, ServerError } from 'livekit-server-sdk';
import type { Config } from './config.js';
export interface Media {
  ready: boolean;
  cloud: boolean;
  token(
    room: string,
    identity: string,
    name: string,
  ): Promise<{
    url: string;
    token: string;
    iceServers?: { urls: string[]; username: string; credential: string }[];
    relayOnly?: boolean;
  }>;
  end(room: string): Promise<void>;
  remove(room: string, identity: string): Promise<void>;
}
export function createMedia(c: Config): Media {
  const ready = Boolean(
    (c.livekitGateway ? c.livekitInternalUrl : c.livekitUrl) && c.livekitKey && c.livekitSecret,
  );
  const service = ready
    ? new RoomServiceClient(
        (c.livekitInternalUrl ?? c.livekitUrl)!.replace(/^ws/, 'http'),
        c.livekitKey,
        c.livekitSecret,
      )
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
      const publicUrl = c.livekitGateway
        ? new URL('/media', c.baseUrl).href.replace(/^http/, 'ws')
        : c.livekitUrl!;
      const iceServers = turnIceServers(c, identity);
      return {
        url: publicUrl,
        token: await access.toJwt(),
        ...(iceServers.length ? { iceServers, relayOnly: true } : {}),
      };
    },
    async end(room) {
      try {
        await service?.deleteRoom(room);
      } catch (error) {
        if (!(error instanceof ServerError && error.code === 'not_found')) throw error;
      }
    },
    async remove(room, identity) {
      try {
        await service?.removeParticipant(room, identity);
      } catch (error) {
        if (!(error instanceof ServerError && error.code === 'not_found')) throw error;
      }
    },
  };
}
