'use client';

/**
 * The live camera: a `getUserMedia` preview and one shutter.
 *
 * This exists because `capture="environment"` on a file input is a *hint*, not a command, and the
 * browsers that ignore it are not a minority: every desktop browser opens the OS file dialog
 * instead, Firefox ignores it on Android too, and Chrome's device emulation does not emulate it
 * either. The button that promises a camera therefore cannot be a file input — it has to be a camera
 * (ADR 0010). The hidden input that still carries `capture` stays behind it, for the one origin
 * where `getUserMedia` does not exist at all.
 *
 * The camera is **asked for by the click** that opens this overlay (`CaptureCard`), while the page
 * still holds the user's gesture: that is the request every browser turns into its permission
 * prompt, Safari most of all. The overlay owns the stream that request resolves to, and every track
 * is stopped in the effect's cleanup. That is deliberately not a "close" handler — a camera left
 * running behind a closed overlay is a lit indicator light and a flat battery, and an unmount is the
 * only teardown that cannot be forgotten.
 *
 * A refusal is not the end of the road: "Provo përsëri kamerën" makes a fresh request from its own
 * click, which is the only way to get the prompt back after someone lifts a block in the site
 * settings. The file input stays one tap away throughout.
 *
 * The frame is captured by drawing the `<video>` into a canvas, so what is sent is exactly what was
 * previewed. The result is a JPEG `File` that takes the same path as any other photo: the server
 * still decides what it is from its own bytes (ADR 0004).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  describeCameraFailure,
  photoFileName,
  readCameraPermission,
  requestCamera,
} from '@/lib/camera';
import { sq } from '@/lib/copy/sq';

/** The still is a JPEG: what the server sniffs for, and what the hidden input already accepts. */
const PHOTO_TYPE = 'image/jpeg';

/**
 * 0.92 rather than 1.0: re-encoding a 12 MP frame at full quality costs megabytes for detail no
 * reader can use, and `STORAGE_MAX_UPLOAD_BYTES` is 8 MiB for a reason.
 */
const PHOTO_QUALITY = 0.92;

type Status = 'starting' | 'live' | 'failed';

/** Stops every track of a stream: the only way to turn the camera light off. */
function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export type CameraCaptureProps = {
  readonly onCapture: (file: File) => void;
  readonly onClose: () => void;
  /** The escape hatch: the file input the card keeps behind the camera. */
  readonly onUseFile: () => void;
  /**
   * The request the card already started, inside the click that opened this overlay. `null` means
   * "ask now", which keeps the overlay usable on its own.
   */
  readonly request?: Promise<MediaStream> | null;
};

