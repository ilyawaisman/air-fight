import type { GamePreset, PresetId } from "./types.js";

export const GAME_PRESETS: Record<PresetId, GamePreset> = {
  duel: {
    id: "duel",
    label: "Duel",
    width: 24,
    height: 24,
    planes: 1,
    turrets: 0,
    obstacles: "any",
    metric: "linf",
  },
  classic: {
    id: "classic",
    label: "Classic",
    width: 24,
    height: 48,
    planes: 3,
    turrets: 1,
    obstacles: "any",
    metric: "linf",
  },
  tactical: {
    id: "tactical",
    label: "Tactical",
    width: 28,
    height: 56,
    planes: 7,
    turrets: 1,
    obstacles: "any",
    metric: "linf",
  },
};

export function isPresetId(value: string): value is PresetId {
  return value === "duel" || value === "classic" || value === "tactical";
}
