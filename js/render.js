/* Отрисовка канваса: стол, маршрут, КТ, траектории (цвет = время), шары, стрелы ударов. */
"use strict";
(function (global, factory) {
	const K = global.Kribil ?? (global.Kribil = {});
	factory(K);
	if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof globalThis !== "undefined" ? globalThis : this, function (K) {
	if (typeof require === "function") {
		require("./core.js");
		require("./levels.js");
	}

	function makeView(table, cssW, cssH, pad = 10) {
		const worldW = table.w + table.rail * 2;
		const worldH = table.h + table.rail * 2;
		const scale = Math.min((cssW - pad * 2) / worldW, (cssH - pad * 2) / worldH);
		const ox = (cssW - worldW * scale) / 2 + table.rail * scale;
		const oy = (cssH - worldH * scale) / 2 + table.rail * scale;
		return { scale, ox, oy, w: cssW, h: cssH, table };
	}

	const X = (v, x) => v.ox + x * v.scale;
	const Y = (v, y) => v.oy + y * v.scale;
	const L = (v, l) => l * v.scale;
	const unproject = (v, px, py) => ({ x: (px - v.ox) / v.scale, y: (py - v.oy) / v.scale });

	const STOPS = [
		[0, "#fff4a3"],
		[0.2, "#ffb703"],
		[0.42, "#f4623a"],
		[0.6, "#e0356f"],
		[0.78, "#8e5bd6"],
		[1, "#2f9bd6"],
	];

	function hex(c) {
		const n = parseInt(c.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	function timeRGB(f) {
		const x = Math.max(0, Math.min(1, f));
		for (let i = 1; i < STOPS.length; i++) {
			if (x <= STOPS[i][0]) {
				const [a0, c0] = STOPS[i - 1];
				const [a1, c1] = STOPS[i];
				const k = (x - a0) / (a1 - a0 || 1);
				const A = hex(c0);
				const B = hex(c1);
				return [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
			}
		}
		return hex(STOPS[STOPS.length - 1][1]);
	}

	function timeColor(f, alpha = 1) {
		const [r, g, b] = timeRGB(f);
		return alpha >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
	}

	function roundRect(ctx, x, y, w, h, r) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	function diamond(ctx, cx, cy, r) {
		ctx.beginPath();
		ctx.moveTo(cx, cy - r);
		ctx.lineTo(cx + r, cy);
		ctx.lineTo(cx, cy + r);
		ctx.lineTo(cx - r, cy);
		ctx.closePath();
		ctx.fill();
	}

	function drawTable(ctx, v, glow = 0) {
		const { table } = v;
		const x0 = X(v, -table.rail);
		const y0 = Y(v, -table.rail);
		const rw = L(v, table.w + table.rail * 2);
		const rh = L(v, table.h + table.rail * 2);

		const wood = ctx.createLinearGradient(x0, y0, x0 + rw, y0 + rh);
		wood.addColorStop(0, "#5d3218");
		wood.addColorStop(0.45, "#7a4520");
		wood.addColorStop(0.7, "#4c2a15");
		wood.addColorStop(1, "#69391c");
		roundRect(ctx, x0, y0, rw, rh, L(v, 0.06));
		ctx.fillStyle = wood;
		ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,.55)";
		ctx.lineWidth = 2;
		ctx.stroke();

		const fx = X(v, 0);
		const fy = Y(v, 0);
		const fw = L(v, table.w);
		const fh = L(v, table.h);
		ctx.save();
		roundRect(ctx, fx, fy, fw, fh, L(v, 0.015));
		ctx.clip();
		const felt = ctx.createRadialGradient(fx + fw * 0.42, fy + fh * 0.3, L(v, 0.05), fx + fw * 0.5, fy + fh * 0.5, fw * 0.85);
		felt.addColorStop(0, "#1c6a4d");
		felt.addColorStop(0.55, "#145239");
		felt.addColorStop(1, "#0b3122");
		ctx.fillStyle = felt;
		ctx.fillRect(fx, fy, fw, fh);
		if (glow > 0) {
			ctx.fillStyle = `rgba(255,231,146,${0.05 * glow})`;
			ctx.fillRect(fx, fy, fw, fh);
		}
		ctx.strokeStyle = "rgba(255,255,255,.09)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(X(v, table.w * 0.25), fy);
		ctx.lineTo(X(v, table.w * 0.25), fy + fh);
		ctx.stroke();
		ctx.fillStyle = "rgba(255,255,255,.16)";
		for (const px of [0.25, 0.75]) {
			ctx.beginPath();
			ctx.arc(X(v, table.w * px), Y(v, table.h / 2), 2.5, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();

		ctx.strokeStyle = "rgba(0,0,0,.45)";
		ctx.lineWidth = 3;
		roundRect(ctx, fx, fy, fw, fh, L(v, 0.015));
		ctx.stroke();
		ctx.strokeStyle = "rgba(140,255,205,.10)";
		ctx.lineWidth = 1;
		roundRect(ctx, fx + 1.5, fy + 1.5, fw - 3, fh - 3, L(v, 0.012));
		ctx.stroke();

		ctx.fillStyle = "rgba(240,220,170,.75)";
		const d = L(v, 0.012);
		for (let i = 1; i <= 3; i++) {
			for (const [px, py] of [
				[(i / 4) * table.w, -table.rail / 2],
				[(i / 4) * table.w, table.h + table.rail / 2],
			]) diamond(ctx, X(v, px), Y(v, py), d);
		}
		for (const [px, py] of [
			[-table.rail / 2, table.h * 0.5],
			[table.w + table.rail / 2, table.h * 0.5],
		]) diamond(ctx, X(v, px), Y(v, py), d);
	}

	function drawRoute(ctx, v, cps) {
		if (cps.length < 2) return;
		ctx.save();
		ctx.setLineDash([L(v, 0.03), L(v, 0.03)]);
		ctx.strokeStyle = "rgba(255,240,200,.18)";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		cps.forEach((c, i) => {
			const px = X(v, c.x);
			const py = Y(v, c.y);
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		});
		ctx.stroke();
		ctx.restore();
	}

	function drawCheckpoint(ctx, v, cp, i, state) {
		const cx = X(v, cp.x);
		const cy = Y(v, cp.y);
		const r = L(v, cp.r);
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fillStyle = state.passed ? "rgba(126,222,170,.14)" : "rgba(255,255,255,.045)";
		ctx.fill();

		if (state.next) {
			ctx.beginPath();
			ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
			ctx.strokeStyle = state.color;
			ctx.globalAlpha = 0.35;
			ctx.lineWidth = 6;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.strokeStyle = state.color;
		ctx.lineWidth = state.selected ? 3.2 : 2;
		ctx.setLineDash(state.passed ? [] : [7, 5]);
		ctx.stroke();
		ctx.setLineDash([]);

		if (state.passed && state.t !== undefined) {
			ctx.beginPath();
			ctx.arc(cx, cy, r * 0.72, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, state.t / 12));
			ctx.strokeStyle = "rgba(255,255,255,.55)";
			ctx.lineWidth = 2;
			ctx.stroke();
		}

		ctx.fillStyle = state.color;
		ctx.font = `700 ${Math.max(11, r * 0.55)}px system-ui, sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(state.passed ? "✓" : `${i + 1}`, cx, cy + 0.5);
		ctx.font = `500 ${Math.max(8, r * 0.26)}px system-ui, sans-serif`;
		ctx.fillStyle = "rgba(255,255,255,.5)";
		ctx.fillText(i === 3 ? "ФИНИШ" : `К-${i + 1}`, cx, cy + r * 0.62);

		if (state.selected) {
			ctx.beginPath();
			ctx.arc(cx + r, cy, 5.5, 0, Math.PI * 2);
			ctx.fillStyle = state.color;
			ctx.fill();
			ctx.strokeStyle = "rgba(0,0,0,.6)";
			ctx.lineWidth = 1.5;
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(cx - r - 8, cy);
			ctx.lineTo(cx - r, cy);
			ctx.moveTo(cx + r, cy);
			ctx.lineTo(cx + r + 8, cy);
			ctx.stroke();
		}
		ctx.restore();
	}

	/**
	 * Траектории всех тел. Сегменты раскладываются по временным бакетам,
	 * чтобы красить время одним stroke на бакет (без аллокаций на сегмент).
	 */
	/**
	 * Раскладка траекторий по корзинам времени в Path2D. Строится один раз на
	 * результат симуляции (корзины не зависят от кадра), переиспользуется
	 * через drawTrail — чтобы не аллоцировать пути в каждом кадре.
	 */
	function buildTrail(v, frames, duration, opts) {
		const nb = frames.nb;
		const buckets = opts.buckets ?? 32;
		const stride = opts.stride ?? 3;
		const last = Math.min(frames.count, opts.upTo !== undefined ? Math.max(2, Math.ceil(opts.upTo * frames.fps)) : frames.count);
		const dur = Math.max(0.25, duration);
		const paths = new Array(nb * buckets).fill(null);

		for (let b = 0; b < nb; b++) {
			if (!opts.styles[b]) continue;
			let px = X(v, frames.x(0, b));
			let py = Y(v, frames.y(0, b));
			for (let i = stride; i < last; i += stride) {
				const i2 = Math.min(last - 1, i);
				const ex = X(v, frames.x(i2, b));
				const ey = Y(v, frames.y(i2, b));
				const t0 = Math.min(frames.time[i], frames.time[i2]);
				const k = Math.max(0, Math.min(buckets - 1, Math.round((t0 / dur) * (buckets - 1))));
				let p = paths[b * buckets + k];
				if (!p) {
					p = new Path2D();
					paths[b * buckets + k] = p;
				}
				p.moveTo(px, py);
				p.lineTo(ex, ey);
				px = ex;
				py = ey;
			}
		}
		return { paths, buckets, styles: opts.styles, count: frames.count };
	}

	function drawTrail(ctx, cache) {
		if (!cache) return;
		const { paths, buckets, styles } = cache;
		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (let b = 0; b < styles.length; b++) {
			const st = styles[b];
			if (!st) continue;
			ctx.lineWidth = st.width;
			if (st.dash) ctx.setLineDash(st.dash);
			for (let k = 0; k < buckets; k++) {
				const p = paths[b * buckets + k];
				if (!p) continue;
				ctx.strokeStyle = timeColor(k / (buckets - 1), st.alpha);
				ctx.stroke(p);
			}
		}
		ctx.restore();
	}

	function drawTrajectories(ctx, v, frames, duration, opts) {
		drawTrail(ctx, buildTrail(v, frames, duration, opts));
	}

	function mix(a, b, k) {
		const A = hex(a);
		const B = hex(b);
		return `rgb(${(A[0] + (B[0] - A[0]) * k) | 0},${(A[1] + (B[1] - A[1]) * k) | 0},${(A[2] + (B[2] - A[2]) * k) | 0})`;
	}

	function drawBall(ctx, v, pos, rWorld, color, label, o = {}) {
		const cx = X(v, pos.x);
		const cy = Y(v, pos.y);
		const r = L(v, rWorld);
		ctx.save();
		if (o.ghost) ctx.globalAlpha = 0.45;

		ctx.beginPath();
		ctx.ellipse(cx + r * 0.25, cy + r * 0.55, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(0,0,0,.30)";
		ctx.fill();

		if (o.selected || o.hot) {
			ctx.beginPath();
			ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
			ctx.strokeStyle = o.selected ? "rgba(255,244,163,.95)" : `rgba(255,244,163,${0.35 + 0.4 * (o.hot ?? 0)})`;
			ctx.lineWidth = 2;
			ctx.stroke();
		}

		const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
		g.addColorStop(0, mix(color, "#ffffff", 0.72));
		g.addColorStop(0.42, color);
		g.addColorStop(1, mix(color, "#000000", 0.55));
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fillStyle = g;
		ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,.45)";
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.beginPath();
		ctx.arc(cx - r * 0.32, cy - r * 0.38, r * 0.24, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(255,255,255,.6)";
		ctx.fill();

		if (label) {
			ctx.beginPath();
			ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
			ctx.fillStyle = "rgba(12,20,16,.85)";
			ctx.fill();
			ctx.fillStyle = "rgba(255,255,255,.9)";
			ctx.font = `700 ${Math.max(7, r * 0.8)}px system-ui, sans-serif`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(label, cx, cy + 0.5);
		}
		ctx.restore();
	}

	function drawShot(ctx, v, shot, from, maxPower, o = {}) {
		const col = K.PLAYERS[shot.player]?.color ?? "#fff";
		const len = 0.1 + 0.62 * Math.min(1, shot.power / maxPower);
		const ex = from.x + Math.cos(shot.angle) * len;
		const ey = from.y + Math.sin(shot.angle) * len;
		const x0 = X(v, from.x);
		const y0 = Y(v, from.y);
		const x1 = X(v, ex);
		const y1 = Y(v, ey);
		ctx.save();
		ctx.lineCap = "round";
		ctx.setLineDash(o.selected ? [] : [9, 6]);
		ctx.strokeStyle = col;
		ctx.globalAlpha = o.selected ? 1 : 0.75;
		ctx.lineWidth = o.selected ? 3 : 2;
		ctx.beginPath();
		ctx.moveTo(x0, y0);
		ctx.lineTo(x1, y1);
		ctx.stroke();
		const a = Math.atan2(y1 - y0, x1 - x0);
		ctx.setLineDash([]);
		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.lineTo(x1 - Math.cos(a - 0.4) * 11, y1 - Math.sin(a - 0.4) * 11);
		ctx.lineTo(x1 - Math.cos(a + 0.4) * 11, y1 - Math.sin(a + 0.4) * 11);
		ctx.closePath();
		ctx.fillStyle = col;
		ctx.fill();

		if (o.selected) {
			ctx.beginPath();
			ctx.arc(x1, y1, 6.5, 0, Math.PI * 2);
			ctx.fillStyle = "#0d1a14";
			ctx.fill();
			ctx.strokeStyle = col;
			ctx.lineWidth = 2.5;
			ctx.stroke();
		}

		const text = `P${shot.player + 1} · t=${shot.t.toFixed(2)}с · F=${shot.power.toFixed(1)}`;
		ctx.font = `600 10px ui-monospace, monospace`;
		ctx.textAlign = "center";
		const tw = ctx.measureText(text).width + 12;
		ctx.globalAlpha = 1;
		ctx.fillStyle = "rgba(6,16,12,.82)";
		roundRect(ctx, x1 - tw / 2, y1 + 10, tw, 15, 7);
		ctx.fill();
		ctx.strokeStyle = o.live ? "#fff4a3" : "rgba(255,255,255,.16)";
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.fillStyle = o.live ? "#fff4a3" : "rgba(255,255,255,.85)";
		ctx.textBaseline = "middle";
		ctx.fillText(text, x1, y1 + 18);
		ctx.restore();
	}

	function drawPowerArc(ctx, v, pos, angle, power, maxPower) {
		const cx = X(v, pos.x);
		const cy = Y(v, pos.y);
		const r = L(v, 0.14);
		const k = Math.min(1, power / maxPower);
		ctx.save();
		ctx.lineCap = "round";
		ctx.lineWidth = 5;
		ctx.strokeStyle = "rgba(255,255,255,.16)";
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.stroke();
		ctx.strokeStyle = timeColor(1 - k);
		ctx.beginPath();
		ctx.arc(cx, cy, r, angle - Math.PI / 2, angle - Math.PI / 2 + Math.PI * 2 * k);
		ctx.stroke();
		ctx.restore();
	}

	Object.assign(K, {
		makeView, X, Y, L, unproject,
		timeRGB, timeColor,
		roundRect, drawTable, drawRoute, drawCheckpoint,
		drawTrajectories, buildTrail, drawTrail, drawBall, drawShot, drawPowerArc,
	});
});
