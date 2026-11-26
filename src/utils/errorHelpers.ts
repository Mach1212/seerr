import axios from 'axios';

export const getApiErrorMessage = (e: unknown): string | undefined => {
  if (!axios.isAxiosError(e)) {
    return undefined;
  }

  const message: unknown = e.response?.data?.message;

  return typeof message === 'string' && message ? message : undefined;
};
