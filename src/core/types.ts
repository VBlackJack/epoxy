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
  /** LCD pixel grid over the 16-Bit Retro view. */
  lcdEnabled?: boolean;
  /** 'auto', or a fixed quality level: 'high', 'medium' or 'low'. */
  graphicsQuality?: string;
  sfxEnabled?: boolean;
  musicEnabled?: boolean;
}

export interface StorageConfig {
  saveSlotKey: string;
  customLevelsKey: string;
  settingsKey: string;
  highScoresKey: string;
  activePackKey: string;
  lastProceduralSeedKey: string;
  lastEndlessKey: string;
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

/** A scarce colour for `fromPieces` puzzles, one more every `piecesPerGate`, up to `max`. */
export interface HubScarceConfig {
  fromPieces: number;
  piecesPerGate: number;
  max: number;
}

/** Monsters left to wander the hub region of a loop level, by difficulty. */
export interface HubOpenMonstersConfig {
  /** Planned puzzles from which the hub region holds a monster; below it, none. */
  fromPieces: number;
  /** One more monster for each this many puzzles past `fromPieces`. */
  piecesPerMonster: number;
  /** Most monsters in the hub region. */
  max: number;
  /** Deterministic movers allowed in the open: monster ids from monsters.json. */
  types: string[];
  /** Fewest cells, in steps on the grid, between a monster's start and the player's start. */
  minStartDistance: number;
  /** Fewest cells a monster's path must cover for the lane to count. */
  minLaneCells: number;
  /** Most cells a monster's path may cover; longer ones make the timed search costly. */
  maxLaneCells: number;
  /** Starts tried for each monster; the best lane is kept. */
  startSamples: number;
  /** Ticks simulated to trace a monster's path before it is taken for a cycle. */
  laneTraceSteps: number;
}

/** Chips scattered over the hub region of a loop level, by difficulty. */
export interface HubOpenChipsConfig {
  min: number;
  max: number;
  /** One more chip for each this many planned puzzles. */
  piecesPerExtra: number;
  /** Share of the chips that lie within `nearLaneDistance` of a monster's lane. */
  nearLaneShare: number;
  nearLaneDistance: number;
  /** Candidate cells ranked per chip before the connectivity check settles one. */
  placementSamples: number;
}

/** Fire and water patches in the hub region: obstacles that shape movement, never on a lane. */
export interface HubOpenHazardsConfig {
  /** Patches placed; fewer when the region has no room. */
  patches: number;
  /** Cells of each patch, grown from a seed cell. */
  patchCells: number;
  /** Hazard tile ids drawn from, one per patch. */
  terrains: string[];
  /** Cells kept between a patch and any monster lane, so no monster can step into it. */
  laneClearance: number;
  /** Cells kept between a patch and the player's start. */
  startClearance: number;
}

/** Wall bars set into the open parts of the hub region: they cut it into lanes. */
export interface HubOpenDividersConfig {
  max: number;
  minLength: number;
  maxLength: number;
  /** Open cells kept all around a bar, so it never closes a lane against a wall. */
  clearance: number;
  /** Fewest cells, in either direction, from a bar to the next one: the lane between is this wide less one. */
  separation: number;
  /** Bars tried before the search for room gives up. */
  attempts: number;
}

/** A hub outline: '.' is floor, anything else stays wall (pillars, cut corners). */
export interface HubShapeConfig {
  id: string;
  rows: string[];
}

/** Hub layout: an open room the player starts in, with locked wings around it. */
export interface HubConfig {
  /** First level built as a hub; earlier levels stay a simple chain. */
  fromLevel: number;
  /** One outline is drawn per attempt, so hubs differ from level to level. */
  shapes: HubShapeConfig[];
  /** Largest offset of the hub from the map centre, drawn per attempt. */
  maxShift: number;
  /** Wings open from the start, so the player chooses where to begin. */
  openWings: number;
  maxConnectorLength: number;
  /** Reward room sizes, one drawn per room. */
  rewardRoomWidths: number[];
  rewardRoomDepths: number[];
  /** Rooms at least this wide and deep get a pillar in the middle. */
  rewardRoomPillarMinSize: number;
  rewardChips: number;
  /** Chips lying in a dead-end level's hub; a loop level has `openChips` instead. */
  hubChips: number;
  /** Depth of a hazard lock, in cells. */
  hazardDepth: number;
  /** Placements that fit tried per wing; the cheapest in density is kept. */
  wingPlacementSamples: number;
  /** Layouts built per attempt for the same wings; the one filling its bounding box best is kept. */
  layoutSamples: number;
  /** Floor cells the hub may gain in the gaps around it, within the level's bounds. */
  bayCells: number;
  /** Cells a loop level's hub region may gain at its edge, a layer at a time, once its bays are grown. */
  loopFringeCells: number;
  /** Layouts of a loop level tried for one plan before it is given up. */
  loopLayoutSamples: number;
  /** Layouts of a loop level compared before the most compact is kept; trying stops at this many that fit. */
  loopLayoutKeep: number;
  /** Floor cells a loop level may gain in the gaps around its hub, corridors and rooms. */
  loopBayCells: number;
  /** Fill the level aims for: a wing's bounding box growth is weighed at this rate against the cells it adds. */
  fillTarget: number;
  /** Failed attempts after which a level drops one puzzle to fit around the hub. */
  attemptsPerDroppedPiece: number;
  /**
   * Generation modes whose hubs use loop wings: a chain of puzzles that leaves the hub
   * through its gate and comes back through a one-way strip, instead of a dead end.
   */
  loopModes: string[];
  /** Most puzzles chained in one loop wing. */
  maxPiecesPerWing: number;
  /** The one-way strip a loop wing returns through; its item must never be in a loop level. */
  returnGate: HubGateConfig;
  /** Depth of the return strip, in cells. */
  returnDepth: number;
  /** Longest corridor, in cells, searched between the last puzzle of a loop wing and its return strip. */
  maxReturnLength: number;
  /** Longest corridor, in cells, between two puzzles of a loop wing. */
  maxLinkLength: number;
  /** How many door colours are scarce in a loop level, by the number of planned puzzles. */
  scarceGates: HubScarceConfig;
  /**
   * Whether a scarce level can always be finished: a spare key lies behind the later door,
   * so the wrong order only costs a detour. Off, the wrong order strands the player and
   * the level is restarted, as in the original game.
   */
  scarceRecovery: boolean;
  /** Most box area, in cells, the puzzles of a loop level may add up to; larger ones are swapped for smaller siblings. */
  puzzleAreaBudget: number;
  /** Placements of a wing tried one after the other when the wings after it find no room. */
  wingAlternatives: number;
  /** Wing placement searches spent on one layout before it is given up. */
  backtrackBudget: number;
  /** Way-back searches a loop wing may spend on one gate before it gives up on it. */
  returnAttempts: number;
  /** Weight, against a cell of bounding box growth, of each cell a puzzle leans against what is already there. */
  contactWeight: number;
  /** Weight of the distance, in cells, between the last puzzle of a loop wing and the hub's wall ring. */
  returnDistanceWeight: number;
  /** Placements tried for each further puzzle of a loop wing; the one growing the level least is kept. */
  chainPlacementSamples: number;
  /** Tile that closes the hub region at every gate and strip end: the player crosses it, monsters do not. */
  apronTerrain: string;
  /** Monsters wandering the hub region of a loop level. */
  openMonsters: HubOpenMonstersConfig;
  /** Chips in the hub region of a loop level; they replace `hubChips` there. */
  openChips: HubOpenChipsConfig;
  openHazards: HubOpenHazardsConfig;
  openDividers: HubOpenDividersConfig;
  doorGates: HubGateConfig[];
  hazardGates: HubGateConfig[];
}

/** Weights and targets of the best-of-N level selection (see LevelScorer). */
export interface ProceduralScoringConfig {
  /** Candidates built per level; the best scoring one is kept. */
  candidates: number;
  targetMovesBase: number;
  targetMovesPerLevel: number;
  /** Ceiling of the target run length, so the target stops growing with the level number. */
  targetMovesMax: number;
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
  /** Dead-end share of the playfield at which the dead-end term reaches 0. */
  deadShareCeiling: number;
  /** Band of moves walked between pieces per move spent inside them that scores full marks. */
  walkPerDecisionLow: number;
  walkPerDecisionHigh: number;
  weightDeadEnd: number;
  weightWalk: number;
}

/** Difficulty curve of endless mode: full difficulty from level 1, then a capped growth. */
export interface EndlessConfig {
  pieceCountStart: number;
  pieceCountMax: number;
  levelsPerExtraPiece: number;
  motifCountStart: number;
  motifCountMax: number;
  levelsPerExtraMotif: number;
  maxTierStart: number;
  maxTierMax: number;
  levelsPerExtraTier: number;
  targetMovesStart: number;
  targetMovesPerLevel: number;
  targetMovesMax: number;
  /**
   * Share of levels that must carry a motif, by motif id: the motif is added to
   * the level's focus with this probability, drawn from the level's stream.
   */
  motifShares: Record<string, number>;
}

/** Page side tunables of the endless mode (generation tunables live in ProceduralConfig). */
export interface EndlessUiConfig {
  /** Pause before a main thread generation, so the page can paint the progress message first. */
  fallbackYieldMs: number;
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
  /** Layouts built per attempt for the same chain; the one filling its bounding box best is kept. */
  layoutSamples: number;
  /**
   * Weight of the bounding-box growth in the score of a chain placement, in
   * units of corridor length per piece footprint of growth: higher packs
   * the level tighter, lower keeps corridors near their target length.
   */
  placementCompactness: number;
  minCorridorLength: number;
  maxCorridorLength: number;
  /** A rest room follows every this many puzzle pieces; 0 disables them. */
  restRoomEvery: number;
  /** From this level on, puzzles are drawn from the hardest tier allowed. */
  hardPiecesFromLevel: number;
  /** First level allowed to use pieces marked oneShot in motifs.json. */
  oneShotFromLevel: number;
  /** A piece must give each of its monsters at least this many box cells (bounding rectangle, walls included). */
  minBoxCellsPerMonster: number;
  /** Monsters all the pieces of one level may hold together. */
  maxMonstersPerLevel: number;
  /** Pieces with more dead ends than this are drawn only when the motif has nothing tidier. */
  maxPieceDeadEnds: number;
  /** Motifs whose puzzles can be failed for good; they come first in a level. */
  irreversibleMotifs: string[];
  /** Consecutive levels of a pack that must differ in lead motif and in hub shape. */
  noRepeatWindow: number;
  /**
   * Motifs never used as the puzzle of level 1 of a generated pack: timing
   * or hidden-rule puzzles make a poor first contact with the game.
   */
  firstLevelExcludedMotifs: string[];
  /** Levels up to this number have no time limit. */
  untimedUpToLevel: number;
  /** Thinking time granted per puzzle piece, on top of the stretched run time. */
  thinkSecondsPerPiece: number;
  /** Time limit over the proven solution time. */
  timeSlackFactor: number;
  timeRoundingSeconds: number;
  minTimeLimitSeconds: number;
  scoring: ProceduralScoringConfig;
  endless: EndlessConfig;
  hub: HubConfig;
  /** Visual theme given to a level, after its main motif. */
  motifThemes: Record<string, string>;
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
  showSolution?: string[];
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
  endlessUi?: EndlessUiConfig;
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
  theme?: string;
  solution?: string;
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
  /** Theme shown when the player lets the level choose; see game.json themes. */
  theme?: string;
  /** A proven winning action list (N, E, S, W, '.' to wait), for the solution replay. */
  solution?: string;
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
