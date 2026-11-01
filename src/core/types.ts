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
  /** Default level width, used by the procedural generator and the .DAT codec. */
  mapWidth: number;
  /** Default level height, used by the procedural generator and the .DAT codec. */
  mapHeight: number;
  /** Smallest width or height accepted for a .json level or a custom pack. */
  minLevelSize: number;
  /** Largest width or height accepted for a .json level or a custom pack. */
  maxLevelSize: number;
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
  /** LCD pixel grid over the 16-Bit Retro view. */
  lcdEnabled?: boolean;
  /** Kenney skin on Sokoban levels; on unless explicitly false. */
  sokobanSkinEnabled?: boolean;
  /** 'auto', or a fixed quality level: 'high', 'medium' or 'low'. */
  graphicsQuality?: string;
  sfxEnabled?: boolean;
  musicEnabled?: boolean;
  /** 'default', 'random' or 'custom'; read back through sanitizeMusicSettings. */
  musicMode?: string;
  /** Ids of the tracks ticked for the 'custom' music mode. */
  musicCustomTracks?: string[];
}

export interface StorageConfig {
  saveSlotKey: string;
  customLevelsKey: string;
  settingsKey: string;
  highScoresKey: string;
  activePackKey: string;
  lastProceduralSeedKey: string;
  lastEndlessKey: string;
  /** Flag set once the first-launch "How to play" dialog was shown. */
  onboardingSeenKey: string;
  levelPacksDbName: string;
  levelPacksStoreName: string;
}

/** Limits applied to files the player imports. */
export interface ImportConfig {
  /** Largest file read for import, in bytes. */
  maxFileBytes: number;
}

/** Render styles: 'retro' is the 16-Bit Retro id (kept so saved settings stay valid). */
export type GraphicsStyle = 'modern' | 'retro' | 'retro32';

/**
 * Images that replace the drawn tiles and blocks on Sokoban levels. Files are relative to
 * `baseUrl`; a terrain role lists layers drawn bottom to top.
 */
export interface SokobanSkinConfig {
  baseUrl: string;
  /** Tile id to the image layers that draw it. */
  terrain: Record<string, string[]>;
  /** Entity type to the image that draws it. */
  entities: Record<string, string>;
  /** Image for a pushable block standing on a block target. */
  blockOnTarget: string;
}

