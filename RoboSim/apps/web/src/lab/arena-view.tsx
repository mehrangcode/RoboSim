import { ArenaRenderer } from '@robosim/renderer-2d';
import type { Frame, SceneInfo } from '@robosim/sim-runtime';
import { useEffect, useRef } from 'react';

/** Canvas host for the 2D arena renderer; redraws on every frame and on resize. */
export function ArenaView({ scene, frame, label }: { scene: SceneInfo; frame: Frame | null; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const frameRef = useRef<Frame | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !scene.arena) return;
    const renderer = new ArenaRenderer(ctx, scene.arena, scene.robot ?? null);
    rendererRef.current = renderer;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      renderer.resize();
      renderer.draw(frameRef.current?.robot ?? null);
    };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(canvas);
    return () => {
      observer?.disconnect();
      rendererRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    frameRef.current = frame;
    if (frame?.simTime === 0) rendererRef.current?.clearTrail();
    rendererRef.current?.draw(frame?.robot ?? null);
  }, [frame]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="aspect-[3/2] w-full rounded-lg border border-line bg-surface"
    />
  );
}