export function CameraCapture({
  onCapture,
  onClose,
  onUseFile,
  request = null,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** False once this overlay goes away, so a late promise cannot resurrect it. */
  const aliveRef = useRef(true);
  /**
   * Bumped by every mount, unmount and retry. Each request remembers the generation it was made in
   * and discards itself when that number has moved on — which is what keeps StrictMode's double
   * effect (and a retry pressed while the first prompt is open) from attaching two streams.
   */
  const generationRef = useRef(0);
  const [status, setStatus] = useState<Status>('starting');
  const [message, setMessage] = useState<string | null>(null);
  /**
   * `true` when the browser remembers a refusal: the prompt will not appear again until the person
   * lifts the block in the site settings, so offering "try again" would be the lie ADR 0010 names.
   */
  const [blocked, setBlocked] = useState(false);

  /**
   * Every stream a request has delivered and that this overlay still has to close. A set, not a
   * single value, because two requests can be in flight at once (StrictMode's second effect, or a
   * retry pressed while the first prompt is still open) and the loser of that race still lights the
   * camera until somebody stops it.
   */
  const streamsRef = useRef<Set<MediaStream>>(new Set());

  /**
   * Attaches the stream a request resolves to. Written once and shared by the initial request and
   * the retry button, because the two differ only in *when* the browser was asked.
   */
  const attach = useCallback((pending: Promise<MediaStream>) => {
    const generation = generationRef.current;
    const isCurrent = (): boolean => aliveRef.current && generationRef.current === generation;

    // Asked in parallel with the call, never before it: `getUserMedia` is the only thing that makes
    // the browser put its prompt on screen, and that prompt is the first thing the person should see.
    // The answer is used to word a refusal, not to decide whether to ask.
    const remembered = readCameraPermission(navigator.permissions);

    pending
      .then((opened) => {
        // Closed before the answer arrived: nobody can show this stream, so close it.
        if (!aliveRef.current) {
          stopStream(opened);
          return;
        }

        streamsRef.current.add(opened);

        // A newer request owns the preview. The stream stays in the set so the current attempt —
        // success or failure — closes it, rather than a stale handler killing the live one. (The
        // shared `request` of a StrictMode remount resolves to this very object, so nothing is lost.)
        if (!isCurrent()) {
          return;
        }

        for (const stream of streamsRef.current) {
          if (stream !== opened) {
            stopStream(stream);
          }
        }

        streamsRef.current.clear();
        streamsRef.current.add(opened);

        if (videoRef.current !== null) {
          videoRef.current.srcObject = opened;
        }

        setStatus('live');
        setMessage(null);
        setBlocked(false);
      })
      .catch((error: unknown) => {
        // Awaiting the permission first: it settles in the same turn as the refusal it explains, and
        // "the browser said no" and "you said no, once, and it will not ask again" need two different
        // sentences. `readCameraPermission` never rejects, so this cannot throw.
        void remembered.then((permission) => {
          if (!isCurrent()) {
            return;
          }

          // This attempt is the one that failed, so no stream it lost the race to can be shown.
          for (const stream of streamsRef.current) {
            stopStream(stream);
          }
          streamsRef.current.clear();

          setStatus('failed');
          setMessage(describeCameraFailure(error, permission));
          setBlocked(permission === 'denied');
        });
      });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    generationRef.current += 1;

    // Annotated, not inferred: the DOM types say `mediaDevices` always exists, and it does not on an
    // insecure origin. Widening the type is what lets the check below be written at all.
    const media: MediaDevices | undefined = navigator.mediaDevices;

    if (media === undefined) {
      setStatus('failed');
      setMessage(sq.capture.camera.unavailable);
    } else {
      // Usually already in flight from the opening click; asking here keeps a direct mount working.
      attach(request ?? requestCamera(media));
    }

    return () => {
      aliveRef.current = false;
      generationRef.current += 1;

      for (const stream of streamsRef.current) {
        stopStream(stream);
      }

      streamsRef.current.clear();
    };
  }, [attach, request]);

  /**
   * A new request from its own click: the browser's prompt appears again only for a call made while
   * the person is interacting with the page — after a block is lifted in the site settings, this is
   * the button that gets the prompt back. Invalidation first, so a still-open first attempt cannot
   * win the race with this one.
   */
  function retry(): void {
    generationRef.current += 1;
    setMessage(null);
    setBlocked(false);

    const media: MediaDevices | undefined = navigator.mediaDevices;

    if (media === undefined) {
      setStatus('failed');
      setMessage(sq.capture.camera.unavailable);
      return;
    }

    setStatus('starting');
    attach(requestCamera(media));
  }

  // Escape closes it, and the page behind it does not scroll while it is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  function captureFrame(): void {
    const video = videoRef.current;

    // `videoWidth` is 0 until the first frame has arrived, and drawing then yields a blank photo.
    if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
      setMessage(sq.capture.camera.failed);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');

    if (context === null) {
      setMessage(sq.capture.camera.failed);
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          setMessage(sq.capture.camera.failed);
          return;
        }

        onCapture(new File([blob], photoFileName(new Date()), { type: PHOTO_TYPE }));
      },
      PHOTO_TYPE,
      PHOTO_QUALITY,
    );
  }

  return (
    <div
      className="camera-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={sq.capture.camera.title}
    >
      <div className="camera-stage">
        {/* `playsInline` and `muted` are what stop iOS Safari taking the preview fullscreen. */}
        <video ref={videoRef} className="camera-video" autoPlay playsInline muted />

        {status === 'starting' ? <p className="camera-note">{sq.capture.camera.starting}</p> : null}
        {message === null ? null : <p className="camera-note error">{message}</p>}
      </div>

      <div className="camera-actions">
        {status === 'starting' ? (
          // The prompt is the browser's, not ours: saying so is what stops the wait looking broken.
          <p className="camera-hint">{sq.capture.camera.permissionHint}</p>
        ) : null}

        {status === 'live' ? (
          <>
            <p className="camera-hint">{sq.capture.camera.hint}</p>
            <button type="button" className="camera-shutter" onClick={captureFrame}>
              {sq.capture.camera.shutter}
            </button>
          </>
        ) : null}

        {status === 'failed' ? (
          <>
            {/* A remembered refusal is undone in the padlock menu, not by pressing a button here. */}
            {blocked ? null : (
              <button type="button" className="camera-shutter" onClick={retry}>
                {sq.capture.camera.retryCamera}
              </button>
            )}
            <button type="button" className="camera-shutter secondary" onClick={onUseFile}>
              {sq.capture.camera.useFile}
            </button>
          </>
        ) : null}

        <button type="button" className="camera-close" onClick={onClose}>
          {sq.capture.camera.close}
        </button>
      </div>
    </div>
  );
}
