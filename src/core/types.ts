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

import type { Cc3dLevel } from './cc3d/model';

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
  /** Ticks from the moment a blast charge is dropped to its blast. */
  chargeFuseTicks: number;
  /** Ticks a thrown hurl stone takes to cross one cell (a whole number of at least 1). */
  hurlStepTicks: number;
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
  /** Look of the player character: 'default' or 'julien'; read back through parsePlayerSkin. */
  playerSkin?: string;
  /** 'auto', or a fixed quality level: 'high', 'medium' or 'low'. */
  graphicsQuality?: string;
  sfxEnabled?: boolean;
  musicEnabled?: boolean;
  /** 'default', 'random' or 'custom'; read back through sanitizeMusicSettings. */
  musicMode?: string;
  /** Ids of the tracks ticked for the 'custom' music mode. */
  musicCustomTracks?: string[];
  /** Sound effects volume, 0 to 100 in steps of 5; read back through sanitizeVolumePercent. */
  sfxVolumePercent?: number;
  /** Music volume, 0 to 100 in steps of 5; read back through sanitizeVolumePercent. */
  musicVolumePercent?: number;
  /** Side of the screen the touch directional pad floats on in the phone full screen layout; read back through parseDpadSide. */
  dpadSide?: 'left' | 'right';
  /** Phone touch control: a joystick that appears under the thumb, or the fixed directional pad; read back through parseTouchControl. */
  touchControl?: 'floating' | 'fixed';
  /** Vibration pulse when the joystick engages a direction; on unless explicitly false. */
  hapticsEnabled?: boolean;
}

export interface StorageConfig {
  saveSlotKey: string;
  customLevelsKey: string;
  /** Where the raw legacy custom levels are kept when part of them could not be migrated. */
  customLevelsBackupKey: string;
  settingsKey: string;
  highScoresKey: string;
  activePackKey: string;
  lastProceduralSeedKey: string;
  lastEndlessKey: string;
  /** Flag set once the first-launch "How to play" dialog was shown. */
  onboardingSeenKey: string;
  /** Flag set once the one-time "New: Tutorial" notice was shown. */
  tutorialNoticeSeenKey: string;
  /** Pack the editor last saved a level into, preselected in its "Save into" dialog. */
  lastSaveDestinationKey: string;
  /** Which inspector sections of the editor are open. */
  editorSectionsKey: string;
  /** Whether Playtest mode is on. */
  playtestEnabledKey: string;
  /** The recorded playtest sessions. */
  playtestSessionsKey: string;
  levelPacksDbName: string;
  levelPacksStoreName: string;
}

/** Limits applied to files the player imports. */
export interface ImportConfig {
  /** Largest file read for import, in bytes. */
  maxFileBytes: number;
}

/** Longest optional author and description kept on a pack, in characters. */
export interface PackMetadataConfig {
  authorMaxLength: number;
  descriptionMaxLength: number;
}

/**
 * Longest text fields a level keeps, in characters. A stored, imported or shared level is cut to
 * these; `solutionMaxLength` is the exception: a cut solution is wrong, so a longer one is dropped.
 */
export interface LevelTextConfig {
  /** customTitle. */
  titleMaxLength: number;
  /** customHint. */
  hintMaxLength: number;
  /** Level author. */
  authorMaxLength: number;
  passwordMaxLength: number;
  /** Longest proven solution kept. */
  solutionMaxLength: number;
  themeMaxLength: number;
  /** Translation keys: titleKey and hintKey. */
  keyMaxLength: number;
  /** Tile, item and entity type ids. */
  idMaxLength: number;
}

/** Bounds of the Playtest recorder and of its rating form. */
export interface PlaytestConfig {
  /** Sessions kept; the oldest are dropped first. */
  maxSessions: number;
  /** Longest move trace kept per attempt, in characters. */
  maxTraceLength: number;
  /** Deaths listed per session; further ones are only counted. */
  maxDeathsPerSession: number;
  /** Most bytes the stored sessions may take, so they never crowd out the scores. */
  maxStoredBytes: number;
  /** Longest tester note, in characters. */
  noteMaxLength: number;
  /** Lowest and highest rating on the difficulty and fun scales. */
  ratingMin: number;
  ratingMax: number;
}

/** Limits of the pack share links. */
export interface ShareConfig {
  /** Longest link offered, in characters. */
  maxLinkChars: number;
  /** Most bytes a link may inflate to; reading stops as soon as it is passed. */
  maxDecodedBytes: number;
}

/** Render styles: 'retro' is the 16-Bit Retro id (kept so saved settings stay valid). */
export type GraphicsStyle =
  | 'modern'
  | 'retro'
  | 'retro32'
  | 'pocket'
  | 'pastel'
  | 'blueprint'
  | 'sepia'
  | 'classic90'
  | 'runeward'
  | 'runeward_parchment';

/** Colour families of the Retro HD recolour: every palette and theme colour belongs to exactly one. */
export type ColourFamily =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'skin'
  | 'neutral';

/**
 * Colours of one Retro HD render style (game.json renderStylePalettes, by style id): one ramp per
 * colour family, dark to light, as #rrggbb. A colour keeps its lightness inside the ramp of its
 * family, so fire stays fire-coloured and water water-coloured whatever the style. `quantize`
 * snaps to the nearest stop instead of interpolating between two.
 */
export interface RenderStylePaletteConfig {
  families: Record<ColourFamily, string[]>;
  quantize?: boolean;
}

/**
 * Family of a palette or theme colour fixed by hand: the family alone keeps the lightness of the
 * colour, `tone` (0 dark to 1 light) pins its position in the family ramp.
 */
export type FamilyAssignment = ColourFamily | { family: ColourFamily; tone: number };

/**
 * Colours whose family is not left to their hue (game.json renderStyleFamilies), shared by every
 * Retro HD style: palette keys and theme keys are separate tables because both have a `wallTop`.
 */
export interface RenderStyleFamilies {
  palette: Record<string, FamilyAssignment>;
  theme: Record<string, FamilyAssignment>;
}

/** Colours of a moving liquid in the Runeward style: base, surface and the drifting crest lines. */
export interface RunewardLiquidColours {
  deep: string;
  light: string;
  crest: string;
}

/** Colour channels the Runeward mechanism painters draw: the four colour keys of the game. */
export type RunewardKeyColour = 'red' | 'blue' | 'yellow' | 'green';

/** Colours of one colour channel: its key, door, plate and glyph. */
export interface RunewardKeyColours {
  main: string;
  light: string;
  /** Colour-blind glyph drawn on `main`; must stay readable on it. */
  glyph: string;
}

