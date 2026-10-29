/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type Direction = 'N' | 'E' | 'S' | 'W';

export type RelativeTurn = 'FORWARD' | 'LEFT' | 'RIGHT' | 'BACK';

export interface GridConfig {
  mapWidth: number;
  mapHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  viewportPresets?: number[];
  viewportCanvasSize?: number;
  tilePixelSize: number;
  editorTilePixelSize: number;
  pixelArtGridSize: number;
}

export interface TimingConfig {
  tickIntervalMs: number;
  ticksPerSecond: number;
  playerMoveCooldownTicks: number;
  slideCooldownTicks: number;
  animationFrameTicks: number;
  maxUndoSnapshots: number;
  timeBonusMultiplier: number;
  levelBasePoints: number;
  goldTimeRatio?: number;
  silverTimeRatio?: number;
  lowTimeWarningSeconds?: number;
}

export interface UserSettings {
  locale?: string;
  fov?: number;
  themeId?: string;
  graphicsStyle?: GraphicsStyle;
  shellEnabled?: boolean;
  sfxEnabled?: boolean;
  musicEnabled?: boolean;
}

export interface StorageConfig {
  saveSlotKey: string;
  customLevelsKey: string;
  settingsKey: string;
  highScoresKey: string;
  activePackKey: string;
  levelPacksDbName: string;
  levelPacksStoreName: string;
}

export type GraphicsStyle = 'modern' | 'retro';

export interface GraphicsConfig {
  defaultStyle: GraphicsStyle;
  defaultTheme?: string;
  entityLerpFactor: number;
  cameraLerpFactor: number;
  teleportSnapDistance: number;
  maxParticles: number;
  particleBurstCount: number;
  screenShakeExplosion?: number;
  screenShakeDecay?: number;
}

export interface ThemePalette {
  id: string;
  i18nKey: string;
  floorTop: string;
  floorBottom: string;
  floorGrid: string;
  wallTop: string;
  wallBottom: string;
  wallBevel: string;
  accentGlow: string;
}

/** A lock on a hub wing and the item that opens it. */
export interface HubGateConfig {
  terrain: string;
  item: string;
  /** Turn the terrain to push back toward the hub (a force floor). */
  orientTowardHub?: boolean;
}

/** Hub layout: an open room the player starts in, with locked wings around it. */
export interface HubConfig {
  /** First level built as a hub; earlier levels stay a simple chain. */
  fromLevel: number;
  width: number;
  height: number;
  /** Largest offset of the hub from the map centre, drawn per attempt. */
  maxShift: number;
  /** Wings open from the start, so the player chooses where to begin. */
  openWings: number;
  maxConnectorLength: number;
  rewardRoomWidth: number;
  rewardRoomDepth: number;
  rewardChips: number;
  hubChips: number;
  /** Depth of a hazard lock, in cells. */
  hazardDepth: number;
  /** Failed attempts after which a level drops one puzzle to fit around the hub. */
  attemptsPerDroppedPiece: number;
  doorGates: HubGateConfig[];
  hazardGates: HubGateConfig[];
}

/** Weights and targets of the best-of-N level selection (see LevelScorer). */
export interface ProceduralScoringConfig {
  /** Candidates built per level; the best scoring one is kept. */
  candidates: number;
  targetMovesBase: number;
  targetMovesPerLevel: number;
  /** Relative distance to the target length at which lengthFit reaches 0. */
  lengthTolerance: number;
  /** Corridor share at which the corridor term reaches 0. */
  corridorShareCeiling: number;
  revisitLow: number;
  revisitHigh: number;
  weightLength: number;
  weightJunction: number;
  weightCorridor: number;
  weightRevisit: number;
  weightVariety: number;
}

export interface ProceduralConfig {
  defaultLevelCount: number;
  maxGenerationAttempts: number;
  /** Pieces in level 1; one more every levelsPerExtraPiece levels, up to maxPieceCount. */
  basePieceCount: number;
  levelsPerExtraPiece: number;
  maxPieceCount: number;
  /** Distinct motifs per level, indexed by level number - 1; the last value repeats. */
  motifCountByLevel: number[];
  /** Highest piece tier allowed, indexed like motifCountByLevel. */
  maxTierByLevel: number[];
  /** Side of the square area the level is built in, growing with the level number. */
  baseRegionSize: number;
  regionGrowthPerLevel: number;
  /** Extra side length given to each new attempt after a layout failure. */
  regionGrowthPerRetry: number;
  placementSamplesPerPiece: number;
  minCorridorLength: number;
  maxCorridorLength: number;
  /** A rest room follows every this many puzzle pieces; 0 disables them. */
  restRoomEvery: number;
  /** From this level on, puzzles are drawn from the hardest tier allowed. */
  hardPiecesFromLevel: number;
  /** First level allowed to use pieces marked oneShot in motifs.json. */
  oneShotFromLevel: number;
  /** Depth of the side alcove holding boots a piece needs. */
  bootAlcoveLength: number;
  /** Levels up to this number have no time limit. */
  untimedUpToLevel: number;
  /** Thinking time granted per puzzle piece, on top of the stretched run time. */
  thinkSecondsPerPiece: number;
  /** Time limit over the proven solution time. */
  timeSlackFactor: number;
  timeRoundingSeconds: number;
  minTimeLimitSeconds: number;
  scoring: ProceduralScoringConfig;
  hub: HubConfig;
}

