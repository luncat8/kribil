/* Ручной дымовой тест UI под jsdom (НЕ в наборе npm test):
	 npx --yes jsdom  (или: npm i -D jsdom)  && node tests/dom.smoke.js
	 Проверяет инициализацию панелей, прохождение решателя через кнопку,
	 применение плана, JSON-копию/вставку и живой режим с выстрелом человека. */
"use strict";
let JSDOM;
try {
	({ JSDOM } = require("jsdom"));
} catch {
	console.log("jsdom не установлен — тест пропущен (npm i -D jsdom)");
	process.exit(0);
}
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { url: "file:///x/index.html", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const document = window.document;
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); };

const noop = () => {};
window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
	get(t, k) {
		if (k === "measureText") return () => ({ width: 10 });
		if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop: noop });
		if (typeof k === "string") return noop;
	},
	set: () => true,
});
window.HTMLCanvasElement.prototype.setPointerCapture = noop;
window.HTMLCanvasElement.prototype.releasePointerCapture = noop;
window.Path2D = class Path2D { moveTo() {} lineTo() {} arc() {} };
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 620, right: 1200, bottom: 620 });

let T = 1000;
const raf = [];
window.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
const pump = (n) => {
	for (let i = 0; i < n; i++) { T += 20; const cbs = raf.splice(0); cbs.forEach((f) => f(T)); }
};

for (const f of ["core", "geo", "physics", "traj", "levels", "simulate", "bots", "optimizer", "realtime", "render", "app"])
	window.eval(fs.readFileSync(path.join(ROOT, "js", `${f}.js`), "utf8"));
document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
pump(5);

assert(document.querySelectorAll("#cpDots .dot").length === 4, "4 точки в HUD");
assert(document.querySelectorAll("#tab-setup input[type=range]").length === 8, "8 слайдеров физики");

document.querySelector('.tabs button[data-tab="crew"]').click();
pump(1);
document.querySelectorAll("#tab-crew .player .mini")[0].click();
pump(3);
assert(document.querySelectorAll("#tab-crew .shot").length === 1, "ручной удар добавляется в команду");

document.querySelector('.tabs button[data-tab="solve"]').click();
pump(2);
[...document.querySelectorAll("#tab-solve button")].find((b) => b.textContent.includes("решить")).click();
let banner = "";
for (let i = 0; i < 4000; i++) {
	pump(1);
	banner = document.getElementById("banner").textContent;
	if (banner.startsWith("РЕШЕНО")) break;
}
assert(banner.startsWith("РЕШЕНО"), `решатель через кнопку: "${banner}"`);
const checks = [...document.querySelectorAll("#st-checks .check")];
assert(checks.length === 6 && checks.every((c) => c.textContent.includes("✓")), "весь чек-лист зелёный");
document.querySelector('.tabs button[data-tab="crew"]').click();
pump(1);
assert(document.querySelectorAll("#tab-crew .shot").length >= 4, "план решателя лёг в карточки игроков");

document.querySelector('.tabs button[data-tab="setup"]').click();
pump(1);
[...document.querySelectorAll("#tab-setup button")].find((b) => b.textContent.includes("копия")).click();
pump(1);
const saved = document.getElementById("ioText").value;
const parsed = JSON.parse(saved);
assert(Array.isArray(parsed.doc.shots) && parsed.doc.shots.length >= 4, "копия содержит решённый план");
document.getElementById("ioModal").close();

[...document.querySelectorAll("#tab-setup button")].find((b) => b.textContent.includes("вставить")).click();
const ta = document.getElementById("ioText");
ta.value = "{ broken";
[...document.querySelectorAll("#ioActions button")].find((b) => b.textContent.includes("применить")).click();
pump(1);
assert([...document.querySelectorAll("#toast .t")].some((t) => t.textContent.includes("JSON")), "битый JSON отбит");
ta.value = JSON.stringify(window.Kribil.defaultDoc());
[...document.querySelectorAll("#ioActions button")].find((b) => b.textContent.includes("применить")).click();
pump(4);
assert(!document.getElementById("ioModal").open, "валидный JSON применён");

document.querySelector('#modeSeg button[data-mode="live"]').click();
pump(3);
document.getElementById("playBtn").click();
pump(5);
const canvas = document.getElementById("table");
canvas.dispatchEvent(new window.MouseEvent("pointerdown", { clientX: 700, clientY: 360, bubbles: true }));
canvas.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 620, clientY: 280, bubbles: true }));
setTimeout(() => {
	canvas.dispatchEvent(new window.MouseEvent("pointerup", { clientX: 620, clientY: 280, bubbles: true }));
	pump(60);
	const human = document.getElementById("note-0").textContent;
	assert(/ударов [1-9]/.test(human), `выстрел человека засчитан: "${human}"`);
	pump(600);
	assert(true, "живая партия прокрутилась без исключений");
	document.querySelector('#modeSeg button[data-mode="planner"]').click();
	pump(5);
	console.log(failures ? `DOM SMOKE FAILED (${failures})` : "DOM SMOKE OK");
	process.exit(failures ? 1 : 0);
}, 300);