/**
 * Ink-on-paper additions of an art variant (game.json runewardArtVariants): the ink and paper
 * colours the variant's drawing uses, and the torch light that follows the player. A config without
 * this section keeps the default Runeward drawing.
 */
export interface RunewardInkConfig {
  /** Outline ink. */
  line: string;
  /** Hatching and shading strokes. */
  hatch: string;
  /** Specks scattered over the paper. */
  paperFleck: string;
  /** Faded stains on the paper. */
  paperStain: string;
  /** Gold leaf accents. */
  gold: string;
  /** Wood tone of the mage's staff. */
  wood: string;
  /** Warm light carried by the player instead of the shared player light. */
  torch: {
    color: string;
    /** Reach of the torch light, in tiles; must be above zero. */
    radiusTile: number;
  };
}

/** Four tones of a solid object: the body, a lit face, a shaded face and the outline. */
export interface RunewardSolidColours {
  base: string;
  light: string;
  dark: string;
  edge: string;
}

/** A body with a glow and a bright core (machines, gems, flames). */
export interface RunewardGlowColours {
  base: string;
  glow: string;
  core: string;
}

/** A creature: its body, a lit tone, a shaded tone and the eyes. */
export interface RunewardCreatureColours {
  body: string;
  light: string;
  dark: string;
  eye: string;
}

/** A main colour and its lit tone. */
export interface RunewardChannelColours {
  main: string;
  light: string;
}

/** Monster types (monsters.json) and the shot, each with its own colours. */
export type RunewardMonsterType =
  | 'bug' | 'paramecium' | 'pink_ball' | 'walker' | 'teeth' | 'glider' | 'fireball' | 'tank'
  | 'blob' | 'puppet' | 'skitter' | 'lurker' | 'wisp' | 'shot';

/** The two laser colours. */
export type RunewardLaserChannel = 'red' | 'blue';

/** Boots kinds. */
export type RunewardBootsKind = 'water' | 'fire' | 'ice' | 'force' | 'speed' | 'eye' | 'pull' | 'ward';

/** Button colours that are not a key channel. */
export type RunewardButtonColour = 'orange' | 'gray';

/**
 * Colours and timings the Runeward painters draw with (game.json runewardArt). The proportions of the
 * drawings live in the painters; everything a theme could change lives here.
 */
