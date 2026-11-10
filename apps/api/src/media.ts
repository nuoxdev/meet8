import { turnIceServers } from './turn.js';
import { AccessToken, RoomServiceClient, ServerError, TrackSource } from 'livekit-server-sdk';
import type { Config } from './config.js';
export type MediaPermissions = {
  microphone: boolean;
  camera: boolean;
  screenShare: boolean;
  data: boolean;
};
export const publishSources = (p: MediaPermissions) => [
  ...(p.microphone ? [TrackSource.MICROPHONE] : []),
  ...(p.camera ? [TrackSource.CAMERA] : []),
  ...(p.screenShare ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : []),
];
export interface Media {
  updatePermissions?(room: string, identity: string, permissions: MediaPermissions): Promise<void>;
  mute?(room: string, identity: string): Promise<void>;
  ready: boolean;
  cloud: boolean;
  token(
    room: string,
    identity: string,
    name: string,
    permissions?: MediaPermissions,
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
    async token(
      room,
      identity,
      name,
      permissions = { microphone: true, camera: true, screenShare: true, data: true },
    ) {
      if (!ready) throw new Error('Media service is not configured.');
      const access = new AccessToken(c.livekitKey, c.livekitSecret, { identity, name, ttl: '60s' });
      access.addGrant({
        room,
        roomJoin: true,
        canPublish: publishSources(permissions).length > 0,
        canPublishSources: publishSources(permissions),
        canSubscribe: true,
        canPublishData: permissions.data,
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
    async updatePermissions(room, identity, permissions) {
      if (!service) throw new Error('Media service is not configured.');
      try {
        await service.updateParticipant(room, identity, {
          permission: {
            canPublish: publishSources(permissions).length > 0,
            canPublishSources: publishSources(permissions),
            canSubscribe: true,
            canPublishData: permissions.data,
            canUpdateMetadata: false,
          },
        });
      } catch (error) {
        if (!(error instanceof ServerError && error.code === 'not_found')) throw error;
      }
    },
    async mute(room, identity) {
      if (!service) throw new Error('Media service is not configured.');
      try {
        const p = await service.getParticipant(room, identity);
        for (const track of p.tracks.filter((t) => t.source === TrackSource.MICROPHONE))
          await service.mutePublishedTrack(room, identity, track.sid, true);
      } catch (error) {
        if (!(error instanceof ServerError && error.code === 'not_found')) throw error;
      }
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