export interface GraphicsConfig {
  defaultStyle: GraphicsStyle;
  sokobanSkin?: SokobanSkinConfig;
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
  /** Music track played with this biome in the 'default' music mode; see audio.json tracks. */
  musicTrackId?: string;
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
  /** At least one chip for each this many cells of the hub region, so the content grows with the floor. */
  regionCellsPerChip: number;
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

/**
 * How far the drawn hub outline of a loop level grows to cover the area its
 * puzzles leave free: the map interior less the puzzle boxes and a corridor
 * allowance per puzzle. The outline gains whole rows and columns of floor on
 * its sides until it covers the given share of that free area.
 */
export interface HubOutlineGrowthConfig {
  /** Cells of gate, corridors and return strip counted out of the free area per planned puzzle. */
  cellsPerPiece: number;
  /** Share of the free area the grown outline aims to cover; 0 keeps the drawn outlines. */
  freeAreaShare: number;
  /** Most floor cells the growth may add to a drawn outline. */
  maxCells: number;
  /**
   * Attempts of each tier (the first ones, which are the strict ones) that ask for the grown
   * outline; the rest use the drawn outline, so a plan that finds no room round the larger hub
   * gets its chances with the plain one before a puzzle is dropped.
   */
  growAttemptsPerTier: number;
}

/** How many pairs of puzzles hand something over (a block, a key) in a loop level, by planned puzzles. */
export interface HubDependencyConfig {
  fromPieces: number;
  piecesPerPair: number;
  max: number;
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
  /** Growth of the drawn outline in a loop level, by the area the planned puzzles leave free. */
  outlineGrowth: HubOutlineGrowthConfig;
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
  /**
   * Pairs of puzzles in a loop level where one exports a block or a key that the
   * other needs: none under `fromPieces` planned puzzles, one more per `piecesPerPair`, up to `max`.
   */
  dependencies: HubDependencyConfig;
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
  /**
   * Extra candidates tried one by one, after the first `candidates`, when none of those
   * could be built; the first that builds is kept. 0 turns the fallback off.
   */
  fallbackCandidates: number;
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
  /**
   * Failed attempts after which an endless level drops one puzzle, in place of
   * `hub.attemptsPerDroppedPiece`: a hub grown into the free area needs a few more
   * tries before a puzzle gives way.
   */
  attemptsPerDroppedPiece: number;
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
  /**
   * Highest level the dialog accepts as a start level. Reaching a level costs a
   * replay of every earlier lead motif draw, so the field is bounded.
   */
  maxStartLevel: number;
  /**
   * Music tracks of an endless run, by track id. In the Default music mode each new level plays
   * one of them, never the same as the level before; Random and Custom ignore the list. Without
   * it (or when empty) the biome track plays. Kept here, not in `procedural.endless`: every key
   * under `procedural` is part of the level content version, so adding one there would change
   * the levels of existing seeds.
   */
  musicTrackIds?: string[];
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
  toggleMute: string[];
  toggleGraphics?: string[];
  cycleTheme?: string[];
  generateProcedural?: string[];
  showObjective?: string[];
  showSolution?: string[];
  toggleFullscreen?: string[];
  toggleHelp?: string[];
  /** Drops the selected inventory item on the player's cell. */
  dropItem?: string[];
  /** Selects the next held item for dropItem. */
  cycleItem?: string[];
}

export interface UltimatePackDescriptor {
  id: string;
  name: string;
  i18nKey: string;
  url: string;
  prefix: string;
  /** Ruleset of the pack's levels; absent means 'epoxy'. */
  ruleset?: Ruleset;
}

export interface TouchConfig {
  swipeDeadzonePx: number;
  tapMaxDistancePx: number;
  tapMaxDurationMs: number;
  hapticPulseMs: number;
}

/** Layout counts the block puzzle solver may visit before giving up without a verdict. */
export interface BlockPuzzleConfig {
  /** Budget of the dead-end watch that runs by itself after every block move. */
  watchSearchBudget: number;
  /** Larger budget of a hint or a dead-end check the player asks for. */
  hintSearchBudget: number;
  /** Level area (cells) above which the automatic dead-end watch is skipped. */
  watchMaxCells: number;
}

/** Thresholds of the guard that keeps campaign maps unlike the bundled community packs. */
export interface CampaignGuardConfig {
  /** Side of the square windows whose canonical shapes make up a level fingerprint. */
  windowSize: number;
  /** Fingerprint Jaccard similarity at or above which a campaign level is flagged. */
  maxJaccard: number;
  /** Side of the larger windows; sharing any one of them flags the pair. */
  largeWindowSize: number;
  /** Cells other than wall and floor a large window needs before it counts. */
  largeWindowMinContent: number;
  /** Largest share of a large window one cell class may cover before the window is ignored. */
  largeWindowMaxShare: number;
}

export interface GameConfig {
  grid: GridConfig;
  graphics?: GraphicsConfig;
  themes?: Record<string, ThemePalette>;
  procedural?: ProceduralConfig;
  endlessUi: EndlessUiConfig;
  touch?: TouchConfig;
  blockPuzzle: BlockPuzzleConfig;
  campaignGuard: CampaignGuardConfig;
  ultimatePacks?: UltimatePackDescriptor[];
  timing: TimingConfig;
  storage: StorageConfig;
  import: ImportConfig;
  locales: {
    supported: string[];
    default: string;
  };
  keybindings: KeybindingsConfig;
  palette: Record<string, string>;
  /** Colour ramps of the 16-Bit Retro style: theme id (or "default") to ramp name to hex tones, light to dark. */
  retroPalettes?: Record<string, Record<string, string[]>>;
  /** Optional colour ramps of the 32-Bit Retro style (15-bit, up to 8 tones): replace the ramps derived from retroPalettes. */
  retro32Palettes?: Record<string, Record<string, string[]>>;
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
  /** Entering the cell empties the player's keys, as stealsBoots empties the boots. */
  stealsKeys?: boolean;
  /** Terrain the cell turns into once the player or a block has left it. */
  transformsToOnLeave?: string;
  /** Item (a key or boots id) whose holder may not enter the cell; dropped elsewhere, the cell is floor. */
  forbiddenItem?: string;
  requiredKey?: string;
  consumesKey?: boolean;
  colorKey?: string;
  collectible?: 'key' | 'chip' | 'boot' | 'bonus';
  /** Points added to the score when the item is picked up. */
  scoreBonus?: number;
  /** Factor applied to the level score at the exit when the item is picked up. */
  scoreMultiplier?: number;
  /** Seconds added to (or, negative, taken from) the time left when the item is picked up. */
  timeBonusSeconds?: number;
  buttonAction?: ButtonAction;
  togglesTo?: string;
  /** Terrain the cell swaps to when a toggle_flames button is pressed. */
  flameTogglesTo?: string;
  isTeleporter?: boolean;
  /** Teleporters chain only within their group; ungrouped teleporters form one network. */
  teleportGroup?: string;
  isTrap?: boolean;
  isCloneMachine?: boolean;
}

export type ButtonAction = 'toggle_walls' | 'reverse_tanks' | 'hold_trap' | 'trigger_cloner' | 'toggle_flames';

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
  slidesOnIce?: boolean;
  slidesOnForce?: boolean;
  waterTransformsTo?: string;
  meltsInFireTo?: string;
  destroyedByFire?: boolean;
  /** Whether a bomb on the cell the block enters destroys both. */
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
  /**
   * Sampled variants played round-robin instead of the notes, relative to `sfxBaseUrl`.
   * The notes stay as the fallback while a file is not decoded or cannot be loaded.
   */
  files?: string[];
  /** Hard cap on a sampled effect, in milliseconds; the source stops there. */
  maxDurationMs?: number;
  /** Linear fade to silence ending at `maxDurationMs`; needs `maxDurationMs`. */
  fadeOutMs?: number;
  /** Sampled effect loudness relative to the master and effects volumes (1 when omitted). */
  gain?: number;
  /** Minimum time between two starts of this effect, in milliseconds; calls inside it are skipped (no limit when omitted). */
  minIntervalMs?: number;
}