export interface RunewardArtConfig {
  /** Transparent end of the fades, in the colour notation the gradients use. */
  clear: string;
  floor: {
    base: string;
    light: string;
    dark: string;
    grout: string;
    /** Faint highlight along the top of the slabs. */
    sheen: string;
    /** Number of slab shade arrangements the cell hash picks from. */
    variants: number;
  };
  wall: {
    top: string;
    topLight: string;
    topDark: string;
    front: string;
    frontDark: string;
    edge: string;
  };
  /** Blue walls: the wall drawing under a blue tint, with a line in the blue family. */
  blueWall: {
    tint: string;
    line: string;
  };
  shadow: {
    color: string;
    /** Reach of the shadow below a wall, in tiles. */
    depth: number;
  };
  /** The socket seal: a dark stone with a glowing hexagon, a smaller hexagon inside it and a dot at the centre. */
  seal: {
    base: string;
    /** Lines of both hexagons and the dot. */
    glyph: string;
    /** The glyph colour fully transparent. */
    glow: string;
  };
  exit: {
    base: string;
    ring: string;
    core: string;
    /** The ring colour fully transparent. */
    glow: string;
  };
  water: RunewardLiquidColours;
  lava: RunewardLiquidColours;
  mage: {
    robe: string;
    robeLight: string;
    hat: string;
    hatLight: string;
    band: string;
    skin: string;
    eyes: string;
    staff: string;
    orb: string;
    /** Centre of the staff orb. */
    orbCore: string;
    /** Ground shadow under the character. */
    shadow: string;
  };
  /** Colours the three playable characters share beyond the mage block: outline, cloth, leather and effects. */
  character: {
    /** Outline of the figure when the style draws no ink line. */
    outline: string;
    hair: string;
    /** Skin in shade: the mouth and the nose crease. */
    skinShade: string;
    leather: string;
    leatherDark: string;
    /** Scroll paper and the lines written on it. */
    scroll: string;
    scrollInk: string;
    satchel: string;
    satchelLight: string;
    strap: string;
    feather: string;
    /** Shadow inside a hood. */
    hoodInner: string;
    trouser: string;
    /** The scribe's cloak; the edge is the dark rim that keeps its hood readable on a pale floor. */
    cloak: { main: string; light: string; dark: string; edge: string };
    lantern: { glassTop: string; glassBottom: string; rib: string };
    /** The ward ring and its rune diamonds. */
    halo: { ring: string; inner: string; rune: string };
  };
  /** Keys, doors, plates, buttons and toggle slabs, by colour channel. */
  keys: Record<RunewardKeyColour, RunewardKeyColours>;
  /** Locked doors: the frame and the keyhole. */
  door: {
    frame: string;
    keyhole: string;
  };
  /** Hold doors (portcullis): the bars and the frame. */
  gate: {
    bar: string;
    barLight: string;
    frame: string;
  };
  /** Pressure plates and buttons. */
  plate: {
    rim: string;
    face: string;
    pressed: string;
    /** Light line along the top of a plate that is not pressed. */
    highlight: string;
  };
  /** The chip: a runed hexagonal gem. */
  rune: {
    stone: string;
    glow: string;
    core: string;
    /** Centre of the halo behind the gem. */
    halo: string;
    /** The halo colour fully transparent. */
    haloClear: string;
  };
  /** Traps: the dark recess and the iron jaws that close over it. */
  trap: {
    pit: string;
    jaw: string;
    /** Light outline of the jaws. */
    jawLight: string;
  };
  /** Teleports: the stone disc, the ring (replaced by the colour of a coloured teleport) and the vortex. */
  portal: {
    base: string;
    ring: string;
    core: string;
    /** The ring colour fully transparent. */
    glow: string;
  };
  /** Ice and its corners. */
  ice: {
    base: string;
    light: string;
    /** Cracks, and the band along the slide path of a corner. */
    line: string;
    /** Outline of the sheet. */
    edge: string;
  };
  /** Force floors: the underlay and the chevrons. */
  force: {
    base: string;
    arrow: string;
    /** Thin light core of the chevrons. */
    arrowLight: string;
  };
  /** Pushable blocks: dirt, ice, arrow and colour blocks. */
  block: {
    dirt: RunewardSolidColours;
    ice: RunewardSolidColours;
    arrow: RunewardSolidColours & {
      /** Arrow drawn on the block. */
      glyph: string;
    };
    colour: Record<RunewardKeyColour, RunewardSolidColours>;
  };
  /** Mirrors, plain and one-sided: the frame and the reflecting glass. */
  mirror: {
    frame: RunewardSolidColours;
    glass: string;
    /** Highlight line on the glass. */
    glassLight: string;
  };
  /** Monsters and the shot, by monster type. */
  monster: Record<RunewardMonsterType, RunewardCreatureColours>;
  /** Wall pieces, rotating doors, plates, machines, lasers, launchers and turrets. */
  device: {
    thinWall: RunewardSolidColours;
    swivel: RunewardSolidColours;
    turnPlate: RunewardGlowColours;
    transmogrifier: RunewardGlowColours;
    cloneMachine: RunewardGlowColours;
    /** Base is the cold jet, glow and core the lit one. */
    flameJet: RunewardGlowColours;
    laser: RunewardGlowColours;
    /** Receivers and gates of the two laser colours. */
    laserChannel: Record<RunewardLaserChannel, RunewardChannelColours>;
    shotLauncher: RunewardSolidColours;
    puppetControl: RunewardGlowColours;
    turret: RunewardSolidColours;
  };
  /** Boots, bomb, score tokens, stopwatches, forbidden markers and the slow-time item. */
  item: {
    boots: Record<RunewardBootsKind, RunewardChannelColours>;
    bomb: RunewardGlowColours;
    score: RunewardSolidColours;
    stopwatch: {
      face: string;
      rim: string;
      bonus: string;
      penalty: string;
    };
    forbid: {
      ring: string;
      slash: string;
    };
    slowTime: RunewardGlowColours;
  };
  /** Signal plates, gates and latches. */
  signal: {
    box: string;
    /** Rim and symbol while unpowered. */
    idle: string;
    /** Rim and symbol while powered. */
    lit: string;
    glyph: string;
  };
  /** Small floor marks and creatures: gravel, dirt, hint, targets, slime, turtle, thief, buttons. */
  mark: {
    gravel: RunewardSolidColours;
    dirt: RunewardSolidColours;
    hint: RunewardGlowColours;
    recessedWall: RunewardSolidColours;
    blockTarget: RunewardGlowColours;
    slime: RunewardGlowColours;
    turtle: RunewardSolidColours;
    thief: RunewardSolidColours;
    button: Record<RunewardButtonColour, RunewardChannelColours>;
  };
  animation: {
    bobAmplitude: number;
    bobPeriodMs: number;
    flowPeriodMs: number;
    portalPeriodMs: number;
    /** Period of the chip pulse. */
    pulsePeriodMs: number;
    /** Time a force floor chevron takes to move one step along the push. */
    forceScrollPeriodMs: number;
    /** Time a monster takes for one step of its two-frame walk cycle. */
    monsterStepMs: number;
  };
  /** Present on ink-on-paper variants only; the default Runeward art has none. */
  ink?: RunewardInkConfig;
}

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
  /**
   * First attempts of each tier that keep clear of the pieces neighbouring levels use
   * (the piece cooldown). Later attempts draw from the whole pool, so a cooldown that
   * leaves only pieces hard to lay out never costs a whole tier.
   */
  cooldownAttemptsPerTier: number;
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
  /** Distance from the touch point before the floating joystick engages a direction, in CSS pixels. */
  joystickDeadZonePx?: number;
  /** Distance under which an engaged joystick lets go (smaller than the dead zone: hysteresis). */
  joystickReleaseRadiusPx?: number;
  /** The off-axis component must exceed the current axis component by this ratio to switch axis. */
  joystickAxisSwitchRatio?: number;
  /** Distance past which the joystick base follows the finger, in CSS pixels. */
  joystickBaseFollowRadiusPx?: number;
  /** Radius the knob is drawn within, in CSS pixels (visual only). */
  joystickKnobRadiusPx?: number;
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
  /** Room similarity (open cells, blocks, targets; any rotation, reflection, translation) at or above which two campaign levels are too alike. */
  maxRoomSimilarity: number;
  /** Room similarity at or above which a campaign room with targets is too close to a reference Sokoban puzzle. */
  maxSokobanSimilarity: number;
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
  packMetadata: PackMetadataConfig;
  levelText: LevelTextConfig;
  share: ShareConfig;
  playtest: PlaytestConfig;
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
  /** Family ramps of the Retro HD render styles (Pocket, Pastel, Blueprint, Sepia, Classic 90s), by style id. */
  renderStylePalettes?: Record<string, RenderStylePaletteConfig>;
  /** Colours of the palette and of the themes whose Retro HD family is fixed by hand. */
  renderStyleFamilies?: RenderStyleFamilies;
  /** Colours and timings of the Runeward render style painters. */
  runewardArt?: RunewardArtConfig;
  /** Alternative Runeward art blocks, by the variant name a render style asks for (artVariant). */
  runewardArtVariants?: Record<string, RunewardArtConfig>;
}

