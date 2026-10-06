/** Message of an unknown thrown value. Duck-typed: socket libraries may throw cross-realm errors. */
export const errorMessage = (error: unknown): string =>
  typeof error === 'object' &&
  error !== null &&
  'message' in error &&
  typeof error.message === 'string'
    ? error.message
    : String(error);
