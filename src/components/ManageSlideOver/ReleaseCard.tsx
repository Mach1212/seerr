import Spinner from '@app/assets/spinner.svg';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { getApiErrorMessage } from '@app/utils/errorHelpers';
import { formatBytes } from '@app/utils/numberHelpers';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/solid';
import type {
  ArrRelease,
  ArrReleaseGrabRequest,
} from '@server/interfaces/api/releaseInterfaces';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ManageSlideOver.ReleaseCard', {
  unknownSize: 'Unknown size',
  seasonPack: 'Season pack',
  episode: 'E{episodeNumber}',
  rejections: 'Rejection reasons',
  grab: 'Grab',
  grabbing: 'Grabbing…',
  grabbed: 'Grabbed',
  grabSuccess: 'Grabbed <strong>{title}</strong>.',
  grabError: 'Something went wrong while grabbing the release.',
  grabExpired:
    'These search results have expired. Search again to grab this release.',
});

interface ReleaseCardProps {
  release: ArrRelease;
  mediaId: number;
  is4k: boolean;
  onGrabbed: () => void;
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <Badge
    badgeType="light"
    className="!whitespace-normal border border-gray-600"
  >
    {children}
  </Badge>
);

const ReleaseCard = ({
  release,
  mediaId,
  is4k,
  onGrabbed,
}: ReleaseCardProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [grabState, setGrabState] = useState<'idle' | 'grabbing' | 'grabbed'>(
    'idle'
  );
  // The link comes from the indexer's site: only plain web links are followed.
  const infoUrl =
    release.infoUrl && /^https?:\/\//i.test(release.infoUrl)
      ? release.infoUrl
      : undefined;

  const grab = async () => {
    const request: ArrReleaseGrabRequest = {
      guid: release.guid,
      indexerId: release.indexerId,
      is4k,
    };

    setGrabState('grabbing');

    try {
      await axios.post(`/api/v1/media/${mediaId}/releases/grab`, request);
    } catch (e) {
      // Radarr and Sonarr keep search results for 30 minutes, then answer 404.
      const message =
        axios.isAxiosError(e) && e.response?.status === 404
          ? intl.formatMessage(messages.grabExpired)
          : (getApiErrorMessage(e) ?? intl.formatMessage(messages.grabError));

      setGrabState('idle');
      addToast(<span className="break-words">{message}</span>, {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setGrabState('grabbed');
    addToast(
      <span>
        {intl.formatMessage(messages.grabSuccess, {
          title: release.title,
          strong: (msg: React.ReactNode) => (
            <strong className="break-all">{msg}</strong>
          ),
        })}
      </span>,
      { appearance: 'success', autoDismiss: true }
    );
    onGrabbed();
  };

  return (
    <li className="rounded-md border border-gray-700 bg-gray-800 p-3 shadow">
      <p className="break-all text-sm font-medium text-gray-100">
        {infoUrl ? (
          <a
            href={infoUrl}
            target="_blank"
            rel="noreferrer"
            className="transition duration-300 hover:text-white hover:underline"
          >
            {release.title}
            <ArrowTopRightOnSquareIcon className="ml-1 inline-block h-4 w-4 align-text-bottom text-gray-400" />
          </a>
        ) : (
          release.title
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge>{release.quality}</Badge>
        <Chip>
          {release.size > 0
            ? formatBytes(release.size, 1)
            : intl.formatMessage(messages.unknownSize)}
        </Chip>
        {release.fullSeason ? (
          <Chip>{intl.formatMessage(messages.seasonPack)}</Chip>
        ) : (
          release.episodeNumbers.length > 0 && (
            <Chip>
              {release.episodeNumbers
                .map((episodeNumber) =>
                  intl.formatMessage(messages.episode, {
                    episodeNumber: String(episodeNumber).padStart(2, '0'),
                  })
                )
                .reduce((list, episode) =>
                  intl.formatMessage(globalMessages.delimitedlist, {
                    a: list,
                    b: episode,
                  })
                )}
            </Chip>
          )
        )}
        {release.customFormats.map((customFormat) => (
          <Chip key={`format-${customFormat}`}>{customFormat}</Chip>
        ))}
        {release.languages.map((language) => (
          <Chip key={`language-${language}`}>{language}</Chip>
        ))}
      </div>
      {release.rejected && release.rejections.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-yellow-500">
          <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
          <ul
            aria-label={intl.formatMessage(messages.rejections)}
            className="min-w-0 space-y-0.5 break-words"
          >
            {release.rejections.map((rejection, index) => (
              <li key={`rejection-${index}`}>{rejection}</li>
            ))}
          </ul>
        </div>
      )}
      {grabState === 'idle' ? (
        <ConfirmButton
          onClick={() => grab()}
          confirmText={intl.formatMessage(globalMessages.areyousure)}
          className="mt-3 w-full"
        >
          <ArrowDownTrayIcon />
          <span>{intl.formatMessage(messages.grab)}</span>
        </ConfirmButton>
      ) : (
        <Button
          buttonType={grabState === 'grabbed' ? 'success' : 'danger'}
          className="mt-3 w-full"
          disabled
        >
          {grabState === 'grabbed' ? <CheckIcon /> : <Spinner />}
          <span>
            {intl.formatMessage(
              grabState === 'grabbed' ? messages.grabbed : messages.grabbing
            )}
          </span>
        </Button>
      )}
    </li>
  );
};

export default ReleaseCard;
