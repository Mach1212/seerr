import type { ArrRelease } from '@server/interfaces/api/releaseInterfaces';

/** What Seerr reads of a release from Radarr's or Sonarr's interactive search. */
export interface ServarrRelease {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  size: number;
  ageHours: number;
  quality: { quality: { name: string; resolution: number } };
  customFormats: { name: string }[];
  customFormatScore: number;
  languages: { name: string }[];
  rejected: boolean;
  rejections: string[];
  infoUrl?: string | null;
  /** Sonarr only. */
  fullSeason?: boolean;
  /** Sonarr only: the episodes in the release, all of the season's for a pack. */
  mappedEpisodeNumbers?: number[];
}

/** An interactive search asks every indexer, which can take a minute. */
export const RELEASE_REQUEST_TIMEOUT_MS = 120000;

export function toArrRelease(release: ServarrRelease): ArrRelease {
  return {
    guid: release.guid,
    indexerId: release.indexerId,
    indexer: release.indexer,
    title: release.title,
    size: release.size,
    ageHours: release.ageHours,
    quality: release.quality.quality.name,
    resolution: release.quality.quality.resolution,
    customFormats: release.customFormats.map((format) => format.name),
    customFormatScore: release.customFormatScore,
    languages: release.languages.map((language) => language.name),
    rejected: release.rejected,
    rejections: release.rejections,
    fullSeason: release.fullSeason ?? false,
    episodeNumbers: release.fullSeason
      ? []
      : (release.mappedEpisodeNumbers ?? []),
    infoUrl: release.infoUrl ?? undefined,
  };
}
