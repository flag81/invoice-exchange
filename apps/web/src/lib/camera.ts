/**
 * The live camera's pure decisions: whether it can be opened here, what a refusal means, and what
 * the resulting photo is called.
 *
 * `getUserMedia` is not a button — it is a permission request, and every way it can be refused is a
 * different sentence for the person holding the phone: `NotAllowedError` is "you said no",
 * `NotFoundError` is "this machine has no camera", `NotReadableError` is "another program has it".
 * Collapsing those into one "the camera did not open" is how a support call becomes unanswerable, so
 * the mapping is a function here rather than a `catch` block inside a component.
 *
 * The name matters for the same reason the server generates its own storage key: a photo taken by
 * the `capture` attribute arrives as `image.jpg`, and `DocumentBlob.originalFilename` is a display
 * string that support reads months later (ADR 0004).
 *
 * Nothing here touches the DOM, so it is tested in the same node project as the rest of `src/lib`.
 */

import { sq } from '@/lib/copy/sq';

/**
 * The one capability the check needs, typed structurally on purpose: `navigator.mediaDevices` is
 * `MediaDevices`, which cannot be constructed in a test without a DOM — and `getUserMedia` is the
 * only member that decides the answer.
 */
export type LiveCameraSource = { readonly getUserMedia?: unknown };

/**
 * Whether to open the in-app camera or hand the person the file input.
 *
 * Two conditions, and both are load-bearing:
 *
 *   * **`getUserMedia` exists.** It is absent on a phone pointed at a dev server over a LAN
 *     address (`http://192.168.x.x:3001`), because the API is exposed only in a secure context.
 *   * **The origin is secure.** `https:` or `localhost`. Belt and braces for a browser that exposes
 *     the API and then rejects the call.
 *
 * When this is false the caller uses the hidden input, which still carries `capture="environment"`:
 * on a phone that is the native camera app, which is a better answer than a dead button.
 */
export function canOpenLiveCamera(media: LiveCameraSource | undefined, secure: boolean): boolean {
  return media?.getUserMedia !== undefined && secure;
}

/**
 * The constraints the whole app asks with: the rear camera (the one pointed at the paper), and no
 * audio — asking for a microphone would put a second, pointless prompt on screen.
 *
 * Shared rather than written twice, so the request made by the click and the one made by a retry
 * cannot drift apart.
 */
export const CAMERA_CONSTRAINTS = {
  video: { facingMode: 'environment' },
  audio: false,
} as const;

/**
 * The one member of `MediaDevices` a request needs. Typed structurally for the same reason as
 * `LiveCameraSource`: a real `MediaDevices` cannot be constructed in a Node test.
 */
export type CameraRequester = {
  getUserMedia(constraints: typeof CAMERA_CONSTRAINTS): Promise<MediaStream>;
};

/**
 * Asks the browser for the camera. This call — and nothing else — is what makes the browser put its
 * permission prompt on screen.
 *
 * It is therefore called from the **click** that promised a camera, not only from the effect of the
 * overlay that click opens: a request made while the page still holds the user's gesture is the one
 * every browser honours (Safari is strict about this), and the same function is what a "try again"
 * button calls after the person lifts a block in the site settings.
 */
export function requestCamera(media: CameraRequester): Promise<MediaStream> {
  return media.getUserMedia(CAMERA_CONSTRAINTS);
}

/**
 * What the Permissions API says about the camera — asked *alongside* the call, never instead of it.
 *
 * The prompt belongs to the browser and only `getUserMedia` makes it appear, so this is not a
 * pre-flight check that could suppress it. It exists for the one answer that changes what the person
 * should do next: `'denied'` is remembered, the prompt will never appear again until it is reset, and
 * inviting a retry would be a lie.
 *
 * `'unknown'` is a real answer, not a failure: Firefox and Safari reject `query({ name: 'camera' })`
 * outright, and on those the call is the only source of truth.
 */
export type CameraPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/**
 * `navigator.permissions`, typed structurally for the same reason as `LiveCameraSource`: the real
 * `Permissions` interface cannot be constructed in a test. `{ name: string }` rather than the DOM's
 * `PermissionName`, which has no `'camera'` member even though browsers accept it.
 */
export type PermissionQuery = {
  query(descriptor: { readonly name: string }): Promise<{ readonly state: string }>;
};

/** Never throws and never rejects: a browser that does not implement this answers `'unknown'`. */
export async function readCameraPermission(
  permissions: PermissionQuery | undefined,
): Promise<CameraPermission> {
  try {
    const status = await permissions?.query({ name: 'camera' });

    if (status?.state === 'granted' || status?.state === 'prompt' || status?.state === 'denied') {
      return status.state;
    }
  } catch {
    // `TypeError` on Firefox and Safari: the name is not implemented. Not an error to report.
  }

  return 'unknown';
}

/**
 * What to tell the person. The browser's own message is English and aimed at a developer
 * (`Requested device not found`), so it is translated rather than shown.
 *
 * `remembered` changes the wording of exactly one case, and it is the case that matters most: a
 * `NotAllowedError` that arrives while the permission is already `'denied'` is not a refusal
 * happening now, it is a refusal that happened once and that no amount of pressing the button will
 * bring back. Two different sentences, because they need two different actions.
 */
export function describeCameraFailure(
  error: unknown,
  remembered: CameraPermission = 'unknown',
): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return remembered === 'denied'
          ? sq.capture.camera.deniedRemembered
          : sq.capture.camera.denied;
      case 'NotFoundError':
      case 'OverconstrainedError':
        return sq.capture.camera.noCamera;
      case 'NotReadableError':
      case 'AbortError':
        return sq.capture.camera.busy;
      default:
        break;
    }
  }

  return sq.capture.camera.unavailable;
}

/**
 * `fatura-20261018-143005.jpg` — local time, because that is the clock the person read it off, and
 * a fixed width so the names sort.
 */
export function photoFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');

  const day = `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `fatura-${day}-${time}.jpg`;
}
