// Webcam -> MediaPipe FaceLandmarker -> per-frame eye signal.
//
// The model is pretrained (public/models/face_landmarker.task); nothing here is
// trained. We only read the iris and eye-corner landmarks it returns.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe-wasm`;
const MODEL_PATH = `${BASE}models/face_landmarker.task`;

// Landmark indices (478-point mesh). For each eye, corner `a` is the one on the
// image's left and `b` the one on the image's right, so both eyes measure the
// same direction.
export const EYES = [
  { a: 33, b: 133, iris: 468 }, // subject's right eye
  { a: 362, b: 263, iris: 473 }, // subject's left eye
];
const NOSE_TIP = 1;

const BLINK_THRESHOLD = 0.45;

export async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = { runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true };
  try {
    return await FaceLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
    });
  } catch {
    return await FaceLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
    });
  }
}

export async function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      // More frames per second = better saccade detection; take what we can get.
      frameRate: { ideal: 60 },
    },
  });
}

// Iris position inside one eye, in units of eye width.
//   h: 0 at corner a, 1 at corner b (horizontal gaze)
//   v: signed offset perpendicular to the corner line (vertical gaze, noisier)
// Working in the eye's own frame cancels most head translation and scale.
function eyeRatio(lm, eye, w, h) {
  const ax = lm[eye.a].x * w, ay = lm[eye.a].y * h;
  const bx = lm[eye.b].x * w, by = lm[eye.b].y * h;
  const ix = lm[eye.iris].x * w, iy = lm[eye.iris].y * h;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  return {
    h: ((ix - ax) * dx + (iy - ay) * dy) / len2,
    v: (dx * (iy - ay) - dy * (ix - ax)) / len2,
  };
}

function blendshape(result, name) {
  const cats = result.faceBlendshapes?.[0]?.categories ?? [];
  return cats.find((c) => c.categoryName === name)?.score ?? 0;
}

// Head turn: nose tip's sideways offset from the midpoint of the outer eye
// corners, in units of the corner-to-corner distance. ~0 facing the camera;
// changes by ~0.1 for a ~10 degree turn. Turning the head shifts the iris
// ratio the same way moving the eyes does, so the test rejects turned frames.
function headYaw(lm, w, h) {
  const ax = lm[33].x * w, ay = lm[33].y * h;
  const bx = lm[263].x * w, by = lm[263].y * h;
  const nx = lm[NOSE_TIP].x * w, ny = lm[NOSE_TIP].y * h;
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);
  return ((nx - (ax + bx) / 2) * dx + (ny - (ay + by) / 2) * dy) / (d * d);
}

function toSample(result, t, w, h) {
  const lm = result.faceLandmarks?.[0];
  if (!lm) {
    return { t, face: false, h: NaN, v: NaN, eyeDiff: NaN, yaw: NaN, blink: false, lm: null };
  }
  const eyes = EYES.map((e) => eyeRatio(lm, e, w, h));
  const blink =
    Math.max(blendshape(result, 'eyeBlinkLeft'), blendshape(result, 'eyeBlinkRight')) >
    BLINK_THRESHOLD;
  return {
    t,
    face: true,
    h: (eyes[0].h + eyes[1].h) / 2,
    v: (eyes[0].v + eyes[1].v) / 2,
    // Both eyes move together, so this difference should stay ~constant.
    // A sudden change means one eye's iris landmark glitched.
    eyeDiff: eyes[0].h - eyes[1].h,
    yaw: headYaw(lm, w, h),
    blink,
    lm,
  };
}

// Runs the landmarker on every new video frame and hands each sample to
// onSample. A frame that throws is reported as "no face" and the loop keeps
// going (one bad frame used to kill tracking for good). Returns a stop function.
export function startTracking(video, landmarker, onSample, onError) {
  const useFrameCallback = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  let stopped = false;
  let handle = 0;
  let lastTs = -1;

  const schedule = () => {
    handle = useFrameCallback
      ? video.requestVideoFrameCallback(step)
      : requestAnimationFrame(step);
  };

  function step() {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        // detectForVideo requires strictly increasing timestamps.
        let t = performance.now();
        if (t <= lastTs) t = lastTs + 0.01;
        lastTs = t;
        let result;
        try {
          result = landmarker.detectForVideo(video, t);
        } catch (e) {
          onError?.(e);
          result = { faceLandmarks: [] };
        }
        onSample(toSample(result, t, video.videoWidth, video.videoHeight));
      }
    } finally {
      if (!stopped) schedule();
    }
  }

  schedule();
  return () => {
    stopped = true;
    if (useFrameCallback) video.cancelVideoFrameCallback(handle);
    else cancelAnimationFrame(handle);
  };
}
