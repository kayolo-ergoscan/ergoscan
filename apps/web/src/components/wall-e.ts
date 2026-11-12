import { currentLook } from "@/lib/look";

/** Same WALL-E as the live-block tape. Defaults match that drawing. */

function drawEyes(
  ctx: CanvasRenderingContext2D,
  apart: number,
  head: number,
  look: number,
  eyeLift: number,
  eyeScale: number,
  ox: number,
  oy: number
) {
  const white = "#f7f3ea";
  const ink = "#3a2a14";
  const pupilInk = "#1c1917";
  // One rigid pair. t=0 is the head dock, same arcs and bridge as the tape.
  // t=1 lifts that pair straight up and opens it. The bridge never lets go.
  const t = apart;
  const swell = 1 + 0.36 * t;
  ctx.save();
  ctx.translate(0, -10 - eyeLift - 28 * t);
  ctx.rotate(head * (1 - t));
  ctx.scale(eyeScale * swell, eyeScale * swell);
  ctx.lineWidth = 1.3 / swell;
  ctx.fillStyle = white;
  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.arc(-6, -8, 6.5, 0, Math.PI * 2);
  ctx.arc(7, -8, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.fillRect(-2, -9, 5, 2.2);
  ctx.fillStyle = pupilInk;
  const pr = 2.3 * (1 + 0.22 * t);
  ctx.beginPath();
  ctx.arc(-5 + look + ox, -8 + oy, pr, 0, Math.PI * 2);
  ctx.arc(8 + look + ox, -8 + oy, pr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}


export type WallPose = {
  x: number;
  y: number;
  head: number;
  look: number;
  pick: number;
  roll: number;
  /** -1 faces screen-left, +1 faces screen-right. */
  face?: number;
  scale?: number;
  eyeLift?: number;
  eyeScale?: number;
  /** Pupil orbit radius. 0 keeps the pupils still. */
  pupilOrbit?: number;
  pupil?: number;
  /** 0 eyes docked on the head, 1 the same pair lifted above the word. */
  eyesApart?: number;
};

export function drawWallE(ctx: CanvasRenderingContext2D, pose: WallPose) {
  if (currentLook()) return;
  const face = pose.face ?? -1;
  const scale = pose.scale ?? 0.82;
  const eyeLift = pose.eyeLift ?? 0;
  const eyeScale = pose.eyeScale ?? 1;
  const orbit = pose.pupilOrbit ?? 0;
  const pupil = pose.pupil ?? 0;
  const apart = Math.max(0, Math.min(1, pose.eyesApart ?? 0));
  const ox = Math.cos(pupil) * orbit;
  const oy = Math.sin(pupil) * orbit * 0.7;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.scale(face * scale, scale);
  ctx.translate(0, -16);
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.35;
  ctx.strokeStyle = "#3a2a14";
  ctx.fillStyle = "#2a2622";
  ctx.beginPath();
  ctx.roundRect(-20, 8, 16, 8, 3);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(4, 8, 16, 8, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f0c14a";
  const tread = ((pose.roll * 0.35) % 5 + 5) % 5;
  for (const tx of [-18, 6]) ctx.fillRect(tx + tread, 10, 2.2, 4);
  ctx.fillStyle = "#e2a23a";
  ctx.beginPath();
  ctx.roundRect(-15, -8, 30, 18, 5);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(-8, -2);
  ctx.lineTo(8, -2);
  ctx.stroke();
  ctx.save();
  ctx.translate(12, -2);
  ctx.rotate(-0.85 + pose.pick * 1.15 + apart * 1.7);
  ctx.strokeStyle = "#d6d3d1";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(15, -12);
  ctx.stroke();
  ctx.fillStyle = "#f0c14a";
  ctx.strokeStyle = "#3a2a14";
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(11, -16);
  ctx.lineTo(22, -12);
  ctx.lineTo(15, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawEyes(ctx, apart, pose.head, pose.look, eyeLift, eyeScale, ox, oy);
  ctx.restore();
}
