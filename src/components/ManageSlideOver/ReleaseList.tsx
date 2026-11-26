import Spinner from '@app/assets/spinner.svg';
import Button from '@app/components/Common/Button';
import ReleaseCard from '@app/components/ManageSlideOver/ReleaseCard';
import defineMessages from '@app/utils/defineMessages';
import { getApiErrorMessage } from '@app/utils/errorHelpers';
import {
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid';
import type {
  ArrRelease,
  ArrReleasesResponse,
} from '@server/interfaces/api/releaseInterfaces';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ManageSlideOver.ReleaseList', {
  search: 'Search Releases',
  searching: 'Searching…',
  searchHint: 'This can take up to a minute.',
  searchError: 'Something went wrong while searching for releases.',
  season: 'Season',
  seasonOption:
    'Season {seasonNumber} ({episodeCount, plural, one {# episode} other {# episodes}})',
  noResults: 'No releases found.',
  showAll: 'Show all {count}',
});

const INITIAL_RELEASE_COUNT = 10;

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'error'; message: string }
  | { status: 'done'; results: ArrRelease[] };

interface ReleaseListProps {
  mediaId: number;
  mediaType: 'movie' | 'tv';
  is4k?: boolean;
  seasons?: { seasonNumber: number; episodeCount: number; name?: string }[];
  onGrabbed: () => void;
}

const ReleaseList = ({
  mediaId,
  mediaType,
  is4k = false,
  seasons,
  onGrabbed,
}: ReleaseListProps) => {
  const intl = useIntl();
  const seasonOptions = mediaType === 'tv' ? (seasons ?? []) : [];
  const [pickedSeason, setPickedSeason] = useState<number>();
  const seasonNumber = pickedSeason ?? seasonOptions[0]?.seasonNumber;
  const [searchState, setSearchState] = useState<SearchState>({
    status: 'idle',
  });
  const [showAll, setShowAll] = useState(false);
  const searchRequest = useRef<AbortController | null>(null);

  useEffect(() => () => searchRequest.current?.abort(), []);

  const changeSeason = (newSeasonNumber: number) => {
    searchRequest.current?.abort();
    setPickedSeason(newSeasonNumber);
    setShowAll(false);
    setSearchState({ status: 'idle' });
  };

  const search = async () => {
    const controller = new AbortController();
    searchRequest.current = controller;
    setShowAll(false);
    setSearchState({ status: 'searching' });

    try {
      // No timeout: the indexer scrapes its sites while this request is open.
      const response = await axios.get<ArrReleasesResponse>(
        `/api/v1/media/${mediaId}/releases`,
        { params: { is4k, seasonNumber }, signal: controller.signal }
      );
      setSearchState({ status: 'done', results: response.data.results });
    } catch (e) {
      if (!axios.isCancel(e)) {
        setSearchState({
          status: 'error',
          message:
            getApiErrorMessage(e) ?? intl.formatMessage(messages.searchError),
        });
      }
    }
  };

  const isSearching = searchState.status === 'searching';
  const results = searchState.status === 'done' ? searchState.results : [];
  const visibleResults = showAll
    ? results
    : results.slice(0, INITIAL_RELEASE_COUNT);

  return (
    <div>
      <div className="space-y-2">
        {seasonOptions.length > 0 && (
          <select
            aria-label={intl.formatMessage(messages.season)}
            value={seasonNumber}
            onChange={(e) => changeSeason(Number(e.target.value))}
          >
            {seasonOptions.map((season) => (
              <option
                key={`season-${season.seasonNumber}`}
                value={season.seasonNumber}
              >
                {intl.formatMessage(messages.seasonOption, {
                  seasonNumber: season.seasonNumber,
                  episodeCount: season.episodeCount,
                })}
              </option>
            ))}
          </select>
        )}
        <Button
          buttonType="primary"
          className="w-full"
          disabled={isSearching}
          onClick={() => search()}
        >
          {isSearching ? <Spinner /> : <MagnifyingGlassIcon />}
          <span>
            {intl.formatMessage(
              isSearching ? messages.searching : messages.search
            )}
          </span>
        </Button>
      </div>
      <div role="status">
        {isSearching && (
          <p className="mt-1 text-xs text-gray-400">
            {intl.formatMessage(messages.searchHint)}
          </p>
        )}
        {searchState.status === 'done' && results.length === 0 && (
          <p className="mt-2 text-sm text-gray-400">
            {intl.formatMessage(messages.noResults)}
          </p>
        )}
      </div>
      {searchState.status === 'error' && (
        <p role="alert" className="mt-2 break-words text-sm text-red-400">
          {searchState.message}
        </p>
      )}
      {results.length > 0 && (
        <div className="mt-4 space-y-2">
          <ul className="space-y-2">
            {visibleResults.map((release) => (
              <ReleaseCard
                key={`${release.indexerId}:${release.guid}`}
                release={release}
                mediaId={mediaId}
                is4k={is4k}
                onGrabbed={onGrabbed}
              />
            ))}
          </ul>
          {!showAll && results.length > INITIAL_RELEASE_COUNT && (
            <Button
              buttonType="ghost"
              className="w-full"
              onClick={() => setShowAll(true)}
            >
              <ChevronDownIcon />
              <span>
                {intl.formatMessage(messages.showAll, {
                  count: results.length,
                })}
              </span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default ReleaseList;