export interface TileDefinition {
  id: string;
  category: string;
  layer: 'terrain' | 'item';
  i18nKey: string;
  /** Key of a longer description, shown where the name alone is not enough (the reserved CC2 ids carry one). */
  descriptionKey?: string;
  /**
   * A reserved id of a source format whose mechanic Epoxy does not play. The definition only keeps the id alive: the
   * terrain acts as a wall, the item does nothing, and the validator reports the level as unsupported.
   */
  unimplemented?: UnimplementedSource;
  passableByPlayer?: boolean;
  passableByMonster?: boolean;
  passableByBlock?: boolean;
  transformsToOnStep?: string;
  revealsToOnTouch?: string;
  requiresAllChips?: boolean;
  transformsToOnUnlock?: string;
  isLevelExit?: boolean;
  showsHint?: boolean;
  hazard?: 'water' | 'fire' | 'bomb' | 'slime';
  protectedByItem?: string;
  blockTransformsTo?: string;
  slideType?: 'ice' | 'force';
  blockedEntryDirections?: Direction[];
  blockedEdges?: Direction[];
  /**
   * A rail piece: the two sides it is open on. Every other side of the cell is closed to walkers, sliders, pushed
   * blocks and teleport exits (never to beams or shots), and the piece is entered and left only through these sides.
   */
  railSides?: Direction[];
  /** A swivel door: the tile the cell turns into after a quarter turn clockwise and counter-clockwise. */
  swivelTurns?: { cw: string; ccw: string };
  /**
   * 'cc2' on a swivel door that follows the Chip's Challenge 2 rule: its closed sides stop entering only, and leaving
   * through a closed side pushes the door round (clockwise when the side clockwise of the exit is closed too, else
   * counter-clockwise); leaving through an open side does not turn it. Absent: the Epoxy rule (closed sides stop both,
   * the door turns behind the actor to close the side it came in by).
   */
  swivelRule?: 'cc2';
  /**
   * A Chip's Challenge 2 track cell (terrain): up to six track segments, held per cell in the level's `railTracks`.
   * Whoever enters must come in through a side an active track opens; it leaves only along a track that joins the side
   * it came in by (see epoxyRailsCc2). The tile itself closes no side, so beams, shots and the checkers see it as open floor.
   */
  railJunction?: boolean;
  deflectionMap?: Partial<Record<Direction, Direction>>;
  forceDirection?: Direction | 'RANDOM';
  /** A turning force floor: no fixed direction; each arrival of any actor on any such cell takes the next direction of the level's shared turn. */
  forceCycle?: boolean;
  /** Boots that destroy the first monster the player touches, from either side, and are used up by it. */
  absorbsMonsterContact?: boolean;
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
  collectible?: 'key' | 'chip' | 'boot' | 'bonus' | 'charge' | 'gate' | 'stone' | 'token';
  /** A blast charge: the lit item it turns into when the player drops it. */
  dropsAs?: string;
  /** A pocket gate: the terrain tile it turns the player's floor cell into when dropped. */
  dropsAsTerrain?: string;
  /** A lit blast charge: set on the item a dropped charge becomes, which blocks nothing and cannot be picked up. */
  litCharge?: boolean;
  /** Points added to the score when the item is picked up. */
  scoreBonus?: number;
  /** Factor applied to the level score at the exit when the item is picked up. */
  scoreMultiplier?: number;
  /** Seconds added to (or, negative, taken from) the time left when the item is picked up. */
  timeBonusSeconds?: number;
  /** Boots only: while held, every monster takes this many times as long per step (an integer, 2 to 4). */
  slowsMonsters?: number;
  /** Boots only: while held, the player takes this many times less time per walking step (exactly 2 for now). */
  hastesPlayer?: number;
  /** Boots only: while held, the renderer marks invisible walls and appearing walls (purely visual). */
  revealsHiddenWalls?: boolean;
  pullsBlocks?: boolean;
  /** A monster that arrives on the tile swaps its kind for its `transmogrifiesTo` pair; anything else passes unchanged. */
  transmogrifies?: boolean;
  /**
   * A turn plate: quarter turns clockwise applied to the facing of an arrow block that arrives on the tile
   * (1 clockwise, -1 counter-clockwise). Anything else passes unchanged.
   */
  facingTurn?: 1 | -1;
  buttonAction?: ButtonAction;
  /** When 'player', only the player's step works the button: monsters and blocks that enter the cell press nothing. */
  buttonWorkedBy?: ButtonWorker;
  togglesTo?: string;
  /**
   * An item that swaps to another item at every press of the green button, wherever it lies (the Chip's Challenge 2
   * green chip and green bomb). The target names this item back.
   */
  itemTogglesTo?: string;
  /**
   * On a chip item: false when picking it up does not count toward the chips the level requires. Absent or true: it counts,
   * as the plain chip does.
   */
  countsAsChip?: boolean;
  /**
   * A wall that no blast destroys (the steel wall). Blast charges never remove terrain today, so the flag has no effect on
   * play yet; it is what a future terrain-breaking blast reads.
   */
  blastProof?: boolean;
  /**
   * Boots only (the steel foil): while held, a player who bumps a wall whose id is a key here turns it into the tile named by
   * the value, and does not move. Every target must be an impassable terrain, so the foil never opens a way. The boots stay held.
   */
  turnsWallsTo?: Record<string, string>;
  /** An item the player works by stepping on it (the toggle clock): the level timer pauses and resumes, and the item stays. */
  togglesTimer?: boolean;
  /** An item that a block cannot be pushed onto, as monsters cannot enter a cell holding an item (the toggle clock). */
  blocksBlocks?: boolean;
  /** A tile only this character may step on as the player; for the other character it is a wall. Monsters and blocks follow their own flags. */
  characterOnly?: PlayerCharacter;
  /** Per character, the boots the player must hold to step on this tile. A character not listed needs none. */
  bootsForCharacter?: Partial<Record<PlayerCharacter, string>>;
  /** Terrain the cell swaps to when a toggle_flames button is pressed. */
  flameTogglesTo?: string;
  isTeleporter?: boolean;
  /** Teleporters chain only within their group; ungrouped teleporters form one network. */
  teleportGroup?: string;
  /** A teleporter the player set down: it links with the other such pads found on the terrain at the moment of the jump. */
  portableTeleporter?: boolean;
  /**
   * A relay pad: `dark` is plain floor, `lit` is a teleporter of the group "relay". A pad that a signal link ends on
   * follows its input (lit while on, dark while off); an unlinked pad keeps the form it was placed in.
   */
  relayPad?: 'dark' | 'lit';
  /** A relay pad: the id of its other form, which the pad swaps to when its input changes. */
  relayTwin?: string;
  isTrap?: boolean;
  isCloneMachine?: boolean;
  /** Whether a laser beam passes through the cell; every tile declares it. */
  laserTransparent?: boolean;
  /** Direction a laser emitter fires in. */
  laserEmitter?: Direction;
  /** Present on a shot launcher: the terrain that fires a flying shot the way it faces when a linked trigger is worked. */
  shotLauncher?: ShotLauncherDefinition;
  /** Group a laser receiver belongs to: it drives the laser gates of that group while a beam reaches it. */
  laserReceiverGroup?: string;
  /** Group of a laser gate: it is open while any receiver of the group is lit. */
  laserGateGroup?: string;
  /** Whether a laser gate is the open (true) or the closed (false) form of its pair. */
  laserGateOpen?: boolean;
  /** The other form of a laser gate (closed to open and back), swapped by the receivers of its group only. */
  laserGateTogglesTo?: string;
  /** Colour of a pressure plate: a hold door of the same colour opens while every plate of it is pressed. */
  plateColor?: ChannelColor;
  /** Colour of a hold door; it is open while every plate of that colour is pressed. */
  holdDoorColor?: ChannelColor;
  /** Whether a hold door is the open (true) or the closed (false) form of its pair. */
  holdDoorOpen?: boolean;
  /** The other form of a hold door (closed to open and back), swapped by the plates of its colour only. */
  holdDoorTogglesTo?: string;
  /**
   * When a hold door closes on a cell that is occupied: true (the default) closes it at once, the occupant
   * may leave and nothing may enter; false keeps it open until the cell is free, as a laser gate does.
   */
  holdDoorClosesOnOccupant?: boolean;
  /**
   * A signal source: 'held' is on while its cell is occupied, 'pulse' is on for one settle after something
   * arrives on its cell. A laser receiver is a source through laserReceiverGroup.
   */
  signalSource?: 'held' | 'pulse' | 'inverted' | 'toggle' | 'charged';
  /**
   * A toggle switch (signalSource 'toggle'): whether this form is the powered one. The state of the switch is its terrain
   * form, so it lives in the terrain (snapshots and hashes already cover it).
   */
  signalToggleOn?: boolean;
  /** A toggle switch: the id of its other form, which the switch becomes each time an actor arrives on it. */
  signalToggleTwin?: string;
  /**
   * The other form of a purple wall or a wired flame jet, which the cell becomes on every change of the signal wired
   * into it (a rising and a falling edge alike). It is not togglesTo: the green button swaps every togglesTo tile and
   * never touches this one.
   */
  wireTogglesTo?: string;
  /** A trap that a signal link may end on: it is open while that signal is on, besides while a brown button is held. */
  wiredTrap?: true;
  /** A signal gate: the logic it applies to the signals linked into it. */
  signalGate?: 'and' | 'or' | 'not' | 'xor' | 'latch' | 'nand' | 'dlatch' | 'counter';
  /** A latch tile that starts with its bit on; the bit itself lives in the signal state. */
  signalLatchStartsOn?: true;
  /** A counter gate tile: the digit (0 to 9) it starts with; the count itself lives in the signal state. */
  signalCounterStart?: number;
  /** Channel of a colour toggle wall; a toggle wall that declares none belongs to the green channel. */
  toggleChannel?: ChannelColor;
  /** The other form of a colour toggle wall, swapped by the toggle button of its channel only. */
  channelTogglesTo?: string;
  /** Colour of the colour block that made this walkable cell by sinking into water. */
  floatingBlockColor?: ChannelColor;
}

