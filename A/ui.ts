import type { ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Panel({
	title,
	right,
	children,
	className,
}: {
	title: string;
	right?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={cx("panel rounded-md px-3 py-2.5", className)}>
			<header className="mb-2 flex items-center justify-between gap-2">
				<h2 className="eyebrow flex items-center gap-2">
					<span className="inline-block h-[10px] w-[2px] bg-brass-500" />
					{title}
				</h2>
				{right}
			</header>
			<div className="rule mb-2.5" />
			{children}
		</section>
	);
}

export function Slider({
	label,
	value,
	min,
	max,
	step = 0.01,
	onChange,
	unit,
	digits = 2,
	knob = "#ffb703",
	hint,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange: (v: number) => void;
	unit?: string;
	digits?: number;
	knob?: string;
	hint?: string;
}) {
	return (
		<label className="group block select-none" title={hint}>
			<div className="mb-0.5 flex items-baseline justify-between gap-2">
				<span className="text-[11px] font-medium tracking-wide text-chalk/70 group-hover:text-chalk">{label}</span>
				<span className="mono text-[11px] text-brass-400">
					{value.toFixed(digits)}
					{unit ? <span className="text-chalk/40">{unit}</span> : null}
				</span>
			</div>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				style={{ ["--knob" as string]: knob }}
				onChange={(e) => onChange(parseFloat(e.target.value))}
			/>
		</label>
	);
}

export function Seg<T extends string>({
	value,
	options,
	onChange,
	size = "sm",
}: {
	value: T;
	options: { v: T; label: string; icon?: ReactNode }[];
	onChange: (v: T) => void;
	size?: "sm" | "md";
}) {
	return (
		<div className="flex gap-1 rounded-md border border-white/10 bg-black/35 p-1">
			{options.map((o) => (
				<button
					key={o.v}
					onClick={() => onChange(o.v)}
					className={cx(
						"flex flex-1 items-center justify-center gap-1.5 rounded font-display uppercase tracking-[0.12em] transition-all duration-150",
						size === "sm" ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-[12px]",
						value === o.v
							? "bg-brass-500 text-[#10240f] shadow-[0_0_18px_-4px_rgba(255,183,3,.8)]"
							: "text-chalk/60 hover:bg-white/8 hover:text-chalk",
					)}
				>
					{o.icon}
					{o.label}
				</button>
			))}
		</div>
	);
}

export function Btn({
	children,
	onClick,
	variant = "ghost",
	disabled,
	className,
	title,
}: {
	children: ReactNode;
	onClick?: () => void;
	variant?: "ghost" | "solid" | "danger";
	disabled?: boolean;
	className?: string;
	title?: string;
}) {
	return (
		<button
			title={title}
			disabled={disabled}
			onClick={onClick}
			className={cx(
				"inline-flex items-center justify-center gap-1.5 rounded border font-display text-[11px] uppercase tracking-[0.14em] transition-all duration-150 active:scale-[.97]",
				variant === "solid" &&
					"border-brass-600/60 bg-brass-500 text-[#10240f] hover:bg-brass-400 hover:shadow-[0_0_22px_-4px_rgba(255,183,3,.9)]",
				variant === "ghost" && "border-white/12 bg-white/4 text-chalk/80 hover:border-brass-500/50 hover:text-chalk",
				variant === "danger" && "border-clay/40 bg-clay/12 text-clay hover:bg-clay/22",
				disabled && "pointer-events-none opacity-35",
				className,
			)}
		>
			{children}
		</button>
	);
}

export function Stat({
	label,
	value,
	sub,
	accent = "#f4efe1",
	wide,
}: {
	label: string;
	value: ReactNode;
	sub?: string;
	accent?: string;
	wide?: boolean;
}) {
	return (
		<div className={cx("rounded border border-white/8 bg-black/25 px-2 py-1.5", wide && "col-span-2")}>
			<div className="eyebrow text-[9px] opacity-70">{label}</div>
			<div className="mono text-[15px] leading-tight" style={{ color: accent }}>
				{value}
			</div>
			{sub ? <div className="text-[10px] text-chalk/40">{sub}</div> : null}
		</div>
	);
}

export function Check({ ok, label, note }: { ok: boolean; label: string; note?: string }) {
	return (
		<div className="flex items-start gap-2 py-[3px]">
			<span
				className={cx(
					"mono mt-[1px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] text-[10px]",
					ok ? "bg-[#7ee2a8]/18 text-[#7ee2a8]" : "bg-clay/15 text-clay",
				)}
			>
				{ok ? "✓" : "✕"}
			</span>
			<span className="text-[11px] leading-tight text-chalk/78">
				{label}
				{note ? <span className="mono ml-1 text-chalk/45">{note}</span> : null}
			</span>
		</div>
	);
}

export function Badge({ children, color = "#ffb703" }: { children: ReactNode; color?: string }) {
	return (
		<span
			className="rounded-sm border px-1.5 py-[1px] font-display text-[9px] uppercase tracking-[0.16em]"
			style={{ color, borderColor: `${color}55`, background: `${color}12` }}
		>
			{children}
		</span>
	);
}