/** A track played by the built-in synthesizer. */
export interface SynthTrackConfig {
  id: string;
  i18nKey: string;
  source?: 'synth';
  stepDurationMs: number;
  leadWaveform: OscillatorType;
  bassWaveform: OscillatorType;
  leadNotes: number[];
  bassNotes: number[];
}

/** A track streamed from audio files; the first file the browser can decode is played. */
export interface FileTrackConfig {
  id: string;
  i18nKey: string;
  source: 'file';
  /** File names relative to `musicBaseUrl`; the extension selects the MIME type in `fileMimeTypes`. */
  files: string[];
  /** Track loudness relative to the music volume (1 when omitted). */
  gain?: number;
}

export type MusicTrackConfig = SynthTrackConfig | FileTrackConfig;

/** Mixing and scheduling parameters read from the optional `musicMix` block of audio.json. */
export interface MusicMixConfig {
  /** Fraction of a step a music note sounds for. */
  noteLengthRatio: number;
  /** Lead voice gain relative to the music volume. */
  leadGain: number;
  /** Bass voice gain relative to the music volume. */
  bassGain: number;
  /** Gain an envelope ramps down to (exponential ramps cannot reach zero). */
  releaseFloorGain: number;
  /** How often the look-ahead scheduler wakes up. */
  schedulerIntervalMs: number;
  /** How far ahead of the audio clock notes are scheduled. */
  scheduleAheadMs: number;
  /** Fade-in of a file track, so queued synth notes do not overlap its start. */
  fileFadeInMs: number;
}

