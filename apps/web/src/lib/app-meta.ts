/**
 * Application identity.
 *
 * `APP_VERSION` is asserted against `package.json` in `app-meta.test.ts`: a version string that is
 * shown in the UI and reported by `/api/health` is worthless if it drifts from the deployed build.
 */
export const APP_NAME = 'e-Invoice Exchange';
export const APP_VERSION = '0.1.0';

/** Where the JSON API lives, relative to the web app (see `@einv/api-client`). */
export const API_BASE_PATH = '/api/v1';