/** Colours of the plate, hold door and toggle channels. Green is the existing toggle wall channel. */
export type ChannelColor = 'red' | 'green' | 'blue' | 'yellow';

export type ButtonAction =
  | 'toggle_walls'
  | 'reverse_tanks'
  | 'hold_trap'
  | 'trigger_cloner'
  | 'toggle_flames'
  | 'swap_chips_bombs'
  | 'toggle_walls_red'
  | 'toggle_walls_blue'
  | 'toggle_walls_yellow'
  | 'steer_monsters'
  | 'fire_launchers'
  | 'pulse_wired_area';

/** How a shot launcher fires. */
export interface ShotLauncherDefinition {
  /** The way the launcher faces, and the way its shots first fly. */
  dir: Direction;
  /** Ticks a shot takes to cross one cell (a whole number of at least 1). */
  stepTicks: number;
}

/** Who works a button: only the player when it says 'player', anything that steps on it otherwise. */
export type ButtonWorker = 'player';

/** The formats that reserve ids for mechanics Epoxy does not implement. */
export type UnimplementedSource = 'cc2';

export interface TilesConfig {
  categories: Array<{ id: string; i18nKey: string }>;
  tiles: Record<string, TileDefinition>;
}

/** The reserved Chip's Challenge 2 definitions (public/configs/cc2-tiles.json): tiles and items, blocks and monsters. */
export interface Cc2ReservedConfig {
  tiles: Record<string, TileDefinition>;
  entities: Record<string, EntityDefinition>;
}

export interface EntityDefinition {
  id: string;
  category: string;
  kind: 'block' | 'monster';
  i18nKey: string;
  /** Key of a longer description (the reserved CC2 ids carry one). */
  descriptionKey?: string;
  /** A reserved id of a source format whose entity Epoxy does not play: it stays where it was placed and does nothing. */
  unimplemented?: UnimplementedSource;
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
  /** A monster that sleeps in the floor: the entity type it becomes when the player ends an arrival next to it. */
  wakesTo?: string;
  /** The Epoxy engine alone plays this entity: Lynx and CC3D rulesets and the .DAT format refuse it. */
  epoxyOnly?: boolean;
  turnOrder?: RelativeTurn[];
  immuneToWater?: boolean;
  immuneToFire?: boolean;
  avoidsFire?: boolean;
  /** Turned around when a reverse_tanks button is pressed. */
  reversedByButton?: boolean;
  /** Orientation of a laser mirror: 'slash' (/) or 'backslash' (\). A mirror is a block. */
  mirrorAxis?: MirrorAxis;
  /**
   * Makes a mirror one-sided: the corner of the cell its reflecting face looks toward. The mirror runs
   * along the diagonal that cuts that corner off, so 'NE' and 'SW' need the 'backslash' axis and 'NW' and
   * 'SE' the 'slash' axis. A shot (or a laser beam) that enters the cell through one of the two sides
   * that meet at the corner is turned out of the other one; one that enters through the two other sides
   * hits the back: a shot destroys the mirror and is spent, a beam stops without covering the cell.
   */
  mirrorFrontCorner?: MirrorCorner;
  /** What a flying shot does to the entity it runs into; see ShotEffect for the defaults. */
  shotEffect?: ShotEffect;
  /** Terrain hazards a block refuses to enter, by push, slide, teleport or clone. */
  refusesHazards?: Array<NonNullable<TileDefinition['hazard']>>;
  /** Colour of a colour block: it presses the plates of this colour only (a plain entity presses every plate). */
  plateColor?: ChannelColor;
  /**
   * Whether the entity presses pressure plates. Blocks do by default; a monster does by default unless it
   * flies (see `flying`). An explicit value always wins.
   */
  pressesPlates?: boolean;
  /** A flying monster passes over a colour plate without pressing it, unless `pressesPlates` says otherwise. */
  flying?: boolean;
  /** Present on a turret: a block that fires a short beam from the cell it faces. */
  turretBeam?: TurretBeamDefinition;
  /**
   * Present on an arrow block: the sides, read relative to its facing, that show an arrow. A push moves
   * the block only toward one of these sides; slides, teleports and clone machines ignore them.
   */
  pushArrows?: RelativeTurn[];
  /**
   * Present on a block: the block ids this block may push along in a line when the player pushes it (CC2 chain
   * pushing). A wall, the map edge, a sliding block or a block that cannot yield refuses the whole push (the plan is checked before anything moves); a line that a move then breaks up may stop partway. Absent: the
   * block pushes no other block. Not `pushesBlocks`, which lets a monster push one block and never a chain.
   */
  chainPushes?: string[];
  /**
   * A monster that never decides a step of its own: it moves only when a button of this action is worked
   * (see ButtonAction 'steer_monsters'), one step in the direction the player moved.
   */
  steeredBy?: ButtonAction;
  /** Whether a monster pushes a block it walks into (one block, never a chain). */
  pushesBlocks?: boolean;
  /** A monster kind that swaps for this one on a transmogrifier tile (the pairing is symmetric). */
  transmogrifiesTo?: string;
  /** Tile ids a monster may enter although the tile is not passable by monsters (hazards still apply on arrival). */
  passesTiles?: string[];
  /**
   * Characters whose player this monster runs from: a chasing monster flees them and a fleeing one chases them
   * (the CC2 teeth flee Melinda, the CC2 timid teeth flee Chip). Absent: the pattern applies to every character.
   */
  fleesCharacters?: PlayerCharacter[];
  /** A monster that walks into any tile, doors and walls included (a ghost); see `blockedByTiles` and `blockedByHazards` for what still stops it. */
  passesSolidTiles?: boolean;
  /** Tile ids a monster that passes solid tiles still cannot enter. */
  blockedByTiles?: string[];
  /** Hazards of the destination tile that stop a monster that passes solid tiles. */
  blockedByHazards?: Array<NonNullable<TileDefinition['hazard']>>;
  /** A monster that crosses thin walls and other cell edges as if they were not there. */
  ignoresCellEdges?: boolean;
  /**
   * A monster that the floor does not move or hurt: ice and force floors do not carry it, a rail or a swivel door
   * does not turn it, a trap does not hold it, and a bomb, fire, slime or a transmogrifier does nothing to it.
   * Buttons and teleporters still work on it.
   */
  ignoresFloorEffects?: boolean;
  /** A monster that walks over items without being stopped by them or picking them up. */
  passesItems?: boolean;
  /** A monster that follows the behaviour of these monsters in turn (movement pattern `emulate_cycle`), in this order. */
  emulates?: string[];
  /** Step decisions a monster that `emulates` others takes before it moves on to the next behaviour. */
  emulationSwitchAttempts?: number;
}