export interface AudioConfig {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  effects: Record<string, AudioEffectConfig>;
  /** Effect id played for a step onto a terrain, keyed by tile `slideType` or `hazard`. */
  terrainStepEffects?: Record<string, string>;
  music: {
    stepDurationMs: number;
    leadWaveform: OscillatorType;
    bassWaveform: OscillatorType;
    leadNotes: number[];
    bassNotes: number[];
  };
  tracks?: MusicTrackConfig[];
  /** Synth track played when no other track is available. */
  defaultTrackId?: string;
  musicMix?: Partial<MusicMixConfig>;
  /** Folder the file tracks are loaded from. */
  musicBaseUrl?: string;
  /** Folder the sampled effect files are loaded from. */
  sfxBaseUrl?: string;
  /** MIME type by file extension, used to ask the browser whether it can play a file. */
  fileMimeTypes?: Record<string, string>;
  /** Music mode used until the player picks one: 'default', 'random' or 'custom'. */
  defaultMusicMode?: string;
}

export interface DatElementMapping {
  kind: 'terrain' | 'item' | 'entity' | 'player';
  id: string;
  dir?: Direction;
  isClonerTemplate?: boolean;
  /** Read by the decoder only: the encoder never picks this code, another code is the standard one. */
  decodeOnly?: boolean;
}

/** A run of byte codes, both ends included, that share one meaning. */
export interface DatByteRange {
  first: number;
  last: number;
  element: DatElementMapping;
}

/** How a .DAT file is read under the Lynx ruleset: what differs from byteToElement. */
export interface DatLynxConfig {
  /** Meaning of a code that neither byteToElement nor the overrides know. */
  fallbackElement: DatElementMapping;
  /** Codes whose Lynx meaning differs from byteToElement. */
  byteOverrides: Record<string, DatElementMapping>;
  /** Code ranges whose Lynx meaning differs from byteToElement; single overrides win. */
  byteRangeOverrides: DatByteRange[];
}

export interface DatFormatConfig {
  magicHeaders: number[];
  defaultMagicHeader: number;
  rleMarkerByte: number;
  passwordXorKey: number;
  layerByteLength: number;
  /** Cells per row of a layer. Falls back to the game grid width when unset. */
  layerWidth?: number;
  /** Rows of a layer. Falls back to the game grid height when unset. */
  layerHeight?: number;
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
    author?: number;
    monsterList: number;
  };
  byteToElement: Record<string, DatElementMapping>;
  /** Lynx reading of the codes; when unset, Lynx reads the same table as the Epoxy ruleset. */
  lynx?: DatLynxConfig;
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

/** How a level is won: reach the exit, or cover every block target with a block. */
export type WinRule = 'exit' | 'targets';

/**
 * Rules a level is played under. 'epoxy' is Epoxy's own rules and the default;
 * 'lynx' is the Tile World Lynx rules, used by community packs.
 */
export type Ruleset = 'epoxy' | 'lynx';

export interface LevelBlueprint {
  id: string;
  theme?: string;
  solution?: string;
  /** Win rule of the level; absent means 'exit'. */
  winRule?: WinRule;
  /** Ruleset the level was made for; absent means 'epoxy'. */
  ruleset?: Ruleset;
  number: number;
  titleKey?: string;
  customTitle?: string;
  hintKey?: string;
  customHint?: string;
  /** Level author, from DAT field 9. */
  author?: string;
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
  /** Win rule of the level; absent means 'exit'. */
  winRule?: WinRule;
  /** Ruleset the level was made for; absent means 'epoxy'. */
  ruleset?: Ruleset;
  number: number;
  titleKey?: string;
  customTitle?: string;
  hintKey?: string;
  customHint?: string;
  /** Level author, from DAT field 9. */
  author?: string;
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

/**
 * A player action stamped with the engine tick at which it was applied: a move
 * in `dir`, or, when `drop` names an item, that item dropped on the player's cell.
 */
export interface TimedMove {
  tick: number;
  dir: Direction;
  drop?: string;
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
  /** Seconds gained from stopwatch items, net of penalties. */
  extraTimeSeconds: number;
  /** Points from bonus flags, paid with the level score at the exit. */
  levelBonusPoints: number;
  /** Factor applied to the level score at the exit. */
  levelScoreMultiplier: number;
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
    /** Block target cells on the map. */
    targetCount: number;
  };
}