export interface KeybindingsConfig {
  moveUp: string[];
  moveDown: string[];
  moveLeft: string[];
  moveRight: string[];
  undo: string[];
  restart: string[];
  pause: string[];
  nextLevel: string[];
  prevLevel: string[];
  toggleShell: string[];
  toggleMute: string[];
  cycleFov?: string[];
  toggleGraphics?: string[];
  cycleTheme?: string[];
  generateProcedural?: string[];
  showObjective?: string[];
  toggleFullscreen?: string[];
  toggleHelp?: string[];
}

export interface UltimatePackDescriptor {
  id: string;
  name: string;
  i18nKey: string;
  url: string;
  prefix: string;
}

export interface TouchConfig {
  swipeDeadzonePx: number;
  tapMaxDistancePx: number;
  tapMaxDurationMs: number;
  pinchZoomStepPx: number;
  hapticPulseMs: number;
}

export interface GameConfig {
  grid: GridConfig;
  graphics?: GraphicsConfig;
  themes?: Record<string, ThemePalette>;
  procedural?: ProceduralConfig;
  touch?: TouchConfig;
  ultimatePacks?: UltimatePackDescriptor[];
  timing: TimingConfig;
  storage: StorageConfig;
  locales: {
    supported: string[];
    default: string;
  };
  keybindings: KeybindingsConfig;
  palette: Record<string, string>;
}

export interface TileDefinition {
  id: string;
  category: string;
  layer: 'terrain' | 'item';
  i18nKey: string;
  passableByPlayer?: boolean;
  passableByMonster?: boolean;
  passableByBlock?: boolean;
  transformsToOnStep?: string;
  revealsToOnTouch?: string;
  requiresAllChips?: boolean;
  transformsToOnUnlock?: string;
  isLevelExit?: boolean;
  showsHint?: boolean;
  hazard?: 'water' | 'fire' | 'bomb';
  protectedByItem?: string;
  blockTransformsTo?: string;
  slideType?: 'ice' | 'force';
  blockedEntryDirections?: Direction[];
  blockedEdges?: Direction[];
  deflectionMap?: Partial<Record<Direction, Direction>>;
  forceDirection?: Direction | 'RANDOM';
  stealsBoots?: boolean;
  requiredKey?: string;
  consumesKey?: boolean;
  colorKey?: string;
  collectible?: 'key' | 'chip' | 'boot';
  buttonAction?: 'toggle_walls' | 'reverse_tanks' | 'hold_trap' | 'trigger_cloner';
  togglesTo?: string;
  isTeleporter?: boolean;
  isTrap?: boolean;
  isCloneMachine?: boolean;
}

export interface TilesConfig {
  categories: Array<{ id: string; i18nKey: string }>;
  tiles: Record<string, TileDefinition>;
}

export interface EntityDefinition {
  id: string;
  category: string;
  kind: 'block' | 'monster';
  i18nKey: string;
  pushable?: boolean;
  slidesOnFloor?: boolean;
  slidesOnIce?: boolean;
  slidesOnForce?: boolean;
  waterTransformsTo?: string;
  meltsInFireTo?: string;
  destroyedByFire?: boolean;
  destroyedByBomb?: boolean;
  moveIntervalTicks?: number;
  movementPattern?: string;
  turnOrder?: RelativeTurn[];
  immuneToWater?: boolean;
  immuneToFire?: boolean;
  avoidsFire?: boolean;
  /** Turned around when a reverse_tanks button is pressed. */
  reversedByButton?: boolean;
}

export interface MonstersConfig {
  entities: Record<string, EntityDefinition>;
}

export interface AudioNote {
  freq: number;
  durationMs: number;
  gain: number;
}

export interface AudioEffectConfig {
  waveform: OscillatorType;
  notes: AudioNote[];
}

