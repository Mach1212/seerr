import ServarrBase from '@server/api/servarr/base';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import {
  arrReleaseGrabRequest,
  type ArrRelease,
  type ArrReleasesResponse,
} from '@server/interfaces/api/releaseInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import axios from 'axios';
import { Router } from 'express';
import { z } from 'zod';

const mediaReleaseRoutes = Router();

const releaseSearchQuery = z.object({
  seasonNumber: z.coerce.number().int().nonnegative().optional(),
});

interface RouteError {
  status: number;
  message: string;
}

type ArrMedia = { serviceName: string; externalServiceId: number } & (
  | { service: 'radarr'; api: RadarrAPI }
  | { service: 'sonarr'; api: SonarrAPI }
);

async function findArrMedia(
  mediaId: number,
  is4k: boolean
): Promise<ArrMedia | RouteError> {
  const media = await getRepository(Media).findOne({ where: { id: mediaId } });
  if (!media) {
    return { status: 404, message: 'Media does not exist.' };
  }

  const isMovie = media.mediaType === MediaType.MOVIE;
  const arrName = `${is4k ? '4K ' : ''}${isMovie ? 'Radarr' : 'Sonarr'}`;
  const serviceId = is4k ? media.serviceId4k : media.serviceId;
  const externalServiceId = is4k
    ? media.externalServiceId4k
    : media.externalServiceId;
  if (serviceId == null || externalServiceId == null) {
    return { status: 404, message: `This title is not in ${arrName} yet.` };
  }

  const { radarr, sonarr } = getSettings();
  const server = (isMovie ? radarr : sonarr).find(
    (arr) => arr.id === serviceId
  );
  if (!server) {
    return {
      status: 409,
      message: `The ${arrName} server that has this title is not configured.`,
    };
  }

  const options = {
    apiKey: server.apiKey,
    url: ServarrBase.buildUrl(server, '/api/v3'),
  };
  const shared = { serviceName: server.name, externalServiceId };
  return isMovie
    ? { ...shared, service: 'radarr', api: new RadarrAPI(options) }
    : { ...shared, service: 'sonarr', api: new SonarrAPI(options) };
}

function arrErrorMessage(e: unknown): string {
  if (axios.isAxiosError<{ message?: string }>(e)) {
    return e.response?.data?.message ?? e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

mediaReleaseRoutes.get<{ id: string }, ArrReleasesResponse>(
  '/:id/releases',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const query = releaseSearchQuery.safeParse(req.query);
    if (!query.success) {
      return next({ status: 400, message: z.prettifyError(query.error) });
    }

    const arr = await findArrMedia(
      Number(req.params.id),
      String(req.query.is4k) === 'true'
    );
    if ('status' in arr) {
      return next(arr);
    }

    let results: ArrRelease[];
    try {
      switch (arr.service) {
        case 'radarr':
          results = await arr.api.getReleases(arr.externalServiceId);
          break;
        case 'sonarr':
          if (query.data.seasonNumber === undefined) {
            return next({
              status: 400,
              message: 'Searching a show needs a season number.',
            });
          }
          results = await arr.api.getReleases(
            arr.externalServiceId,
            query.data.seasonNumber
          );
          break;
      }
    } catch (e) {
      const message = arrErrorMessage(e);
      logger.error('Release search failed', {
        label: 'Media',
        mediaId: req.params.id,
        errorMessage: message,
      });
      return next({
        status: 500,
        message: `${arr.serviceName} could not search for releases: ${message}`,
      });
    }

    return res.status(200).json({
      service: arr.service,
      serviceName: arr.serviceName,
      results,
    });
  }
);

mediaReleaseRoutes.post<{ id: string }>(
  '/:id/releases/grab',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const pick = arrReleaseGrabRequest.safeParse(req.body);
    if (!pick.success) {
      return next({ status: 400, message: z.prettifyError(pick.error) });
    }
    const { guid, indexerId, is4k } = pick.data;

    const arr = await findArrMedia(Number(req.params.id), is4k);
    if ('status' in arr) {
      return next(arr);
    }

    try {
      await arr.api.grabRelease({ guid, indexerId });
    } catch (e) {
      const message = arrErrorMessage(e);
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        return next({ status: 404, message });
      }
      logger.error('Release grab failed', {
        label: 'Media',
        mediaId: req.params.id,
        guid,
        errorMessage: message,
      });
      return next({
        status: 500,
        message: `${arr.serviceName} could not grab the release: ${message}`,
      });
    }

    logger.info('Release grabbed', {
      label: 'Media',
      mediaId: req.params.id,
      guid,
      userId: req.user?.id,
    });
    return res.status(204).send();
  }
);

export default mediaReleaseRoutes;
