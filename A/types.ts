/** Крибил / Cue Crew — общие типы модели. */

export interface Vec {
	x: number;
	y: number;
}

export type BallKind = "object" | "cue";

/** Инициализация шара ( planning state ). */
export interface BallInit {
	id: string;
	kind: BallKind;
	/** индекс игрока команды для битка, -1 для игрового шара */
	owner: number;
	x: number;
	y: number;
	vx?: number;
	vy?: number;
	mass: number;
	color: string;
	label: string;
}

/** Контрольная точка: шар 1 должен пройти её в порядке номера. */
export interface Checkpoint {
	id: number;
	x: number;
	y: number;
	r: number;
}

/** Удар игрока: в момент t биток получает импульс power в направлении angle. */
export interface Shot {
	id: string;
	player: number;
	t: number;
	angle: number;
	power: number;
	locked?: boolean;
}

export interface TableSpec {
	/** игровая зона (между бортами), в "метрах" */
	w: number;
	h: number;
	/** ширина деревянной рамки */
	rail: number;
}

export interface PhysicsParams {
	/** коэффициент линейного трения (1/с), 0 = лед */
	friction: number;
	/** восстановление при ударе шар-шар (1 = абсолютно упруго) */
	restitution: number;
	/** восстановление борта */
	cushion: number;
	/** порог остановки */
	stopEps: number;
	/** радиус шара (единый для всех) */
	ballRadius: number;
	/** масса игрового шара 1 */
	objectMass: number;
	/** масса битка */
	cueMass: number;
}

export const DEFAULT_PHYSICS: PhysicsParams = {
	friction: 0.55,
	restitution: 1,
	cushion: 0.92,
	stopEps: 0.02,
	ballRadius: 0.03,
	objectMass: 1,
	cueMass: 1,
};

/** План команды: расстановка битков + список ударов. */
export interface Plan {
	cues: Vec[];
	shots: Shot[];
}

/** Редактируемый документ: всё, что видит планировщик. */
export interface Doc {
	object: Vec;
	cues: Vec[];
	checkpoints: Checkpoint[];
	shots: Shot[];
	physics: PhysicsParams;
	maxTime: number;
	maxPower: number;
}

export type PlacementMode = "free" | "locked";
export type PointerMode = "drag" | "aim";
export type AppMode = "planner" | "live";