export interface MusicTrackConfig {
  id: string;
  i18nKey: string;
  stepDurationMs: number;
  leadWaveform: OscillatorType;
  bassWaveform: OscillatorType;
  leadNotes: number[];
  bassNotes: number[];
}

export interface AudioConfig {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  effects: Record<string, AudioEffectConfig>;
  music: {
    stepDurationMs: number;
    leadWaveform: OscillatorType;
    bassWaveform: OscillatorType;
    leadNotes: number[];
    bassNotes: number[];
  };
  tracks?: MusicTrackConfig[];
}

export interface DatElementMapping {
  kind: 'terrain' | 'item' | 'entity' | 'player';
  id: string;
  dir?: Direction;
  isClonerTemplate?: boolean;
}

export interface DatFormatConfig {
  magicHeaders: number[];
  defaultMagicHeader: number;
  rleMarkerByte: number;
  passwordXorKey: number;
  layerByteLength: number;
  /** Upper bound on the level count read from a pack header. */
  maxLevelCount?: number;
  fieldCodes: {
    timeLimit: number;
    chipsRequired: number;
    title: number;
    trapLinks: number;
    cloneLinks: number;
    encryptedPassword: number;
    hint: number;
    plainPassword: number;
    monsterList: number;
  };
  byteToElement: Record<string, DatElementMapping>;
}

export interface TrapLink {
  buttonX: number;
  buttonY: number;
  trapX: number;
  trapY: number;
}

export interface CloneLink {
  buttonX: number;
  buttonY: number;
  clonerX: number;
  clonerY: number;
  templateType: string;
  templateDir: Direction;
}

export interface EntityPlacement {
  x: number;
  y: number;
  type: string;
  dir: Direction;
}

export interface LevelBlueprint {
  id: string;
  number: number;
  titleKey?: string;
  customTitle?: string;
  hintKey?: string;
  customHint?: string;
  password: string;
  timeLimitSeconds: number;
  chipsRequired: number;
  playerStart: { x: number; y: number; dir: Direction };
  rows?: string[];
  terrain?: string[][];
  terrainOverrides?: Array<{ x: number; y: number; id: string }>;
  /** Item placements, or a full item grid as the editor exports it. */
  items?: Array<{ x: number; y: number; id: string }> | (string | null)[][];
  itemGrid?: (string | null)[][];
  entities: EntityPlacement[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
}

export interface LevelsConfig {
  legend: Record<string, { terrain: string; item?: string }>;
  levels: LevelBlueprint[];
}

export interface CompiledLevel {
  id: string;
  number: number;
  titleKey?: string;
  customTitle?: string;
  hintKey?: string;
  customHint?: string;
  password: string;
  timeLimitSeconds: number;
  chipsRequired: number;
  playerStart: { x: number; y: number; dir: Direction };
  terrain: string[][];
  items: (string | null)[][];
  entities: EntityPlacement[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
}

export interface LevelPack {
  id: string;
  name: string;
  i18nKey?: string;
  builtIn?: boolean;
  levels: CompiledLevel[];
}

export interface RuntimeEntity {
  uid: number;
  type: string;
  kind: 'block' | 'monster';
  x: number;
  y: number;
  dir: Direction;
  cooldownTicks: number;
  isSliding: boolean;
}

export interface PlayerState {
  x: number;
  y: number;
  dir: Direction;
  alive: boolean;
  deathReasonKey: string | null;
  isSliding: boolean;
  slideDir: Direction | null;
  moveCooldown: number;
  slideCooldown: number;
  inWater: boolean;
  keys: Record<string, number>;
  boots: Set<string>;
}

/** A player move stamped with the engine tick at which it was applied. */
export interface TimedMove {
  tick: number;
  dir: Direction;
}

export interface UndoSnapshot {
  terrain: string[][];
  items: (string | null)[][];
  entities: RuntimeEntity[];
  player: {
    x: number;
    y: number;
    dir: Direction;
    isSliding: boolean;
    slideDir: Direction | null;
    moveCooldown: number;
    slideCooldown: number;
    inWater: boolean;
    keys: Record<string, number>;
    boots: string[];
  };
  chipsRemaining: number;
  ticksElapsed: number;
  stepsCount: number;
  totalScore: number;
  rngState: number;
  nextEntityUid: number;
  moveHistoryLength: number;
  timedMoveHistoryLength: number;
}

export interface LevelHighScore {
  bestTimeRemaining: number;
  minSteps: number;
  bestScore: number;
  replayMoves?: Direction[];
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  i18nKey: string;
  params?: Record<string, string | number>;
}

export interface LevelValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  stats: {
    chipsPlaced: number;
    chipsRequired: number;
    exitCount: number;
    reachableChips: number;
    reachableExit: boolean;
  };
}
