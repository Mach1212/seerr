import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { ServarrRelease } from '@server/api/servarr/release';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { ArrRelease } from '@server/interfaces/api/releaseInterfaces';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import mediaReleaseRoutes from './mediaReleases';

const ARR_API_KEY = 'arr-key';

const searches = new Map<string, ServarrRelease[]>();
const releaseCache = new Set<string>();
const grabbed: string[] = [];
let searchDelayMs = 0;

function searchKey(params: URLSearchParams): string {
  const movieId = params.get('movieId');
  const seriesId = params.get('seriesId');
  const seasonNumber = params.get('seasonNumber');
  if (movieId) {
    return `movie ${movieId}`;
  }
  if (seriesId && seasonNumber) {
    return `series ${seriesId} season ${seasonNumber}`;
  }
  // Radarr and Sonarr answer a release request without a movie, or without a
  // series and a season, with their indexers' RSS feeds.
  return 'rss';
}

const fakeArr = http.createServer(async (req, res) => {
  const reply = (status: number, body: unknown) =>
    res
      .writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(body));
  const url = new URL(req.url ?? '/', 'http://fake-arr');

  if (url.searchParams.get('apikey') !== ARR_API_KEY) {
    return reply(401, { message: 'Unauthorized' });
  }
  if (url.pathname !== '/api/v3/release') {
    return reply(404, { message: 'Not found' });
  }
  if (req.method === 'GET') {
    const releases = searches.get(searchKey(url.searchParams)) ?? [];
    setTimeout(() => reply(200, releases), searchDelayMs);
    return;
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  const { guid }: { guid: string } = JSON.parse(body);
  if (!releaseCache.has(guid)) {
    return reply(404, {
      message: "Couldn't find requested release in cache, try searching again",
    });
  }
  grabbed.push(guid);
  reply(200, { guid });
});

let arrPort: number;
let defaultApiRequestTimeout: number;
let app: Express;

function release(
  guid: string,
  overrides: Partial<ServarrRelease> = {}
): ServarrRelease {
  return {
    guid,
    indexerId: 1,
    indexer: 'barbossa',
    title: `Title.${guid}`,
    size: 2_000_000_000,
    ageHours: 3,
    quality: { quality: { name: 'WEBDL-1080p', resolution: 1080 } },
    customFormats: [],
    customFormatScore: 0,
    languages: [{ name: 'English' }],
    rejected: false,
    rejections: [],
    ...overrides,
  };
}

function arrServer(id: number, name: string, apiKey: string): DVRSettings {
  return {
    id,
    name,
    hostname: '127.0.0.1',
    port: arrPort,
    apiKey,
    useSsl: false,
    baseUrl: '',
    activeProfileId: 1,
    activeProfileName: 'Best',
    activeDirectory: '/mnt/pool',
    tags: [],
    is4k: false,
    isDefault: id === 0,
    syncEnabled: false,
    preventSearch: true,
    tagRequests: false,
    overrideRule: [],
  };
}

function seedMedia(
  mediaType: MediaType,
  serviceId: number,
  externalServiceId: number
): Promise<Media> {
  return getRepository(Media).save(
    new Media({
      mediaType,
      tmdbId: externalServiceId,
      status: MediaStatus.PROCESSING,
      serviceId,
      externalServiceId,
    })
  );
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/media', isAuthenticated(), mediaReleaseRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) {
        return next(err);
      }
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

