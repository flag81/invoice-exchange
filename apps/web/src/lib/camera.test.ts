import { describe, expect, it } from 'vitest';

import {
  CAMERA_CONSTRAINTS,
  canOpenLiveCamera,
  describeCameraFailure,
  photoFileName,
  readCameraPermission,
  requestCamera,
} from './camera';
import { sq } from './copy/sq';

describe('canOpenLiveCamera', () => {
  it('opens the camera where the browser exposes one over a secure origin', () => {
    expect(canOpenLiveCamera({ getUserMedia: () => undefined }, true)).toBe(true);
  });

  it('falls back to the file input when there is no getUserMedia', () => {
    // A phone on a plain-http LAN address: the API is not exposed at all.
    expect(canOpenLiveCamera(undefined, true)).toBe(false);
    expect(canOpenLiveCamera({}, true)).toBe(false);
  });

  it('falls back to the file input on an insecure origin', () => {
    expect(canOpenLiveCamera({ getUserMedia: () => undefined }, false)).toBe(false);
    expect(canOpenLiveCamera(undefined, false)).toBe(false);
  });
});

describe('readCameraPermission', () => {
  /** The shape `navigator.permissions` has, without needing a browser to build one. */
  const answering = (state: string) => ({ query: () => Promise.resolve({ state }) });

  it('reports what the browser already knows about the camera', async () => {
    await expect(readCameraPermission(answering('granted'))).resolves.toBe('granted');
    await expect(readCameraPermission(answering('prompt'))).resolves.toBe('prompt');
    await expect(readCameraPermission(answering('denied'))).resolves.toBe('denied');
  });

  it('answers unknown where the name is not implemented, rather than throwing', async () => {
    // Firefox and Safari reject `{ name: 'camera' }` with a TypeError; the call is the only truth there.
    const unsupported = {
      query: () => Promise.reject(new TypeError('not a valid permission name')),
    };

    await expect(readCameraPermission(unsupported)).resolves.toBe('unknown');
    await expect(readCameraPermission(undefined)).resolves.toBe('unknown');
  });

  it('answers unknown for a state it does not recognise, rather than guessing', async () => {
    await expect(readCameraPermission(answering('weird'))).resolves.toBe('unknown');
  });
});

describe('describeCameraFailure', () => {
  it('tells a refusal apart from a missing camera and a camera in use', () => {
    expect(describeCameraFailure(new DOMException('nope', 'NotAllowedError'))).toBe(
      sq.capture.camera.denied,
    );
    expect(describeCameraFailure(new DOMException('nope', 'SecurityError'))).toBe(
      sq.capture.camera.denied,
    );
    expect(describeCameraFailure(new DOMException('nope', 'NotFoundError'))).toBe(
      sq.capture.camera.noCamera,
    );
    expect(describeCameraFailure(new DOMException('nope', 'OverconstrainedError'))).toBe(
      sq.capture.camera.noCamera,
    );
    expect(describeCameraFailure(new DOMException('nope', 'NotReadableError'))).toBe(
      sq.capture.camera.busy,
    );
    expect(describeCameraFailure(new DOMException('nope', 'AbortError'))).toBe(
      sq.capture.camera.busy,
    );
  });

  it('separates a refusal happening now from one the browser has already remembered', () => {
    const refused = new DOMException('nope', 'NotAllowedError');

    // The person said no once; pressing the button again will never bring the prompt back.
    expect(describeCameraFailure(refused, 'denied')).toBe(sq.capture.camera.deniedRemembered);
    expect(describeCameraFailure(refused, 'prompt')).toBe(sq.capture.camera.denied);
    expect(describeCameraFailure(refused, 'granted')).toBe(sq.capture.camera.denied);
    expect(describeCameraFailure(refused, 'unknown')).toBe(sq.capture.camera.denied);
    expect(describeCameraFailure(refused)).toBe(sq.capture.camera.denied);
  });

  it('does not blame a remembered refusal for a camera that is simply missing', () => {
    expect(describeCameraFailure(new DOMException('nope', 'NotFoundError'), 'denied')).toBe(
      sq.capture.camera.noCamera,
    );
  });

  it('answers with the honest sentence for a name it does not know', () => {
    expect(describeCameraFailure(new DOMException('nope', 'SomeFutureError'))).toBe(
      sq.capture.camera.unavailable,
    );
  });

  it('answers with the honest sentence for a rejection that is not a DOMException', () => {
    expect(describeCameraFailure(new Error('boom'))).toBe(sq.capture.camera.unavailable);
    expect(describeCameraFailure('boom')).toBe(sq.capture.camera.unavailable);
    expect(describeCameraFailure(undefined)).toBe(sq.capture.camera.unavailable);
  });
});

describe('requestCamera', () => {
  it('asks for the rear camera and declines the microphone', async () => {
    const asked: unknown[] = [];
    const stream = { id: 'stream-1' } as unknown as MediaStream;
    const media = {
      getUserMedia: (constraints: typeof CAMERA_CONSTRAINTS) => {
        asked.push(constraints);
        return Promise.resolve(stream);
      },
    };

    await expect(requestCamera(media)).resolves.toBe(stream);
    // One prompt, not two: the microphone is never part of the request.
    expect(asked).toEqual([CAMERA_CONSTRAINTS]);
    expect(CAMERA_CONSTRAINTS).toEqual({ video: { facingMode: 'environment' }, audio: false });
  });

  it('passes a refusal through instead of swallowing it, so the overlay can word it', async () => {
    const refusal = new DOMException('nope', 'NotAllowedError');
    const media = { getUserMedia: () => Promise.reject(refusal) };

    await expect(requestCamera(media)).rejects.toBe(refusal);
  });
});

describe('photoFileName', () => {
  it('names a captured photo after the moment it was taken', () => {
    // Local time on purpose: the person recognises the clock on their own wrist, not UTC.
    expect(photoFileName(new Date(2026, 9, 18, 14, 30, 5))).toBe('fatura-20261018-143005.jpg');
  });

  it('pads every part to a fixed width, so the names sort', () => {
    expect(photoFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('fatura-20260102-030405.jpg');
  });

  it('ends in .jpg, which is what the bytes are', () => {
    expect(photoFileName(new Date(2026, 11, 31, 23, 59, 59))).toBe('fatura-20261231-235959.jpg');
  });
});
