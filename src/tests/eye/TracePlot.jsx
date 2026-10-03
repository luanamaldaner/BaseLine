import { useEffect, useRef } from 'react';

// Eye-vs-dot graph: target path, gaze path, saccades highlighted.
export default function TracePlot({ trace, height = 260 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !trace?.length) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const css = getComputedStyle(canvas);
      const color = (name) => css.getPropertyValue(name).trim();
      const pad = { l: 40, r: 12, t: 12, b: 26 };
      const t0 = trace[0].t;
      const t1 = trace[trace.length - 1].t;
      const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
      const y = (v) => pad.t + (1 - v) * (h - pad.t - pad.b);

      // Grid + axes
      ctx.strokeStyle = color('--grid');
      ctx.fillStyle = color('--muted');
      ctx.font = '11px system-ui, sans-serif';
      ctx.lineWidth = 1;
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        ctx.beginPath();
        ctx.moveTo(pad.l, y(v));
        ctx.lineTo(w - pad.r, y(v));
        ctx.stroke();
      }
      ctx.textAlign = 'right';
      ctx.fillText('right', pad.l - 6, y(1) + 4);
      ctx.fillText('left', pad.l - 6, y(0) + 4);
      ctx.textAlign = 'center';
      for (let s = Math.ceil(t0 / 1000); s <= t1 / 1000; s += 2) {
        ctx.fillText(`${s}s`, x(s * 1000), h - 8);
      }

      const line = (key, stroke, widthPx) => {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = widthPx;
        ctx.beginPath();
        let pen = false;
        for (const p of trace) {
          const v = p[key];
          if (!Number.isFinite(v)) { pen = false; continue; }
          if (pen) ctx.lineTo(x(p.t), y(v));
          else ctx.moveTo(x(p.t), y(v));
          pen = true;
        }
        ctx.stroke();
      };
      // Keep wild readings inside the plot area instead of drawing over the axes.
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.l, pad.t - 2, w - pad.l - pad.r, h - pad.t - pad.b + 4);
      ctx.clip();
      line('target', color('--target'), 2);
      line('gaze', color('--accent'), 1.5);

      ctx.fillStyle = color('--danger');
      for (const p of trace) {
        if (p.saccade && Number.isFinite(p.gaze)) {
          ctx.beginPath();
          ctx.arc(x(p.t), y(Math.min(Math.max(p.gaze, 0), 1)), 4, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
      ctx.restore();
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [trace, height]);

  return (
    <div className="plot">
      <canvas ref={canvasRef} style={{ width: '100%', height }} />
      <div className="legend">
        <span><i style={{ background: 'var(--target)' }} /> Dot</span>
        <span><i style={{ background: 'var(--accent)' }} /> Eyes</span>
        <span><i style={{ background: 'var(--danger)' }} /> Catch-up jump</span>
      </div>
    </div>
  );
}