async function loginAs(email: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email, password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

before(async () => {
  fakeArr.listen(0, '127.0.0.1');
  await once(fakeArr, 'listening');
  const address = fakeArr.address();
  assert.ok(address !== null && typeof address === 'object');
  arrPort = address.port;
  defaultApiRequestTimeout = getSettings().network.apiRequestTimeout;
  app = createApp();
});

after(() => {
  fakeArr.closeAllConnections();
  fakeArr.close();
});

setupTestDb();

beforeEach(() => {
  searches.clear();
  releaseCache.clear();
  grabbed.length = 0;
  searchDelayMs = 0;

  const settings = getSettings();
  settings.network.apiRequestTimeout = defaultApiRequestTimeout;
  settings.radarr = [
    {
      ...arrServer(0, 'Radarr', 'another-key'),
      minimumAvailability: 'released',
    },
    {
      ...arrServer(1, 'Radarr 2', ARR_API_KEY),
      minimumAvailability: 'released',
    },
  ];
  settings.sonarr = [
    {
      ...arrServer(0, 'Sonarr', ARR_API_KEY),
      seriesType: 'standard',
      animeSeriesType: 'anime',
      enableSeasonFolders: true,
      monitorNewItems: 'all',
    },
  ];
});

describe('GET /media/:id/releases', () => {
  it('lists, in its order, what the Radarr server that has the movie finds', async () => {
    const movie = await seedMedia(MediaType.MOVIE, 1, 12);
    searches.set('movie 12', [
      release('remux', {
        title: 'Tron.1982.2160p.BluRay.REMUX.DV-UHDMovies',
        size: 70_000_000_000,
        quality: { quality: { name: 'Remux-2160p', resolution: 2160 } },
        customFormats: [{ name: 'DV' }, { name: 'HDR10' }],
        customFormatScore: 1500,
        languages: [{ name: 'English' }, { name: 'Japanese' }],
        rejected: true,
        rejections: ['Not an upgrade for existing movie file'],
        infoUrl: 'https://uhdmovies.example/tron',
      }),
      release('web'),
    ]);
    const admin = await loginAs('admin@seerr.dev');

    const res = await admin.get(`/media/${movie.id}/releases`);

    assert.deepStrictEqual(res.body, {
      service: 'radarr',
      serviceName: 'Radarr 2',
      results: [
        {
          guid: 'remux',
          indexerId: 1,
          indexer: 'barbossa',
          title: 'Tron.1982.2160p.BluRay.REMUX.DV-UHDMovies',
          size: 70_000_000_000,
          ageHours: 3,
          quality: 'Remux-2160p',
          resolution: 2160,
          customFormats: ['DV', 'HDR10'],
          customFormatScore: 1500,
          languages: ['English', 'Japanese'],
          rejected: true,
          rejections: ['Not an upgrade for existing movie file'],
          fullSeason: false,
          episodeNumbers: [],
          infoUrl: 'https://uhdmovies.example/tron',
        },
        {
          guid: 'web',
          indexerId: 1,
          indexer: 'barbossa',
          title: 'Title.web',
          size: 2_000_000_000,
          ageHours: 3,
          quality: 'WEBDL-1080p',
          resolution: 1080,
          customFormats: [],
          customFormatScore: 0,
          languages: ['English'],
          rejected: false,
          rejections: [],
          fullSeason: false,
          episodeNumbers: [],
        },
      ],
    });
  });

  it('lists what Sonarr finds for the requested season', async () => {
    const show = await seedMedia(MediaType.TV, 0, 9);
    searches.set('series 9 season 1', [
      release('season-1-pack', {
        fullSeason: true,
        mappedEpisodeNumbers: [1, 2, 3],
      }),
    ]);
    searches.set('series 9 season 2', [
      release('season-2-pack', {
        fullSeason: true,
        mappedEpisodeNumbers: [1, 2],
      }),
      release('season-2-episode-2', {
        fullSeason: false,
        mappedEpisodeNumbers: [2],
      }),
    ]);
    const admin = await loginAs('admin@seerr.dev');

    const res = await admin.get(`/media/${show.id}/releases?seasonNumber=2`);

    assert.deepStrictEqual(
      res.body.results.map((r: ArrRelease) => ({
        guid: r.guid,
        fullSeason: r.fullSeason,
        episodeNumbers: r.episodeNumbers,
      })),
      [
        { guid: 'season-2-pack', fullSeason: true, episodeNumbers: [] },
        { guid: 'season-2-episode-2', fullSeason: false, episodeNumbers: [2] },
      ]
    );
  });

  it('refuses to search a show without a season', async () => {
    const show = await seedMedia(MediaType.TV, 0, 9);
    searches.set('rss', [release('rss-item')]);
    const admin = await loginAs('admin@seerr.dev');

    const res = await admin.get(`/media/${show.id}/releases`);

    assert.strictEqual(res.status, 400);
  });

  it('waits for a search that takes longer than the API request timeout', async () => {
    getSettings().network.apiRequestTimeout = 5;
    searchDelayMs = 50;
    const movie = await seedMedia(MediaType.MOVIE, 1, 12);
    searches.set('movie 12', [release('slow')]);
    const admin = await loginAs('admin@seerr.dev');

    const res = await admin.get(`/media/${movie.id}/releases`);

    assert.strictEqual(res.status, 200);
  });
});

describe('POST /media/:id/releases/grab', () => {
  it('grabs the release in the Radarr server that has the movie', async () => {
    const movie = await seedMedia(MediaType.MOVIE, 1, 12);
    releaseCache.add('remux');
    const admin = await loginAs('admin@seerr.dev');

    const res = await admin
      .post(`/media/${movie.id}/releases/grab`)
      .send({ guid: 'remux', indexerId: 1 });

    assert.deepStrictEqual(
      { status: res.status, grabbed },
      { status: 204, grabbed: ['remux'] }
    );
  });

  it('answers 404 when the search the release came from has expired', async () => {
    const movie = await seedMedia(MediaType.MOVIE, 1, 12);
    const admin = await loginAs('admin@seerr.dev');

    const res = await admin
      .post(`/media/${movie.id}/releases/grab`)
      .send({ guid: 'remux', indexerId: 1 });

    assert.strictEqual(res.status, 404);
  });
});

describe('the release routes', () => {
  type Agent = Awaited<ReturnType<typeof loginAs>>;
  const routes = {
    search: (agent: Agent, mediaId: number) =>
      agent.get(`/media/${mediaId}/releases`),
    grab: (agent: Agent, mediaId: number) =>
      agent
        .post(`/media/${mediaId}/releases/grab`)
        .send({ guid: 'remux', indexerId: 1 }),
  };

  for (const [name, send] of Object.entries(routes)) {
    it(`refuse to ${name} for users without the Admin permission`, async () => {
      const movie = await seedMedia(MediaType.MOVIE, 1, 12);
      searches.set('movie 12', [release('remux')]);
      releaseCache.add('remux');
      const user = await loginAs('demo@seerr.dev');

      const res = await send(user, movie.id);

      assert.strictEqual(res.status, 403);
    });
  }
});
