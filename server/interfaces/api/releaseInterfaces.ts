import { z } from 'zod';

/** One release Radarr's or Sonarr's interactive search found for a title. */
export interface ArrRelease {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  /** Bytes; 0 when the indexer gives no size. */
  size: number;
  ageHours: number;
  /** Radarr's or Sonarr's quality name, e.g. "Remux-2160p" or "WEBDL-1080p". */
  quality: string;
  /** 2160, 1080, 720, ...; 0 when unknown. */
  resolution: number;
  customFormats: string[];
  customFormatScore: number;
  languages: string[];
  /** Radarr or Sonarr would not grab it on its own; it can still be grabbed. */
  rejected: boolean;
  rejections: string[];
  /** Sonarr: one release for the whole season. */
  fullSeason: boolean;
  /** Sonarr: the episodes of a single-episode release; empty for packs and movies. */
  episodeNumbers: number[];
  /** The release's page on the indexer's site, when it gives one. */
  infoUrl?: string;
}

export interface ArrReleasesResponse {
  service: 'radarr' | 'sonarr';
  /** The name of the Radarr or Sonarr server in Seerr's settings. */
  serviceName: string;
  /** Best first, in Radarr's or Sonarr's own order. */
  results: ArrRelease[];
}

export const arrReleaseGrabRequest = z.object({
  guid: z.string().min(1),
  indexerId: z.number().int(),
  is4k: z.boolean().default(false),
});

export type ArrReleaseGrabRequest = z.input<typeof arrReleaseGrabRequest>;
