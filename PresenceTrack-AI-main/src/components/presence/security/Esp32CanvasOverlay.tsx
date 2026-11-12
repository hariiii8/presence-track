import { useEffect, useRef } from "react";

interface Esp32CanvasOverlayProps {
  isLive: boolean;
  faceDetected?: boolean;
  faceBoundingBox?: { x: number; y: number; w: number; h: number } | null;
  scScore?: number;
  statusMessage?: string;
}

// Canvas cannot read CSS variables per pixel; values mirror the Penna / Emerald / Umbra tokens.
const PENNA = "#BAC8E0";
const EMERALD = "#10B981";
const STAGE = "#161616";
const MUTED = "#2A2A2A";

/** Canvas overlay: alignment grid, boundary crossing line, and actual dynamic facial bounding boxes. */
export function Esp32CanvasOverlay({
  isLive,
  faceDetected = false,
  faceBoundingBox = null,
  scScore = 0,
  statusMessage,
}: Esp32CanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = 400;
    canvas.height = 300;
    ctx.fillStyle = STAGE;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!isLive) {
      ctx.fillStyle = PENNA;
      ctx.font = "13px 'JetBrains Mono', monospace";
      ctx.fillText(statusMessage || "Waiting for edge camera stream…", 16, 32);
      ctx.fillStyle = "#888888";
      ctx.font = "11px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText("Edge CV pipeline connects in Phase 5", 16, 56);
      return;
    }

    // Alignment grid & virtual boundary line
    ctx.strokeStyle = PENNA;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Center vertical
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();

    // Virtual boundary line (tripwire baseline)
    ctx.strokeStyle = EMERALD;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, canvas.height / 2);
    ctx.lineTo(canvas.width - 20, canvas.height / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Boundary label
    ctx.fillStyle = EMERALD;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.fillText("VIRTUAL BOUNDARY TRIPWIRE", 24, canvas.height / 2 - 8);

    if (faceDetected && faceBoundingBox) {
      const { x, y, w, h } = faceBoundingBox;
      ctx.strokeStyle = EMERALD;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, h);

      // Corner ticks
      ctx.lineWidth = 4;
      const t = 12;
      for (const [cx, cy, dx, dy] of [
        [x, y, 1, 1],
        [x + w, y, -1, 1],
        [x, y + h, 1, -1],
        [x + w, y + h, -1, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * t, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * t);
        ctx.stroke();
      }

      ctx.fillStyle = EMERALD;
      ctx.font = "bold 14px 'JetBrains Mono', monospace";
      ctx.fillText(`Sc: ${scScore.toFixed(4)}`, 16, 30);
    } else {
      ctx.fillStyle = PENNA;
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.fillText("Optical boundary active · Standby for transit", 16, 30);
    }
  }, [isLive, faceDetected, faceBoundingBox, scScore, statusMessage]);

  return (
    <div className="relative overflow-hidden rounded-xl bg-stage">
      <canvas ref={canvasRef} className="aspect-[4/3] h-auto w-full" />
      {faceDetected && scScore > 0 && (
        <>
          <div className="absolute top-2 right-2 rounded bg-stage/80 px-2 py-1 font-mono text-xs text-success">
            Sc {scScore.toFixed(4)}
          </div>
          <div className="absolute bottom-2 left-2 rounded bg-success/90 px-2 py-1 text-xs font-medium text-primary-foreground">
            Identity Verified
          </div>
        </>
      )}
      {!faceDetected && isLive && (
        <div className="absolute bottom-2 left-2 rounded bg-muted/80 px-2.5 py-1 text-xxs font-mono text-sage">
          Awaiting boundary transit
        </div>
      )}
    </div>
  );
}