/** How a turret fires and turns. Only `length`, `turn` and `turnPeriodTicks` are required in the config. */
export interface TurretBeamDefinition {
  /** Cells the beam reaches from the turret, 1 to 8. */
  length: number;
  /** Quarter turns per period: 0 fixed, 1 clockwise, -1 counter-clockwise. */
  turn: TurretTurn;
  /** Fires in the four directions at once instead of the one it faces. */
  allSides?: boolean;
  /** Ticks between two quarter turns of a turning turret. */
  turnPeriodTicks: number;
  /** A player push turns the turret toward the push (true by default); slides keep its facing. */
  faceOnPush?: boolean;
  /** 'block' (default) stops where a block could not enter, items included; 'laser' follows the laser opacity of tiles. */
  opacity?: TurretOpacity;
  /** The turret stays silent and still until the player's first step (true by default). */
  firesAfterFirstStep?: boolean;
}

/** Quarter turns a turret makes each period. */
export type TurretTurn = -1 | 0 | 1;

/** How far a turret beam sees through terrain and items. */
export type TurretOpacity = 'block' | 'laser';

/** Orientation of a laser mirror. */
export type MirrorAxis = 'slash' | 'backslash';

/** A corner of a cell, named by the two sides that meet there. */
export type MirrorCorner = 'NE' | 'NW' | 'SE' | 'SW';

/**
 * What a flying shot does to the entity in the cell it enters, the shot ending in every case but
 * 'reflect': 'stop' leaves the entity unharmed, 'destroy' removes it, 'melt' removes it and leaves
 * its meltsInFireTo terrain, 'reflect' turns the shot as the mirror does. When an entity declares
 * none, a monster is destroyed, a mirror reflects and any other block stops the shot.
 */
export type ShotEffect = 'stop' | 'destroy' | 'reflect' | 'melt';

export interface MonstersConfig {
  entities: Record<string, EntityDefinition>;
}

export interface AudioNote {
  freq: number;
  durationMs: number;
  gain: number;
  /** Frequency the note glides to by its end, in Hz; the pitch stays constant when omitted. */
  slideToFreq?: number;
  /** Linear rise from silence to the note gain, in milliseconds; the note starts at full gain when omitted. */
  attackMs?: number;
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

export type MusicTrackConfig = FileTrackConfig;

/** Mixing parameters read from the optional `musicMix` block of audio.json. */
export interface MusicMixConfig {
  /** Gain an envelope ramps down to (exponential ramps cannot reach zero). */
  releaseFloorGain: number;
  /** Fade-in of a file track, so it does not start with a click. */
  fileFadeInMs: number;
}

export interface AudioConfig {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  effects: Record<string, AudioEffectConfig>;
  /** Effect id played for a step onto a terrain, keyed by tile `slideType` or `hazard`. */
  terrainStepEffects?: Record<string, string>;
  tracks?: MusicTrackConfig[];
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

/**
 * A trigger (a tile with the fire_launchers action) wired to a shot launcher: working the trigger
 * fires that launcher. A trigger may have several links; a trigger with none fires nothing.
 */
export interface LauncherLink {
  buttonX: number;
  buttonY: number;
  launcherX: number;
  launcherY: number;
}

/**
 * A signal wire from one device to another (Epoxy ruleset only): the output of the `from` cell feeds the `to` cell.
 * What each end is (a source, a gate or a sink) comes from the tile on the cell, never from the link.
 */
export interface SignalLink {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Reserved for ordered gates, 1 to 16 characters; ignored in v1. */
  port?: string;
}

/** A shot in flight. It sits in a cell, never in the launcher's, and flies until it hits something. */
export interface Shot {
  x: number;
  y: number;
  dir: Direction;
  /** Ticks left to wait before the shot crosses its next cell. */
  cooldown: number;
  /** What the shot is when it is not a launcher's: a stone the player threw. Absent on a launcher shot. */
  payload?: 'hurl_stone';
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

/**
 * How a level is won: reach the exit, cover every block target with a block,
 * or light every laser receiver.
 */
export type WinRule = 'exit' | 'targets' | 'receivers';

/** The character a level is played with (Epoxy ruleset only); absent on a level means Chip. */
export type PlayerCharacter = 'chip' | 'melinda';

/**
 * One cell crossed by a laser beam. `horizontal` and `vertical` tell which
 * axes the beam travels along in the cell: both are set where a mirror turns it.
 */
export interface BeamCell {
  x: number;
  y: number;
  horizontal: boolean;
  vertical: boolean;
}

/**
 * Rules a level is played under. 'epoxy' is Epoxy's own rules and the default;
 * 'lynx' is the Tile World Lynx rules, used by community packs;
 * 'cc3d' is the compatibility engine for user-imported community levels, which
 * carry their data in CompiledLevel.cc3d.
 */
export type Ruleset = 'epoxy' | 'lynx' | 'cc3d';

/**
 * Pilot design note of a block puzzle: how many blocks the level needs and
 * for what. With no spare, the level holds `waters + targets` blocks.
 */
export interface BlockBudget {
  /** Water cells the stored solution fills with a block. */
  waters: number;
  /** Block targets covered when the level is won. */
  targets: number;
}

export interface LevelBlueprint {
  id: string;
  /** Pilot levels only: the campaign level this one deliberately reworks, exempt from the originality comparison with it. */
  reworkOf?: string;
  /** Pilot levels only: the blocks the level needs, checked against its block count by the pilot design tests. */
  blockBudget?: BlockBudget;
  theme?: string;
  solution?: string;
  /** Win rule of the level; absent means 'exit'. */
  winRule?: WinRule;
  /** Character the level is played with; absent means Chip (Epoxy ruleset only). */
  character?: PlayerCharacter;
  /** Ruleset the level was made for; absent means 'epoxy'. */
  ruleset?: Ruleset;
  /** The CC3D level data; the engine of the 'cc3d' ruleset reads only this. */
  cc3d?: Cc3dLevel;
  /** Source record of a level imported from a CC2 file; absent on every other level, and ignorable by any reader. */
  cc2?: Cc2LevelData;
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
  /** Thin walls on cells of any terrain (Epoxy ruleset only); see CompiledLevel.cellEdges. */
  cellEdges?: CellEdge[];
  /** Track segments of the Chip's Challenge 2 track cells (Epoxy ruleset only); see CompiledLevel.railTracks. */
  railTracks?: RailTrackCell[];
  /** Terrain hidden under a removable top (Epoxy ruleset only); see CompiledLevel.underlays. */
  underlays?: CellUnderlay[];
  terrainOverrides?: Array<{ x: number; y: number; id: string }>;
  /** Item placements, or a full item grid as the editor exports it. */
  items?: Array<{ x: number; y: number; id: string }> | (string | null)[][];
  itemGrid?: (string | null)[][];
  entities: EntityPlacement[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
  /** Triggers wired to shot launchers (Epoxy ruleset only); absent when the level has none. */
  launcherLinks?: LauncherLink[];
  /** Signal wires between devices (Epoxy ruleset only); absent when the level has none. */
  signalLinks?: SignalLink[];
}

/** One chapter of the Epoxy campaign: a titled run of levels, listed by id. */
export interface CampaignChapter {
  id: string;
  titleKey: string;
  subtitleKey: string;
  levels: string[];
}

/** public/configs/pilot-levels.json: the levels of the Epoxy pilot pack (it shares the legend of levels.json). */
export type PilotLevelsConfig = Pick<LevelsConfig, 'levels'>;

/** public/configs/campaign.json: how the Epoxy campaign levels are grouped into chapters. */
export interface CampaignConfig {
  chapters: CampaignChapter[];
}

export interface LevelsConfig {
  legend: Record<string, { terrain: string; item?: string }>;
  levels: LevelBlueprint[];
}

/** Thin walls on the sides of one cell, whatever its terrain (Epoxy ruleset only). */
export interface CellEdge {
  x: number;
  y: number;
  /** The blocked sides of the cell; a step across a blocked side is stopped from either cell. */
  sides: Direction[];
}

/**
 * The track segments of one Chip's Challenge 2 track cell (terrain `rail_junction`, Epoxy ruleset only). `mask` holds one
 * bit per segment in the order of the Lexy's Labyrinth railroad: bit 0 north-east, 1 south-east, 2 south-west, 3 north-west,
 * 4 east-west, 5 north-south. A cell with a switch has an `active` segment (0 to 5, the bit number): only that segment
 * is open until the switch advances. `entry` is the side an actor standing on the cell at the start came in by;
 * absent means the south side (the track modifier's default of an actor that came in moving north).
 */
export interface RailTrackCell {
  x: number;
  y: number;
  mask: number;
  active?: number;
  entry?: Direction;
}

/**
 * The terrain hidden under a removable top (a door, a socket, a blue fake wall, dirt) of one cell, Epoxy ruleset
 * only. The cell plays as its top until the top is removed by the player, and then as this terrain.
 */
export interface CellUnderlay {
  x: number;
  y: number;
  terrain: string;
}

export type SignalNodeKind = 'source' | 'and' | 'or' | 'not' | 'xor' | 'latch' | 'nand' | 'dlatch' | 'counter' | 'sink';

export interface SignalNodeSpec {
  /** Index of the node's cell (y * width + x); unique in a network. */
  cell: number;
  kind: SignalNodeKind;
  /** Latch nodes only: the bit the latch starts with at load; off when absent. */
  startBit?: boolean;
  /** Counter nodes only: the digit (0 to 9) the counter starts with at load; 0 when absent. */
  startValue?: number;
}

export interface SignalLinkSpec {
  /** Cell index of the node the signal leaves. */
  from: number;
  /** Cell index of the node the signal enters. */
  to: number;
  /**
   * The ports the wire joins, for a gate with ordered ports (see signalPorts.ts): `in0` or `in1` names the input of the
   * gate the link enters, `out0` or `out1` the output of the counter it leaves, `out1>in0` both. Absent: the first input,
   * the first output.
   */
  port?: string;
}

/**
 * What a signal network remembers between settles; every array is indexed by node in evaluation order
 * (so a change to the ordering rules changes the hash of signal levels).
 */
export interface SignalState {
  /** The bit of each latch (false for other nodes). */
  latchBits: boolean[];
  /** The output of every node at the last settle; a source's output is the level last sampled for it. */
  lastOutputs: boolean[];
  /** The count of each counter gate (0 to 9; 0 for other nodes). Present only in a network that has a counter. */
  counterValues?: number[];
  /** The underflow output of each counter gate, held until its next count (false for other nodes). Present with counterValues. */
  counterUnderflow?: boolean[];
}

/**
 * How a signal source reads the world: a held source is on while its cell is occupied, an inverted one while it is not,
 * a receiver source while a laser lights it, a toggle source while its terrain is the powered form of a toggle switch.
 */
export type SignalSampler = 'held' | 'pulse' | 'receiver' | 'inverted' | 'toggle' | 'charged';

/**
 * What a signal sink fires on a rising edge of its input: a shot launcher, a clone machine, or a flip tile (a green
 * toggle wall or a rail switch: the one cell swaps to its other form). A `flip_edges` sink (a purple wall or a wired
 * flame jet) flips on every change of its input instead, rising and falling alike.
 */
export type SignalSinkFires = 'launcher' | 'cloner' | 'flip' | 'flip_edges';

/** A node of a signal network with what the engine needs to read or drive it. */
export interface SignalNodeDef extends SignalNodeSpec {
  /** Source nodes only: what the engine samples. */
  sample?: SignalSampler;
  /** Sink nodes only: the colour of the hold doors the node drives, as a pressed plate of that colour would. */
  color?: ChannelColor;
  /** Sink nodes only: the device the node fires once on each rising edge of its input. A sink has exactly one kind: a colour, `fires` or `powers`. */
  fires?: SignalSinkFires;
  /** Sink nodes only: the node powers a relay pad or a wired trap, which follows the level of its input (lit or open while on). */
  powers?: boolean;
}

/** The signal network of a level (Epoxy ruleset only), compiled from its signal links at load; never stored. */
export interface SignalSpec {
  nodes: SignalNodeDef[];
  links: SignalLinkSpec[];
}

/** The pulse memory of a signal network: arrivals since the last settle, and the one-bit carry of each pulse button. Cell indexes, ascending. */
export interface SignalPulseState {
  pending: number[];
  carry: number[];
  /** Level sinks a gray area button pulsed since the last settle (cell indexes, ascending); left out when none. */
  area?: number[];
  /** Level sinks held on by a gray area button for the current settle only (cell indexes, ascending); left out when none. */
  lit?: number[];
}

/** How well Epoxy plays an element of a CC2 level, or a whole level (the worst of its elements). */
export type Cc2CoverageVerdict = 'exact' | 'approx' | 'lost';

/** Coverage of one CC2 level, computed at import: the verdict and the keys that decide it (see cc2Coverage.ts). */
export interface Cc2Coverage {
  verdict: Cc2CoverageVerdict;
  /** Keys of the elements Epoxy cannot play, sorted. */
  lost: string[];
  /** Keys of the elements Epoxy plays approximately, sorted. */
  approx: string[];
}

/**
 * What a level converted from a CC2 file remembers about its source. The file bytes themselves live in a local
 * sidecar keyed by `sha256`; a share link never carries them.
 */
export interface Cc2LevelData {
  /** Version of this record. */
  v: 1;
  /** SHA-256 (hex) of the source file bytes. */
  sha256: string;
  /** File name of the source level, as read from the folder or the game script. */
  file: string;
  /** Position of the level in the game script, 1-based. */
  order: number;
  /** Music track named by the game script, when it names one. */
  music?: string;
  /** Hash of the grid at import time: the source bytes are re-exported as they were only while it still matches. */
  gridHash: string;
  coverage: Cc2Coverage;
}

export interface CompiledLevel {
  id: string;
  /** Pilot design note: the blocks the level needs; see BlockBudget. */
  blockBudget?: BlockBudget;
  /** Theme shown when the player lets the level choose; see game.json themes. */
  theme?: string;
  /** A proven winning action list (N, E, S, W, '.' to wait, X to drop a blast charge, G to set down a pocket gate), for the solution replay. */
  solution?: string;
  /** Win rule of the level; absent means 'exit'. */
  winRule?: WinRule;
  /** Character the level is played with; absent means Chip (Epoxy ruleset only). */
  character?: PlayerCharacter;
  /** Ruleset the level was made for; absent means 'epoxy'. */
  ruleset?: Ruleset;
  /** The CC3D level data; the engine of the 'cc3d' ruleset reads only this. */
  cc3d?: Cc3dLevel;
  /** Source record of a level imported from a CC2 file; absent on every other level, and ignorable by any reader. */
  cc2?: Cc2LevelData;
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
  /** True when an import found no player start: playerStart is then an inert placeholder and the validator reports an error. */
  missingStart?: boolean;
  terrain: string[][];
  items: (string | null)[][];
  /** Thin walls on cells of any terrain; one entry per cell, absent when the level has none. */
  cellEdges?: CellEdge[];
  /**
   * The track segments of the Chip's Challenge 2 track cells, one entry per cell whose terrain is `rail_junction`
   * (Epoxy ruleset only); absent when the level has none.
   */
  railTracks?: RailTrackCell[];
  /** Terrain hidden under a removable top, one entry per cell (Epoxy ruleset only); absent when the level has none. */
  underlays?: CellUnderlay[];
  entities: EntityPlacement[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
  /** Triggers wired to shot launchers (Epoxy ruleset only); absent when the level has none. */
  launcherLinks?: LauncherLink[];
  /** Signal wires between devices (Epoxy ruleset only); absent when the level has none. */
  signalLinks?: SignalLink[];
}

export interface LevelPack {
  id: string;
  name: string;
  i18nKey?: string;
  builtIn?: boolean;
  /** True for a pack the player created; an empty one is kept. Absent on imported packs. */
  userCreated?: boolean;
  /** Optional credit line of a user or imported pack. */
  author?: string;
  /** Optional free text describing a user or imported pack; may span several lines. */
  description?: string;
  /** SHA-256 (hex) of the shared pack text this pack was imported from; stored only, never exported. */
  sourceHash?: string;
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
  /** Turrets only: the way the turret fires; `dir` stays the way it was pushed or slides. */
  facing?: Direction;
  /** Rovers only: index, in the `emulates` list of the definition, of the monster whose behaviour it follows now. */
  emulatee?: number;
  /** Rovers only: step decisions taken since the rover last changed behaviour. */
  emulationMoves?: number;
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

/** A blast charge that was dropped and has not blasted yet: its cell and the absolute tick it blasts at. */
export interface LitCharge extends GridPoint {
  detonateTick: number;
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
  /** Tick of the player's first step; written only on a level with turrets, absent otherwise. */
  playStartTick?: number;
  /** The shots in flight; written only on a level with shot launchers, absent otherwise. */
  shots?: Shot[];
  /** The parity of the toggle presses; written only on a level with a toggle wall or flame jet under a removable top. */
  toggleParity?: number;
  /** Arrivals counted on turning force floors; written only on a level that has one, absent otherwise. */
  forceCycleTurn?: number;
  /** The lit blast charges and when each blasts; written only while one is lit, absent otherwise. */
  litCharges?: LitCharge[];
  /** Cells that revealed their hidden terrain, by index; written only once one did, absent otherwise. */
  revealedCells?: number[];
  /** Swivel doors an actor is standing in: [cell index, side it came in by]; absent when none. */
  swivelEntry?: [number, Direction][];
  /** The state of the track cells: [cell index, active segment or -1 without a switch, side the last actor came in by]; written only on a level that has track cells. */
  railState?: [number, number, Direction][];
  /** True while the level timer is paused by a toggle clock; written only on a level that has one, absent otherwise. */
  timerPaused?: boolean;
  /** Ticks the timer stood paused so far; written only on a level that has a toggle clock, absent otherwise. */
  pausedTicks?: number;
  /** The state of the signal network; written only on a level that has one, absent otherwise. */
  signals?: SignalState;
  /** Pulse buttons with an unconsumed arrival (pending) or a press kept for the next settle (carry); written only when one is non-empty. */
  signalPulses?: SignalPulseState;
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
  /** An 'info' issue is a hint: like a warning it never makes the level invalid. */
  severity: 'error' | 'warning' | 'info';
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
