/* =========================================================
   DEBUG
========================================================= */
const DEBUG_STATS = false;

/* ---- iPhone error overlay ---- */
window.addEventListener("error", (e) => {
  const box = document.createElement("pre");
  box.style.position="fixed";
  box.style.left="0"; box.style.right="0"; box.style.bottom="0";
  box.style.maxHeight="45vh"; box.style.overflow="auto";
  box.style.zIndex="99999"; box.style.margin="0"; box.style.padding="12px";
  box.style.background="rgba(0,0,0,0.92)"; box.style.color="white"; box.style.fontSize="12px";
  box.textContent = "JS ERROR:\n" + (e.message||"Unknown") + "\n\n" + (e.filename||"") + ":" + (e.lineno||"") + ":" + (e.colno||"");
  document.body.appendChild(box);
});

/* ===== Toast (override, no queue) ===== */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(text, type="info"){
  clearTimeout(toastTimer);
  toastEl.classList.remove("good","bad","show");
  if (type === "good") toastEl.classList.add("good");
  if (type === "bad") toastEl.classList.add("bad");
  toastEl.textContent = text;
  void toastEl.offsetWidth;
  toastEl.classList.add("show");
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1000);
}

/* ===== Helpers ===== */
function rndId(){ return (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function chance(p){ return Math.random() < p; }
function randi(a,b){ return Math.floor(a + Math.random()*(b-a+1)); }

/* ===== Rarity helpers ===== */
const RARITIES = ["Common","Uncommon","Rare","Epic","Legendary"];
function rarityColor(r){
  if (r==="Uncommon") return getCSS("--rar-uncommon");
  if (r==="Rare") return getCSS("--rar-rare");
  if (r==="Epic") return getCSS("--rar-epic");
  if (r==="Legendary") return getCSS("--rar-legendary");
  return getCSS("--rar-common");
}
function raritySlots(r){
  if (r==="Legendary") return 3;
  if (r==="Epic") return 2;
  if (r==="Rare") return 2;
  return 1;
}
function getCSS(varName){
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}


/* =========================================================
   SPRITES (MiniElementsHeroes)
   - Supports BOTH folder layouts:
     A) docs/assets/mini-elements-heroes/... (nested)
     B) docs/assets/... (flat)
   - Player uses OUTLINE heroes, Enemy uses WITHOUT-OUTLINE heroes.
   - Fallback to vector shapes if sprites fail to load.
========================================================= */

// MiniElementsHeroes sheets are 32x32 frames.
// Typical sheet sizes in this pack are 320x256 => 10 cols x 8 rows.
const SPRITE_META = { frameW: 32, frameH: 32, cols: 10, rows: 8 };

// MinifolksHumans are individual PNGs (not sprite sheets).
// Treat as static images so we never sample blank/transparent frames.

const HERO_FILES = {
  earth:      "MiniEarthWarrior-Sheet.png",
  water:      "MiniWaterSpearwoman-Sheet.png",
  lightning:  "MiniLightningWarrior-Sheet.png",
  wind:       "MiniWindWarrior-Sheet.png",
  ice:        "MiniIceSwordswoman-Sheet.png",
};

const HUMAN_FILES = {
  sword:    'MiniSwordMan.png',
  shield:   'MiniShieldMan.png',
  spear:    'MiniSpearMan.png',
  halberd:  'MiniHalberdMan.png',
  archer:   'MiniArcherMan.png',
  crossbow: 'MiniCrossBowMan.png',
  mage:     'MiniMage.png',
  archmage: 'MiniArchMage.png',
  king:     'MiniKingMan.png',
  prince:   'MiniPrinceMan.png',
  horse:    'MiniHorseMan.png',
  cavalier: 'MiniCavalierMan.png',
};


const SpriteDB = {}; // key -> { img, type: 'sheet'|'static', meta?: {frameW,frameH,cols,rows} }
let spritesReady = false;
let spritesInitStarted = false;

function _spritePaths(rel){
  // rel like: 'outline/heroes/F.png'
  return [
    `assets/${rel}`,
    `assets/mini-elements-heroes/${rel}`,
  ];
}

function _metaFromImg(img, fallbackMeta){
  const fw = (fallbackMeta && fallbackMeta.frameW) || SPRITE_META.frameW;
  const fh = (fallbackMeta && fallbackMeta.frameH) || SPRITE_META.frameH;
  const w = (img && (img.naturalWidth || img.width)) || 0;
  const h = (img && (img.naturalHeight || img.height)) || 0;
  const cols = Math.max(1, Math.floor(w / fw) || (fallbackMeta && fallbackMeta.cols) || SPRITE_META.cols);
  const rows = Math.max(1, Math.floor(h / fh) || (fallbackMeta && fallbackMeta.rows) || SPRITE_META.rows);
  return { frameW: fw, frameH: fh, cols, rows };
}

// Stable hash for per-unit frame selection (avoids visual flicker)
function _hash32(str){
  let h = 2166136261;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

// Build a list of non-empty frames for a sheet (prevents "invisible" units when frame 0 is blank)
function _computeNonEmptyFrames(img, meta){
  const fw = meta.frameW, fh = meta.frameH;
  const cols = Math.max(1, meta.cols|0);
  const rows = Math.max(1, meta.rows|0);

  // Offscreen canvas for a cheap alpha probe per frame
  const c = document.createElement('canvas');
  c.width = fw;
  c.height = fh;
  const cx = c.getContext('2d', { willReadFrequently: true });

  const good = [];
  // sample a small cross at the centre; if any pixel has alpha, frame counts as non-empty
  const sx = (fw/2)|0, sy = (fh/2)|0;
  const samplePts = [
    [sx, sy],
    [Math.max(0,sx-3), sy],
    [Math.min(fw-1,sx+3), sy],
    [sx, Math.max(0,sy-3)],
    [sx, Math.min(fh-1,sy+3)],
  ];

  for (let r = 0; r < rows; r++){
    for (let col = 0; col < cols; col++){
      cx.clearRect(0,0,fw,fh);
      cx.drawImage(img, col*fw, r*fh, fw, fh, 0, 0, fw, fh);
      const data = cx.getImageData(0,0,fw,fh).data;
      let any = false;
      for (const [px,py] of samplePts){
        const idx = (py*fw + px) * 4 + 3;
        if (data[idx] > 10){ any = true; break; }
      }
      if (any) good.push(r*cols + col);
    }
  }

  // If we somehow found none, fall back to all frames (better than disappearing)
  if (!good.length){
    for (let i = 0; i < cols*rows; i++) good.push(i);
  }
  return good;
}

function _buildFrameRows(frames, cols){
  // Map row -> sorted list of frame indices within that row.
  const rows = {};
  for (const fi of frames){
    const r = Math.floor(fi / cols);
    (rows[r] ||= []).push(fi);
  }
  for (const r in rows){
    rows[r].sort((a,b)=> (a%cols)-(b%cols));
  }
  return rows;
}


function _humanPaths(rel){
  // rel like: 'outline/MiniSwordMan.png'
  return [
    `assets/minifolks-humans/${rel}`,
    `assets/minifolks-humans/${rel}`.replace('minifolks-humans','MinifolksHumans'),
  ];
}

function loadImageWithFallback(paths){
  return new Promise((resolve, reject) => {
    let i = 0;
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";

    function tryNext(){
      if (i >= paths.length){
        reject(new Error("Sprite load failed: " + paths.join(" | ")));
        return;
      }
      img.onload = () => resolve(img);
      img.onerror = () => { i += 1; tryNext(); };
      img.src = paths[i];
    }
    tryNext();
  });
}

function initSprites(){
  if (spritesInitStarted) return;
  spritesInitStarted = true;

  const jobs = [];
  for (const [elKey, file] of Object.entries(HERO_FILES)){
    const pKey = `p_${elKey}`;
    const eKey = `e_${elKey}`;

    jobs.push(
      loadImageWithFallback(_spritePaths(`outline/heroes/${file}`))
        .then(img => {
          const meta = _metaFromImg(img, SPRITE_META);
          const frames = _computeNonEmptyFrames(img, meta);
          const frameRows = _buildFrameRows(frames, meta.cols);
          SpriteDB[pKey] = { img, type: 'sheet', meta, frames, frameRows };
        })
    );

    jobs.push(
      loadImageWithFallback(_spritePaths(`without-outline/heroes/${file}`))
        .then(img => {
          const meta = _metaFromImg(img, SPRITE_META);
          const frames = _computeNonEmptyFrames(img, meta);
          const frameRows = _buildFrameRows(frames, meta.cols);
          SpriteDB[eKey] = { img, type: 'sheet', meta, frames, frameRows };
        })
    );
  }

  

  // MinifolksHumans (static PNGs)
  for (const [hKey, file] of Object.entries(HUMAN_FILES)){
    const pKey = `p_human_${hKey}`;
    const eKey = `e_human_${hKey}`;

    jobs.push(
      loadImageWithFallback(_humanPaths(`outline/${file}`))
        .then(img => {
          const meta = _metaFromImg(img, SPRITE_META);
          const frames = _computeNonEmptyFrames(img, meta);
          const frameRows = _buildFrameRows(frames, meta.cols);
          SpriteDB[pKey] = { img, type: 'sheet', meta, frames, frameRows };
        })
    );

    jobs.push(
      loadImageWithFallback(_humanPaths(`without-outline/${file}`))
        .then(img => {
          const meta = _metaFromImg(img, SPRITE_META);
          const frames = _computeNonEmptyFrames(img, meta);
          const frameRows = _buildFrameRows(frames, meta.cols);
          SpriteDB[eKey] = { img, type: 'sheet', meta, frames, frameRows };
        })
    );
  }

  Promise.allSettled(jobs).then((res) => {
    // Consider ready if we got at least 1 sprite per side.
    const havePlayer = Object.keys(SpriteDB).some(k => k.startsWith('p_'));
    const haveEnemy  = Object.keys(SpriteDB).some(k => k.startsWith('e_'));
    spritesReady = havePlayer && haveEnemy;
  });
}

function hashToIndex(str, mod){
  let h = 0;
  for (let i=0;i<str.length;i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return mod ? (h % mod) : h;
}

function spriteElementForUnit(u){
  // Deterministic but varied so different unit names don't look identical.
  const keys = Object.keys(HERO_FILES);
  const idx = hashToIndex((u.name||'unit') + '|' + (u.cls||u.className||''), keys.length);
  return keys[idx];
}

function humanSpriteBaseForUnit(u){
  const n = String(u.name||'').toLowerCase();
  if (n.includes('warlord')) return 'king';
  if (n.includes('knight')) return 'shield';
  if (n.includes('brawler')) return 'sword';
  if (n.includes('berserker')) return 'halberd';
  if (n.includes('spearman')) return 'spear';
  if (n.includes('crossbow')) return 'crossbow';
  if (n.includes('trapper')) return 'crossbow';
  if (n.includes('archer')) return 'archer';
  if (n.includes('invoker') || n.includes('archmage')) return 'archmage';
  if (n.includes('healer')) return 'mage';
  if (n.includes('mage') && !n.includes('arch')) return 'mage';
  if (n.includes('assassin')) return 'prince';
  if (n.includes('shade')) return 'cavalier';
  return null;
}

function spriteKeyForUnit(u){
  // Prefer MinifolksHumans silhouettes (clear per unit type)
  const h = humanSpriteBaseForUnit(u);
  if (h){
    const key = (u.side === 'player' ? 'p_human_' : 'e_human_') + h;
    if (SpriteDB[key]) return key;
  }

  // Fallback: MiniElementsHeroes elemental sheets (varied by hash)
  const elKey = spriteElementForUnit(u);
  return (u.side === 'player' ? 'p_' : 'e_') + elKey;
}

/* =========================================================/* =========================================================
   SYNERGY BREAKPOINTS + EFFECT TABLES
========================================================= */
const TRAIT_BREAKPOINTS = {
  Warrior:[2,4,6,8,10],
  Ranger:[2,4,6,8,10],
  Mage:[2,3,5,7,9],
  Rogue:[2,3,5,7,9],
  Kingdom:[2,3,5,7,9],
  Wilds:[2,3,5,7,9],
  Cult:[2,3,5,7,9],
};

// Synergy tier -> effect numbers (tier is 1..5)
const SYNERGY_EFFECTS = {
  Warrior: { hpMult:[1.10, 1.20, 1.30, 1.45, 1.65] },
  Ranger:  { atkSpeed:[0.10, 0.20, 0.32, 0.46, 0.62] },           // +% attack speed (cooldown reduced)
  Mage:    { atkMult:[1.10, 1.20, 1.32, 1.48, 1.68] },
  Rogue:   { firstHit:[0.18, 0.35, 0.55, 0.80, 1.10], move:[0.08, 0.12, 0.18, 0.25, 0.35] },
  Kingdom: { frontDR:[0.08, 0.15, 0.22, 0.30, 0.40] },            // damage reduction add
  Wilds:   { regenPct:[0.010,0.020,0.030,0.040,0.055] },          // % max HP per sec
  Cult:    { shieldOnKillPct:[0.06, 0.10, 0.14, 0.18, 0.24], shieldDur:[1.8,2.0,2.2,2.4,2.8] }
};

/* ===== Definitions ===== */
const UNIT_POOL = [
  { name:"Brawler",  rarity:"Common",    cost:1, hp: 260, atk: 18, spd: 1.00, range: 18,  role:"Front",    classTag:"Warrior", originTag:"Kingdom" },
  { name:"Knight",   rarity:"Uncommon",  cost:2, hp: 320, atk: 22, spd: 1.05, range: 18,  role:"Front",    classTag:"Warrior", originTag:"Kingdom" },
  { name:"Archer",   rarity:"Common",    cost:1, hp: 180, atk: 26, spd: 0.95, range: 150, role:"Back",     classTag:"Ranger",  originTag:"Wilds"   },
  { name:"Mage",     rarity:"Uncommon",  cost:2, hp: 170, atk: 34, spd: 1.15, range: 160, role:"Mage",     classTag:"Mage",    originTag:"Cult"    },
  { name:"Assassin", rarity:"Rare",      cost:3, hp: 190, atk: 46, spd: 0.75, range: 22,  role:"Skirmish", classTag:"Rogue",   originTag:"Wilds"   },

  { name:"Spearman",    rarity:"Uncommon",  cost:2, hp: 300, atk: 24, spd: 1.00, range: 26,  role:"Front",    classTag:"Warrior", originTag:"Kingdom" },
  { name:"Healer",      rarity:"Uncommon",  cost:2, hp: 160, atk: 18, spd: 1.25, range: 170, role:"Mage",     classTag:"Mage",    originTag:"Cult"    },
  { name:"Crossbowman", rarity:"Common",    cost:1, hp: 170, atk: 30, spd: 1.10, range: 150, role:"Back",     classTag:"Ranger",  originTag:"Kingdom" },
  { name:"Berserker",   rarity:"Rare",      cost:3, hp: 360, atk: 28, spd: 1.05, range: 18,  role:"Front",    classTag:"Warrior", originTag:"Wilds"   },
  { name:"Invoker",     rarity:"Rare",      cost:3, hp: 175, atk: 32, spd: 1.05, range: 170, role:"Mage",     classTag:"Mage",    originTag:"Cult"    },
  { name:"Trapper",     rarity:"Rare",      cost:3, hp: 180, atk: 24, spd: 0.95, range: 160, role:"Back",     classTag:"Ranger",  originTag:"Wilds"   },
  { name:"Warlord",     rarity:"Epic",      cost:4, hp: 460, atk: 32, spd: 1.10, range: 22,  role:"Front",    classTag:"Warrior", originTag:"Kingdom" },
  { name:"Shade",       rarity:"Legendary", cost:5, hp: 240, atk: 60, spd: 0.75, range: 22,  role:"Skirmish", classTag:"Rogue",   originTag:"Cult"    },
];

const ITEMS = {
  I1:{
    name:"Sword", rarity:"Common", desc:"+20% ATK", maxTier:3,
    tiers:[
      { desc:"+20% ATK",
        apply(c){ c.atk = Math.round(c.atk*1.20); } },
      { desc:"+45% ATK · 8% lifesteal",
        apply(c){ c.atk = Math.round(c.atk*1.45); c.lifesteal = Math.max(c.lifesteal||0, 0.08); } },
      { desc:"+80% ATK · 18% lifesteal · +50% first-hit bonus",
        apply(c){ c.atk = Math.round(c.atk*1.80); c.lifesteal = Math.max(c.lifesteal||0, 0.18); c.firstHitBonus = Math.max(c.firstHitBonus||0, 0.50); } },
    ]
  },
  I2:{
    name:"Shield", rarity:"Common", desc:"+25% Max HP", maxTier:3,
    tiers:[
      { desc:"+25% Max HP",
        apply(c){ c.maxHP = Math.round(c.maxHP*1.25); c.hp = c.maxHP; } },
      { desc:"+55% Max HP · 10% damage reduction",
        apply(c){ c.maxHP = Math.round(c.maxHP*1.55); c.hp = c.maxHP; c.damageReduction = Math.min(0.65,(c.damageReduction||0)+0.10); } },
      { desc:"+90% Max HP · 18% damage reduction · start with 12% shield",
        apply(c){ c.maxHP = Math.round(c.maxHP*1.90); c.hp = c.maxHP; c.damageReduction = Math.min(0.65,(c.damageReduction||0)+0.18); c.startShield = Math.max(c.startShield||0, 0.12); } },
    ]
  },
  I3:{
    name:"Bowstring", rarity:"Uncommon", desc:"+15% atk speed (ranged)", maxTier:3,
    tiers:[
      { desc:"+15% atk speed (ranged)",
        apply(c){ if (isRangedUnit(c)) c.spd = c.spd*0.85; } },
      { desc:"+32% atk speed · +25 range (ranged)",
        apply(c){ if (isRangedUnit(c)){ c.spd = c.spd*0.68; c.range += 25; } } },
      { desc:"+55% atk speed · +50 range · pierce every 2nd hit (ranged)",
        apply(c){ if (isRangedUnit(c)){ c.spd = c.spd*0.45; c.range += 50; c.pierceEvery = 2; } } },
    ]
  },
  I4:{
    name:"Scope", rarity:"Uncommon", desc:"+30 range", maxTier:3,
    tiers:[
      { desc:"+30 range",
        apply(c){ c.range += 30; } },
      { desc:"+70 range · +12% atk speed",
        apply(c){ c.range += 70; c.spd = c.spd*0.88; } },
      { desc:"+120 range · +25% atk speed · +40% first-hit bonus",
        apply(c){ c.range += 120; c.spd = c.spd*0.75; c.firstHitBonus = Math.max(c.firstHitBonus||0, 0.40); } },
    ]
  },
  I5:{
    name:"Vamp Charm", rarity:"Rare", desc:"10% lifesteal", maxTier:3,
    tiers:[
      { desc:"10% lifesteal",
        apply(c){ c.lifesteal = Math.max(c.lifesteal||0, 0.10); } },
      { desc:"24% lifesteal",
        apply(c){ c.lifesteal = Math.max(c.lifesteal||0, 0.24); } },
      { desc:"40% lifesteal · start with 12% HP shield",
        apply(c){ c.lifesteal = Math.max(c.lifesteal||0, 0.40); c.startShield = Math.max(c.startShield||0, 0.12); } },
    ]
  },
  I6:{
    name:"Bomb", rarity:"Rare", desc:"First hit splashes", maxTier:3,
    tiers:[
      { desc:"First hit splashes",
        apply(c){ c.bombReady = true; } },
      { desc:"First 3 hits splash",
        apply(c){ c.bombCharges = Math.max(c.bombCharges||0, 3); } },
      { desc:"Every 2nd hit splashes",
        apply(c){ c.bombEvery = 2; c.bombCounter = 0; } },
    ]
  },
  I7:{
    name:"Iron Ring", rarity:"Common", desc:"+10% Max HP", maxTier:3,
    tiers:[
      { desc:"+10% Max HP",
        apply(c){ c.maxHP = Math.round(c.maxHP*1.10); c.hp = c.maxHP; } },
      { desc:"+25% Max HP · 1% HP regen/sec",
        apply(c){ c.maxHP = Math.round(c.maxHP*1.25); c.hp = c.maxHP; c.regenPerSec = (c.regenPerSec||0) + c.maxHP*0.010; } },
      { desc:"+45% Max HP · 2% HP regen/sec · start with 8% shield",
        apply(c){ c.maxHP = Math.round(c.maxHP*1.45); c.hp = c.maxHP; c.regenPerSec = (c.regenPerSec||0) + c.maxHP*0.020; c.startShield = Math.max(c.startShield||0, 0.08); } },
    ]
  },
  I8:{
    name:"Boots", rarity:"Uncommon", desc:"+10% move speed", maxTier:3,
    tiers:[
      { desc:"+10% move speed",
        apply(c){ c.moveMult = (c.moveMult||1)*1.10; } },
      { desc:"+25% move speed · +10% first-hit bonus",
        apply(c){ c.moveMult = (c.moveMult||1)*1.25; c.firstHitBonus = Math.max(c.firstHitBonus||0, 0.10); } },
      { desc:"+45% move speed · +25% first-hit bonus · 6% lifesteal",
        apply(c){ c.moveMult = (c.moveMult||1)*1.45; c.firstHitBonus = Math.max(c.firstHitBonus||0, 0.25); c.lifesteal = Math.max(c.lifesteal||0, 0.06); } },
    ]
  },
  I9:{
    name:"Chain Rune", rarity:"Rare", desc:"Every 4th hit chains", maxTier:3,
    tiers:[
      { desc:"Every 4th hit chains (1 target)",
        apply(c){ c.chainEvery = 4; c.chainReady = 0; c.chainTargets = 1; } },
      { desc:"Every 3rd hit chains (2 targets)",
        apply(c){ c.chainEvery = 3; c.chainReady = 0; c.chainTargets = 2; } },
      { desc:"Every 2nd hit chains (3 targets) · +30% chain dmg",
        apply(c){ c.chainEvery = 2; c.chainReady = 0; c.chainTargets = 3; c.chainDmgMult = 1.30; } },
    ]
  },
  I10:{
    name:"Aegis Core", rarity:"Epic", desc:"Start with a shield", maxTier:3,
    tiers:[
      { desc:"Start with 18% HP shield",
        apply(c){ c.startShield = Math.max(c.startShield||0, 0.18); } },
      { desc:"Start with 36% HP shield · refreshes on kill",
        apply(c){ c.startShield = Math.max(c.startShield||0, 0.36); c.shieldRefreshOnKill = true; } },
      { desc:"Start with 55% HP shield · refreshes on kill · +10% ATK",
        apply(c){ c.startShield = Math.max(c.startShield||0, 0.55); c.shieldRefreshOnKill = true; c.atk = Math.round(c.atk*1.10); } },
    ]
  },
  I11:{
    name:"Phoenix Feather", rarity:"Epic", desc:"Revive once at 25% HP", maxTier:3,
    tiers:[
      { desc:"Revive once at 25% HP",
        apply(c){ c.reviveCount = Math.max(c.reviveCount||0, 1); c.reviveHpPct = Math.max(c.reviveHpPct||0, 0.25); } },
      { desc:"Revive twice at 40% HP",
        apply(c){ c.reviveCount = Math.max(c.reviveCount||0, 2); c.reviveHpPct = Math.max(c.reviveHpPct||0, 0.40); } },
      { desc:"Revive 3× at 55% HP · +20% ATK each revive",
        apply(c){ c.reviveCount = Math.max(c.reviveCount||0, 3); c.reviveHpPct = Math.max(c.reviveHpPct||0, 0.55); c.reviveBonusAtk = 0.20; } },
    ]
  },
  I12:{
    name:"Chrono Relic", rarity:"Legendary", desc:"Team +10% atk speed", maxTier:3,
    tiers:[
      { desc:"Team +10% atk speed",
        apply(c){ } },
      { desc:"Team +22% atk speed · +10% ATK",
        apply(c){ c.atk = Math.round(c.atk*1.10); } },
      { desc:"Team +38% atk speed · +18% ATK · +15% Max HP",
        apply(c){ c.atk = Math.round(c.atk*1.18); c.maxHP = Math.round(c.maxHP*1.15); c.hp = c.maxHP; } },
    ],
    teamBuff:{ key:"atkSpeed", value:0.10, label:"Team atk speed (Chrono Relic)" }
  }
};

const ITEM_TIER_LABELS = ["I", "II", "III"];
function getItemTier(def, tier){
  if (!def) return null;
  const tiers = def.tiers || [];
  if (!tiers.length) return null;
  const idx = Math.min(Math.max((tier||1)-1, 0), tiers.length-1);
  return tiers[idx];
}
function itemDesc(type, tier){
  const def = ITEMS[type];
  const info = getItemTier(def, tier || 1);
  if (info && info.desc) return info.desc;
  return def && def.desc ? def.desc : "";
}
function itemTierLabel(tier){ return ["I","II","III"][(tier||1)-1] || "I"; }

/* ===== Item Merge System ===== */
function getMergeCandidates(){
  // Returns map: "type:tier" -> [{item, idx}]
  const map = {};
  for (let i=0; i<S.items.length; i++){
    const it = S.items[i];
    if (!it || !it.type) continue;
    const def = ITEMS[it.type];
    if (!def) continue;
    const t = it.tier || 1;
    if (t >= (def.maxTier||3)) continue; // already max tier
    const key = it.type + ":" + t;
    (map[key] = map[key]||[]).push({ item:it, idx:i });
  }
  // only return groups with 2+
  const out = {};
  for (const [k,v] of Object.entries(map)){
    if (v.length >= 2) out[k] = v;
  }
  return out;
}

function mergeItems(type, tier){
  const def = ITEMS[type];
  if (!def) return null;
  const t = tier || 1;
  if (t >= (def.maxTier||3)){ showToast("Already max tier!", "bad"); return null; }
  // Find 2 items of this type+tier in S.items
  const indices = [];
  for (let i=0; i<S.items.length && indices.length<2; i++){
    const it = S.items[i];
    if (it && it.type === type && (it.tier||1) === t) indices.push(i);
  }
  if (indices.length < 2){ showToast("Need 2 of the same item & tier to merge", "bad"); return null; }
  // Remove both (high index first)
  indices.sort((a,b)=>b-a);
  for (const idx of indices) S.items.splice(idx,1);
  // Add upgraded item
  const upgraded = { id:rndId(), type, tier: t+1 };
  S.items.push(upgraded);
  const newDesc = itemDesc(type, t+1);
  showToast(`Merged ${def.name} ${itemTierLabel(t)}+${itemTierLabel(t)} → ${itemTierLabel(t+1)}! ${newDesc}`, "good");
  renderAll();
  saveGame();
  renderInventory();
  return upgraded;
}

/* ===== Augments (trait crests removed; stackables uncapped) ===== */
const AUGMENTS = {
  A1:{ id:"A1", name:"Rich Get Richer", desc:"+3g now, +1g each round (stacks)", stackable:true,
       pickNow:(S, stacksAdded)=>{ S.gold += 3 * stacksAdded; } },

  A2:{ id:"A2", name:"High Roller", desc:"Reroll costs 1g (unique)", stackable:false },

  A3:{ id:"A3", name:"Windfall", desc:"+8g now (stacks)", stackable:true,
       pickNow:(S, stacksAdded)=>{ S.gold += 8 * stacksAdded; } },

  A4:{ id:"A4", name:"Scoped Weapons", desc:"Ranged +35 range (stacks)", stackable:true },
  A5:{ id:"A5", name:"Second Wind", desc:"Once per unit: below 30% HP → heal 20% (unique)", stackable:false },

  A6:{ id:"A6", name:"Knife’s Edge", desc:"+12% ATK, -5% max HP (stacks)", stackable:true },
  A7:{ id:"A7", name:"Thick Skin", desc:"Warriors +6% dmg reduction (stacks)", stackable:true },
  A8:{ id:"A8", name:"Rapid Fire", desc:"Rangers attack faster (stacks)", stackable:true },
};

const EVENTS = [
  {
    id:"E1", name:"Duplicate", desc:"Duplicate a random unit, lose 3 HP",
    apply:(S)=>{
      if (!S.army.length){ showToast("No units to duplicate", "bad"); return; }
      const u = pick(S.army);
      S.army.push(makeUnit(u.name, u.star, "player"));
      S.hp = Math.max(0, S.hp - 3);
      showToast(`Duplicated ${u.name} ★${u.star} (-3 HP)`, "info");
    }
  },
  {
    id:"E2", name:"Gold Rush", desc:"+10g, next battle enemies +15% HP",
    apply:(S)=>{
      S.gold += 10;
      S.nextEnemyMod = { hpMult: 1.15, atkMult: 1.0 };
      showToast("Gold Rush (+10g) — next battle tougher", "info");
    }
  },
  {
    id:"E3", name:"Heal", desc:"+6 HP, lose 4g (if possible)",
    apply:(S)=>{
      const before = S.hp;
      S.hp += 6;
      const loss = Math.min(4, S.gold);
      S.gold -= loss;
      const healed = S.hp - before;
      showToast(`Healed +${healed} HP (-${loss}g)`, "good");
    }
  },
];

/* ===== State ===== */
const SAVE_KEY_V4 = "roguewar_save_v4";
const SAVE_KEY_V3 = "roguewar_save_v3";
const SAVE_KEY_V2 = "roguewar_save_v2";
const SAVE_KEY_V1 = "roguewar_save_v1";

const S = {
  round: 1,
  gold: 10,
  hp: 20,
  streak: 0,

  shop: [],
  army: [],

  items: [],

  // augments as stacks map: {A1:2, A2:1, ...}
  augments: {},

  node: { type:"battle", isElite:false },
  nextEnemyMod: null,

  overlay: "none",
  overlayQueue: [],

  pendingEquip: null,

  P: [],
  E: [],
  projectiles: [],
  floaters: [],

  animT: 0,

  screen: "menu",
  phase: "planning",
  combatRunning: false,
};

const el = {
  btnNewGame: document.getElementById("btnNewGame"),
  btnContinue: document.getElementById("btnContinue"),
  btnHowTo: document.getElementById("btnHowTo"),

  roundVal: document.getElementById("roundVal"),
  goldVal: document.getElementById("goldVal"),
  hpVal: document.getElementById("hpVal"),
  streakVal: document.getElementById("streakVal"),
  unitsPill: document.getElementById("unitsPill"),
  btnMenu: document.getElementById("btnMenu"),
  btnInventory: document.getElementById("btnInventory"),
  btnSynergies: document.getElementById("btnSynergies"),
  btnBonuses: document.getElementById("btnBonuses"),
  btnStart: document.getElementById("btnStart"),
  btnReroll: document.getElementById("btnReroll"),
  shop: document.getElementById("shop"),
  armyBar: document.getElementById("armyBar"),

  battleNodePill: document.getElementById("battleNodePill"),
  battleStats: document.getElementById("battleStats"),
  btnNext: document.getElementById("btnNext"),
  resultTitle: document.getElementById("resultTitle"),
  resultText: document.getElementById("resultText"),
  btnResultNext: document.getElementById("btnResultNext"),
  canvas: document.getElementById("battle"),

  augmentChoices: document.getElementById("augmentChoices"),
  itemRewardCard: document.getElementById("itemRewardCard"),
  btnItemContinue: document.getElementById("btnItemContinue"),
  nodeChoices: document.getElementById("nodeChoices"),
  eventChoices: document.getElementById("eventChoices"),

  synergyList: document.getElementById("synergyList"),
  btnSynClose: document.getElementById("btnSynClose"),

  bonusesList: document.getElementById("bonusesList"),
  btnBonusesClose: document.getElementById("btnBonusesClose"),

  invItems: document.getElementById("invItems"),
  invUnits: document.getElementById("invUnits"),
  invCount: document.getElementById("invCount"),
  invUnitsCount: document.getElementById("invUnitsCount"),
  invHint: document.getElementById("invHint"),
  btnInvClose: document.getElementById("btnInvClose"),
  invSelectedBar: document.getElementById("invSelectedBar"),
  invSelectedText: document.getElementById("invSelectedText"),
  btnInvClearSel: document.getElementById("btnInvClearSel"),

  replaceSub: document.getElementById("replaceSub"),
  replaceChoices: document.getElementById("replaceChoices"),
  btnReplaceCancel: document.getElementById("btnReplaceCancel"),
};

/* ===== Augment helpers ===== */
function augStacks(id){ return (S.augments && S.augments[id]) ? S.augments[id] : 0; }
function hasAug(id){ return augStacks(id) > 0; }
function maxStacksFor(id){
  const a = AUGMENTS[id];
  if (!a) return 0;
  // Stackables uncapped (practically)
  return a.stackable ? 1e9 : 1;
}
function canTakeAug(id){
  const a = AUGMENTS[id];
  if (!a) return false;
  if (a.stackable) return true;
  return augStacks(id) < 1;
}
function addAugment(id, stacksAdded=1){
  if (!S.augments) S.augments = {};
  const a = AUGMENTS[id];
  if (!a) return 0;

  const cur = augStacks(id);
  const max = maxStacksFor(id);

  let add = stacksAdded;
  if (!a.stackable) add = Math.min(add, max - cur);
  add = Math.max(0, add);

  if (add <= 0) return 0;
  const next = Math.min(max, cur + add);
  S.augments[id] = next;

  if (a.pickNow) a.pickNow(S, add, next);
  return add;
}

/* ===== UI state ===== */
function setOverlay(name){
  S.overlay = name;
  document.body.dataset.overlay = name;
  updateButtons();
}

function nextOverlay(){
  const x = S.overlayQueue.shift();
  if (!x){ setOverlay("none"); return; }
  if (x.name === "augment") openAugmentPick();
  else if (x.name === "item") openItemReward(x.payload);
  else if (x.name === "node") openNodeSelect();
  else if (x.name === "event") openEventSelect();
  else if (x.name === "inventory") openInventory();
  else if (x.name === "synergies") openSynergiesOverlay();
  else if (x.name === "bonuses") openBonusesOverlay();
  else setOverlay("none");
}

/* ===== Colors/shapes ===== */
function getClassColor(role){
  if (role === "Front")    return { fill:"#5c86c9", fx:"#8cc0ff" };
  if (role === "Back")     return { fill:"#55d38a", fx:"#78f0ad" };
  if (role === "Mage")     return { fill:"#b27bff", fx:"#d5b6ff" };
  if (role === "Skirmish") return { fill:"#ff8a4c", fx:"#ffd36a" };
  return { fill:"#6aa6ff", fx:"#cfe0ff" };
}
function roleToShape(role){
  if (role === "Front") return "square";
  if (role === "Back") return "triangle";
  if (role === "Skirmish") return "diamond";
  if (role === "Mage") return "hex";
  return "circle";
}
function isRangedUnit(u){
  return (u.role === "Back" || u.role === "Mage" || u.range >= 100);
}

/* ===== Unit creation ===== */
function makeUnit(name, star=1, side="player", forcedId=null){
  const t = UNIT_POOL.find(u=>u.name===name);
  const hpMult = 1 + (star-1)*0.75;
  const atkMult = 1 + (star-1)*0.60;
  const maxHP = Math.round(t.hp * hpMult);
  const clr = getClassColor(t.role);
  return {
    id: forcedId || rndId(),
    name: t.name,
    cost: t.cost,
    rarity: t.rarity || "Common",
    star,
    side,
    role: t.role,
    classTag: t.classTag,
    originTag: t.originTag,

    shape: roleToShape(t.role),
    classFill: clr.fill,
    classFx: clr.fx,

    maxHP,
    hp: maxHP,
    atk: Math.round(t.atk * atkMult),
    spd: t.spd,
    range: t.range,

    itemSlotsMax: raritySlots(t.rarity || "Common"),
    items: [],

    x:0,y:0, cd:0, alive:true,
    swingT:0, aimA:0,
  };
}

function makeOffer(template){
  return {
    offerId: rndId(),
    name: template.name,
    rarity: template.rarity || "Common",
    cost: template.cost,
    hp: template.hp,
    atk: template.atk,
    spd: template.spd,
    range: template.range,
    role: template.role,
    classTag: template.classTag,
    originTag: template.originTag,
    itemSlotsMax: raritySlots(template.rarity || "Common"),
  };
}

/* ===== Save/Load ===== */
function serializeState(){
  return {
    v: 4,
    ended: (S.hp <= 0),
    round: S.round,
    gold: S.gold,
    hp: S.hp,
    streak: S.streak,
    augments: S.augments || {},
    items: S.items.slice(),
    node: S.node,
    nextEnemyMod: S.nextEnemyMod,
    army: S.army.map(u => ({
      id:u.id, name:u.name, star:u.star,
      rarity:u.rarity,
      items: (u.items || []).slice(),
      classTag:u.classTag,
      originTag:u.originTag,
    })),
  };
}
function saveGame(){
  try{ localStorage.setItem(SAVE_KEY_V4, JSON.stringify(serializeState())); }catch(e){}
  refreshContinueBtn();
}
function clearSave(){
  try{ localStorage.removeItem(SAVE_KEY_V4); }catch(e){}
  refreshContinueBtn();
}

function normalizeAugmentsFromLegacy(a){
  // Filters unknown IDs (including removed trait crests) automatically.
  if (Array.isArray(a)){
    const map = {};
    for (const id of a){
      if (!AUGMENTS[id]) continue;
      map[id] = (map[id]||0) + 1;
    }
    // unique clamp
    for (const id of Object.keys(map)){
      if (!AUGMENTS[id].stackable) map[id] = Math.min(map[id], 1);
      else map[id] = Math.min(map[id], 1e9);
    }
    return map;
  }
  if (a && typeof a === "object"){
    const out = {};
    for (const [id,val] of Object.entries(a)){
      if (!AUGMENTS[id]) continue;
      const n = Math.max(0, Math.floor(Number(val)||0));
      out[id] = n;
      if (!AUGMENTS[id].stackable) out[id] = Math.min(out[id], 1);
      else out[id] = Math.min(out[id], 1e9);
    }
    return out;
  }
  return {};
}

function loadGame(){
  try{
    let raw = localStorage.getItem(SAVE_KEY_V4);
    let data = raw ? JSON.parse(raw) : null;

    if (!data){
      raw = localStorage.getItem(SAVE_KEY_V3);
      data = raw ? JSON.parse(raw) : null;
    }

    if (!data || data.ended) return false;

    S.round = data.round ?? 1;
    S.gold = data.gold ?? 10;
    S.hp = data.hp ?? 20;
    S.streak = data.streak ?? 0;

    S.augments = normalizeAugmentsFromLegacy(data.augments);
    S.items = Array.isArray(data.items) ? data.items : [];
    S.node = data.node || {type:"battle", isElite:false};
    S.nextEnemyMod = data.nextEnemyMod || null;

    S.army = (data.army || []).map(a=>{
      const u = makeUnit(a.name, a.star, "player", a.id);
      u.rarity = a.rarity || u.rarity;
      u.itemSlotsMax = raritySlots(u.rarity);
      u.items = Array.isArray(a.items) ? a.items : [];
      u.classTag = a.classTag || u.classTag;
      u.originTag = a.originTag || u.originTag;
      return u;
    });

    rerollShop(true);
    renderAll();
    setScreen("planning");
    setPhase("planning");
    showToast("Continued run", "info");
    saveGame();
    return true;
  }catch(e){
    return false;
  }
}
function tryMigrateV2(){
  try{
    const raw = localStorage.getItem(SAVE_KEY_V2);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.ended) return false;

    S.round = data.round ?? 1;
    S.gold = data.gold ?? 10;
    S.hp = data.hp ?? 20;
    S.streak = data.streak ?? 0;
    S.augments = normalizeAugmentsFromLegacy(data.augments);
    S.items = Array.isArray(data.items) ? data.items : [];
    S.node = data.node || {type:"battle", isElite:false};
    S.nextEnemyMod = data.nextEnemyMod || null;

    S.army = (data.army || []).map(a=>{
      const u = makeUnit(a.name, a.star, "player", a.id);
      if (a.item && a.item.type){
        u.items = [{ id:rndId(), type:a.item.type, tier: a.item.tier||1 }];
      } else u.items = [];
      return u;
    });

    rerollShop(true);
    saveGame();
    refreshContinueBtn();
    return true;
  }catch(e){
    return false;
  }
}
function tryMigrateV1(){
  try{
    const raw = localStorage.getItem(SAVE_KEY_V1);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.ended) return false;

    S.round = data.round ?? 1;
    S.gold = data.gold ?? 10;
    S.hp = data.hp ?? 20;
    S.streak = data.streak ?? 0;
    S.augments = {};
    S.items = [];
    S.node = {type:"battle", isElite:false};
    S.nextEnemyMod = null;

    S.army = (data.army || []).map(a => makeUnit(a.name, a.star, "player", a.id));
    rerollShop(true);
    saveGame();
    refreshContinueBtn();
    return true;
  }catch(e){
    return false;
  }
}

function refreshContinueBtn(){
  try{
    const raw = localStorage.getItem(SAVE_KEY_V4) || localStorage.getItem(SAVE_KEY_V3);
    if (!raw){ el.btnContinue.disabled = true; return; }
    const data = JSON.parse(raw);
    el.btnContinue.disabled = !data || data.ended;
  }catch(e){
    el.btnContinue.disabled = true;
  }
}

/* ===== Screen state ===== */
function setScreen(screen){
  S.screen = screen;
  document.body.dataset.screen = screen;
  document.body.dataset.result = "hide";
  setTimeout(resizeCanvas, 40);
  renderStats();
  updateButtons();
}
function setPhase(phase){
  S.phase = phase;
  renderStats();
  updateButtons();
}

function renderStats(){
  el.roundVal.textContent = S.round;
  el.goldVal.textContent = S.gold;
  el.hpVal.textContent = S.hp;
  el.streakVal.textContent = S.streak;
  el.unitsPill.textContent = `Units: ${S.army.length}`;
  el.battleStats.textContent = `Round ${S.round} • Gold ${S.gold} • HP ${S.hp} • Streak ${S.streak}`;
  el.battleNodePill.textContent = S.node.isElite ? "ELITE" : (S.node.type || "BATTLE").toUpperCase();

  const rerollCost = hasAug("A2") ? 1 : 2;
  el.btnReroll.textContent = `Reroll (${rerollCost}g)`;
}

function updateButtons(){
  const overlayOpen = (S.overlay !== "none");

  el.btnStart.disabled = overlayOpen || !(S.screen === "planning") || (S.army.length === 0);
  el.btnReroll.disabled = overlayOpen || !(S.screen === "planning");
  el.btnInventory.disabled = !(S.screen === "planning");
  el.btnMenu.disabled = !(S.screen === "planning");
  el.btnSynergies.disabled = !(S.screen === "planning");
  el.btnBonuses.disabled = !(S.screen === "planning");

  const canAdvance = (!overlayOpen && S.screen === "battle" && S.phase === "result" && S.hp > 0);
  el.btnNext.disabled = !canAdvance;
  el.btnResultNext.disabled = !canAdvance;
}

/* =========================================================
   SYNERGIES
========================================================= */
function getTraitCounts(units){
  const c = { Warrior:0, Ranger:0, Mage:0, Rogue:0, Kingdom:0, Wilds:0, Cult:0 };
  for (const u of units){
    if (u.classTag && c[u.classTag] != null) c[u.classTag]++;
    if (u.originTag && c[u.originTag] != null) c[u.originTag]++;
  }
  return c;
}
function traitTier(name, count){
  const tiers = TRAIT_BREAKPOINTS[name] || [];
  let t = 0;
  for (const req of tiers) if (count >= req) t++;
  const nextReq = tiers[t] ?? null;
  return { tier:t, nextReq, tiers };
}
function openSynergiesOverlay(){
  setOverlay("synergies");
  renderSynergiesOverlay();
}
function renderSynergiesOverlay(){
  el.synergyList.innerHTML = "";
  const counts = getTraitCounts(S.army);
  const order = ["Warrior","Ranger","Mage","Rogue","Kingdom","Wilds","Cult"];

  for (const k of order){
    const n = counts[k] || 0;
    const tt = traitTier(k, n);
    const active = tt.tier > 0;

    const tierText = active ? `ACTIVE (tier ${tt.tier})` : (tt.nextReq ? `Next: ${tt.nextReq}` : "—");
    const card = document.createElement("div");
    card.className = "choiceCard";
    card.style.borderColor = active ? "rgba(85,211,138,0.75)" : "rgba(42,58,99,0.95)";
    card.innerHTML = `
      <div class="name"><span>${k} — ${n}</span><span class="rarMini">${tierText}</span></div>
      <div class="desc">${tt.tiers && tt.tiers.length ? `Breakpoints: ${tt.tiers.join(", ")}` : "No breakpoints"}</div>
    `;
    el.synergyList.appendChild(card);
  }
}

/* ===== Bonuses modal ===== */
function pct(n){ return Math.round(n*100); }
function synergyBonusDesc(trait, tier, counts){
  if (tier <= 0) return "";
  const n = counts[trait] || 0;
  const t = clamp(tier, 1, 5) - 1;

  switch(trait){
    case "Warrior": {
      const m = SYNERGY_EFFECTS.Warrior.hpMult[t];
      return `Team max HP x${m.toFixed(2)}.`;
    }
    case "Ranger": {
      const s = SYNERGY_EFFECTS.Ranger.atkSpeed[t];
      return `Team attack speed +${pct(s)}%.`;
    }
    case "Mage": {
      const m = SYNERGY_EFFECTS.Mage.atkMult[t];
      return `Team ATK x${m.toFixed(2)}.`;
    }
    case "Rogue": {
      const fh = SYNERGY_EFFECTS.Rogue.firstHit[t];
      const mv = SYNERGY_EFFECTS.Rogue.move[t];
      return `First hit +${pct(fh)}% dmg • Move +${pct(mv)}%.`;
    }
    case "Kingdom": {
      const dr = SYNERGY_EFFECTS.Kingdom.frontDR[t];
      return `Frontliners damage reduction +${pct(dr)}%.`;
    }
    case "Wilds": {
      const rp = SYNERGY_EFFECTS.Wilds.regenPct[t];
      return `Team regen ${pct(rp)}% max HP / sec.`;
    }
    case "Cult": {
      const sp = SYNERGY_EFFECTS.Cult.shieldOnKillPct[t];
      const sd = SYNERGY_EFFECTS.Cult.shieldDur[t];
      return `On kill: shield ${pct(sp)}% max HP for ${sd.toFixed(1)}s.`;
    }
    default:
      return "";
  }
}

function collectTeamItemBuffs(){
  const agg = new Map();
  for (const u of S.army){
    const arr = Array.isArray(u.items) ? u.items : [];
    for (const it of arr){
      if (!it || !it.type) continue;
      const def = ITEMS[it.type];
      if (!def || !def.teamBuff) continue;
      const tb = def.teamBuff;
      const key = tb.key || tb.label || def.name;
      const cur = agg.get(key) || { key, label: tb.label || def.name, value: 0, stacks: 0 };
      cur.stacks += 1;
      // I12 value scales with tier
      if (it.type === "I12"){
        const t = it.tier || 1;
        cur.value += t === 3 ? 0.38 : t === 2 ? 0.22 : 0.10;
      } else {
        cur.value += Number(tb.value || 0);
      }
      agg.set(key, cur);
    }
  }
  return Array.from(agg.values());
}

function renderBonusesOverlay(){
  el.bonusesList.innerHTML = "";

  const counts = getTraitCounts(S.army);
  const order = ["Warrior","Ranger","Mage","Rogue","Kingdom","Wilds","Cult"];

  function section(title){
    const h = document.createElement("div");
    h.className = "choiceCard";
    h.style.background = "rgba(10,14,24,0.88)";
    h.style.borderColor = "rgba(42,58,99,0.95)";
    h.innerHTML = `<div class="name"><span>${title}</span><span class="rarMini">Active</span></div>`;
    el.bonusesList.appendChild(h);
  }
  function entry(name, desc, tagText=""){
    const card = document.createElement("div");
    card.className = "choiceCard";
    card.innerHTML = `
      <div class="name"><span>${name}</span>${tagText ? `<span class="rarMini">${tagText}</span>` : ""}</div>
      <div class="desc">${desc}</div>
    `;
    el.bonusesList.appendChild(card);
  }
  function none(){
    const card = document.createElement("div");
    card.className = "choiceCard";
    card.innerHTML = `<div class="name"><span>None</span><span class="rarMini">—</span></div><div class="desc">No bonuses active in this section.</div>`;
    el.bonusesList.appendChild(card);
  }

  section("Synergy Bonuses");
  let anySyn = false;
  for (const k of order){
    const n = counts[k] || 0;
    const tt = traitTier(k, n);
    if (tt.tier > 0){
      anySyn = true;
      entry(`${k} (${n})`, synergyBonusDesc(k, tt.tier, counts), `Tier ${tt.tier}`);
    }
  }
  if (!anySyn) none();

  section("Team Item Bonuses");
  const buffs = collectTeamItemBuffs();
  if (!buffs.length){
    none();
  } else {
    for (const b of buffs){
      const pctVal = (Math.abs(b.value) <= 1.0) ? Math.round(b.value * 100) : b.value;
      const stackTxt = (b.stacks > 1) ? `x${b.stacks}` : "";
      entry(`${b.label}${stackTxt ? ` (${stackTxt})` : ""}`, `Total: +${pctVal}%`, "Team");
    }
  }

  section("Global Upgrades / Augments");
  const ids = Object.keys(S.augments || {}).filter(id => augStacks(id) > 0);
  if (!ids.length){
    none();
  } else {
    for (const id of ids){
      const a = AUGMENTS[id];
      if (!a) continue;
      const st = augStacks(id);
      const tag = a.stackable ? `x${st}` : "Unique";
      entry(a.name, a.desc, tag);
    }
  }
}
function openBonusesOverlay(){
  setOverlay("bonuses");
  renderBonusesOverlay();
}

/* ===== Shop RNG ===== */
function rarityOddsByRound(round, isEliteNext=false){
  let o;
  if (round <= 2){
    o = {Common:0.80, Uncommon:0.18, Rare:0.02, Epic:0.00, Legendary:0.00};
  } else if (round <= 5){
    o = {Common:0.55, Uncommon:0.35, Rare:0.09, Epic:0.01, Legendary:0.00};
  } else if (round <= 9){
    o = {Common:0.35, Uncommon:0.40, Rare:0.20, Epic:0.04, Legendary:0.01};
  } else {
    o = {Common:0.20, Uncommon:0.35, Rare:0.30, Epic:0.12, Legendary:0.03};
  }

  if (isEliteNext){
    const addEpic = 0.02, addLeg = 0.01;
    o.Epic += addEpic;
    o.Legendary += addLeg;
    const take = addEpic + addLeg;
    const takeC = Math.min(o.Common, take * 0.75);
    o.Common -= takeC;
    o.Uncommon = Math.max(0, o.Uncommon - (take - takeC));
  }

  const sum = Object.values(o).reduce((a,b)=>a+b,0) || 1;
  for (const k of Object.keys(o)) o[k] /= sum;
  return o;
}
function rollRarity(odds){
  let r = Math.random();
  for (const k of ["Common","Uncommon","Rare","Epic","Legendary"]){
    r -= odds[k] || 0;
    if (r <= 0) return k;
  }
  return "Common";
}
function pickUnitTemplateByRarity(rarity){
  const pool = UNIT_POOL.filter(u => (u.rarity || "Common") === rarity);
  if (!pool.length){
    const fallback = ["Legendary","Epic","Rare","Uncommon","Common"];
    for (const rr of fallback){
      const p2 = UNIT_POOL.filter(u => (u.rarity||"Common") === rr);
      if (p2.length) return pick(p2);
    }
    return UNIT_POOL[0];
  }
  return pick(pool);
}

/* ===== Shop ===== */
function rerollShop(free=false){
  const cost = hasAug("A2") ? 1 : 2;
  if (!free){
    if (S.gold < cost){ showToast("Not enough gold", "bad"); return; }
    S.gold -= cost;
    showToast(`Shop rerolled (-${cost}g)`, "info");
  }

  const odds = rarityOddsByRound(S.round, !!S.node?.isElite);
  S.shop = Array.from({length:5}, ()=>{
    const rar = rollRarity(odds);
    const t = pickUnitTemplateByRarity(rar);
    return makeOffer(t);
  });

  renderAll();
  saveGame();
}

function buyOffer(offerId){
  const idx = S.shop.findIndex(o => o.offerId === offerId);
  if (idx < 0) return;
  const offer = S.shop[idx];
  if (S.gold < offer.cost){ showToast("Not enough gold", "bad"); return; }

  S.gold -= offer.cost;
  const u = makeUnit(offer.name, 1, "player");
  S.army.push(u);
  S.shop.splice(idx, 1);

  showToast(`${offer.name} ★1 recruited`, "info");
  mergeAllSafe();
  renderAll();
  saveGame();
}

/* ===== Items: helpers ===== */
function itemLabel(type){
  return ITEMS[type]?.name || "Item";
}
function itemRarity(type){
  return ITEMS[type]?.rarity || "Common";
}
function itemDesc(type){
  return ITEMS[type]?.desc || "";
}
function renderSlotRowHTML(unit){
  const max = unit.itemSlotsMax || 1;
  const have = (unit.items||[]);
  let html = `<div class="slotRow">`;
  for (let i=0;i<max;i++){
    if (have[i] && have[i].type){
      const _st = have[i].tier||1; html += `<span class="slotPill">${itemLabel(have[i].type)}${_st>1?" "+itemTierLabel(_st):""}</span>`;
    } else {
      html += `<span class="slotPill slotEmpty">—</span>`;
    }
  }
  html += `</div>`;
  return html;
}

/* ===== Merge (returns items; upgraded unit starts empty) ===== */
function mergeAllSafe(){
  let didMerge = true;
  const mergeMessages = [];
  let totalReturned = 0;

  while (didMerge){
    didMerge = false;

    const map = new Map();
    for (const u of S.army){
      const k = `${u.name}__${u.star}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(u.id);
    }

    let chosen = null;
    for (const [k, ids] of map.entries()){
      if (ids.length >= 3){
        const [name, starStr] = k.split("__");
        const star = Number(starStr);
        if (star >= 3) continue;
        chosen = { name, star, idsToConsume: ids.slice(0,3) };
        break;
      }
    }
    if (!chosen) break;

    const consumeSet = new Set(chosen.idsToConsume);
    const consumedUnits = S.army.filter(u => consumeSet.has(u.id));

    let returnedThisMerge = 0;
    for (const cu of consumedUnits){
      const arr = Array.isArray(cu.items) ? cu.items : [];
      for (const it of arr){
        if (it && it.type){
          S.items.push({ id:rndId(), type: it.type, tier: it.tier||1 });
          returnedThisMerge++;
        }
      }
    }
    totalReturned += returnedThisMerge;

    S.army = S.army.filter(u => !consumeSet.has(u.id));

    const newStar = Math.min(3, chosen.star + 1);
    const nu = makeUnit(chosen.name, newStar, "player");
    nu.items = [];
    S.army.push(nu);

    mergeMessages.push(`Merged ${chosen.name} ★${chosen.star} → ★${newStar}${returnedThisMerge ? ` (+${returnedThisMerge} items)` : ""}`);
    didMerge = true;
  }

  if (mergeMessages.length){
    const msg = totalReturned
      ? `${mergeMessages[0]}${mergeMessages.length>1 ? ` (+${mergeMessages.length-1} more)` : ""} • returned ${totalReturned} item${totalReturned>1?"s":""}`
      : `${mergeMessages[0]}${mergeMessages.length>1 ? ` (+${mergeMessages.length-1} more)` : ""}`;
    showToast(msg, "good");
    if (S.overlay === "inventory") renderInventory();
  }
}

/* ===== Render ===== */
function renderShop(){
  el.shop.innerHTML = "";
  if (!S.shop.length){
    const empty = document.createElement("div");
    empty.className = "card";
    empty.style.flexBasis = "260px";
    empty.innerHTML = `<div class="rarStrip" style="background:${rarityColor("Common")}"></div><h4>Empty</h4><div class="line">Reroll for new offers.</div>`;
    el.shop.appendChild(empty);
    return;
  }

  for (const offer of S.shop){
    const clr = getClassColor(offer.role);
    const rarCol = rarityColor(offer.rarity);

    const card = document.createElement("div");
    card.className = "card";

    const strip = document.createElement("div");
    strip.className = "rarStrip";
    strip.style.background = rarCol;
    card.appendChild(strip);

    const h = document.createElement("h4");
    h.innerHTML = `<span>${offer.name} (${offer.cost}g)</span>`;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.style.background = clr.fill;
    h.appendChild(badge);

    const tags = `${offer.classTag}/${offer.originTag}`;
    const l0 = document.createElement("div");
    l0.className="line";
    l0.innerHTML = `<span style="color:${rarCol}; font-weight:1000;">${offer.rarity}</span> • Slots ${offer.itemSlotsMax}`;

    const l1 = document.createElement("div");
    l1.className="line";
    l1.textContent = `HP ${offer.hp} • ATK ${offer.atk} • ${offer.role}`;

    const l2 = document.createElement("div");
    l2.className="line";
    l2.textContent = `${tags} • Range ${offer.range}px • Spd ${offer.spd}s`;

    const btn = document.createElement("button");
    btn.textContent = "Buy";
    btn.disabled = (S.gold < offer.cost);
    btn.addEventListener("click", ()=>buyOffer(offer.offerId));

    card.appendChild(h);
    card.appendChild(l0);
    card.appendChild(l1);
    card.appendChild(l2);
    card.appendChild(btn);
    el.shop.appendChild(card);
  }
}

function renderArmy(){
  el.armyBar.innerHTML = "";
  if (!S.army.length){
    const chip = document.createElement("div");
    chip.className="chip";
    chip.style.opacity="0.85";
    chip.style.minWidth="220px";
    chip.innerHTML = `<div class="t">No units</div><div class="m">Buy units to start</div>`;
    el.armyBar.appendChild(chip);
    return;
  }

  for (const u of S.army){
    const rarCol = rarityColor(u.rarity || "Common");
    const chip = document.createElement("div");
    chip.className="chip";
    chip.style.borderLeftColor = rarCol;

    const slotsMax = u.itemSlotsMax || raritySlots(u.rarity||"Common");
    const slotsHave = (u.items||[]).filter(x=>x && x.type).length;

    chip.innerHTML = `
      <div class="t">
        <span>${u.name} ${"★".repeat(u.star)}</span>
        <span class="rarMini" style="border-color:${rarCol}; color:${rarCol};">${u.rarity}</span>
      </div>
      <div class="s">${u.maxHP} HP • ${u.atk} ATK • Slots ${slotsHave}/${slotsMax}</div>
      ${renderSlotRowHTML(u)}
      <div class="m">${u.classTag}/${u.originTag}</div>
    `;
    el.armyBar.appendChild(chip);
  }
}

function renderAll(){
  renderStats();
  renderShop();
  renderArmy();
  if (S.overlay === "synergies") renderSynergiesOverlay();
  if (S.overlay === "bonuses") renderBonusesOverlay();
  if (S.overlay === "inventory") renderInventory();
  updateButtons();
}

/* ===== Canvas ===== */
const ctx = el.canvas.getContext("2d");
let W=0, H=0;
function resizeCanvas(){
  const rect = el.canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  W = Math.floor(rect.width * dpr);
  H = Math.floor(rect.height * dpr);
  el.canvas.width = W;
  el.canvas.height = H;
}
window.addEventListener("resize", () => { resizeCanvas(); });

/* =========================================================
   COMBAT STAT PIPELINE (single deterministic pass)
   Order:
   1) Base stats from roster unit (already star-scaled there)
   2) Init combat-only fields
   3) Synergy bonuses (tier-based)
   4) Augment bonuses
   5) Team auras (Chrono Relic)
   6) Per-unit items (apply() LAST)
========================================================= */
function initCombatFields(c){
  c.hp = c.maxHP;
  c.cd = 0;
  c.alive = true;
  c.swingT = 0;
  c.aimA = 0;

  c.moveMult = 1.0;
  c.damageReduction = 0.0;
  c.regenPerSec = 0.0;
  c.lifesteal = 0.0;
  c.bombReady = false;
  c.firstHitBonus = 0.0;
  c.firstHitReady = true;
  c.secondWindUsed = false;
  c.shield = 0;
  c.shieldTimer = 0;

  c.chainEvery = 0;
  c.chainReady = 0;
  c.chainTargets = 1;
  c.chainDmgMult = 1.0;
  c.startShield = 0;
  c.shieldRefreshOnKill = false;
  c.reviveOnce = false;
  c.revived = false;
  c.reviveCount = 0;
  c.reviveHpPct = 0.25;
  c.reviveBonusAtk = 0;
  c.bombCharges = 0;
  c.bombEvery = 0;
  c.bombCounter = 0;
  c.pierceEvery = 0;

  c.healPulseCd = 0;
  c.pierceCounter = 0;
  c.trapUsed = false;
  c.blinkCd = 0;
  c.auraApplied = false;
  c.enrage = 0;

  c.tagCd = 0;
  c.rootT = 0;

  // cult shield config (tier-based)
  c.cultTier = 0;          // 0..5
  c.cultShieldPct = 0.0;
  c.cultShieldDur = 0.0;
}

function cloneForCombat(rosterU, side){
  const c = JSON.parse(JSON.stringify(rosterU));
  c.side = side;
  c.rosterId = rosterU.id;
  initCombatFields(c);
  return c;
}

function computeTeamAuraFromRoster(army){
  let atkSpeedBonus = 0;
  for (const u of army){
    const arr = Array.isArray(u.items) ? u.items : [];
    for (const it of arr){
      if (it && it.type === "I12"){
        const t = it.tier || 1;
        atkSpeedBonus += t === 3 ? 0.38 : t === 2 ? 0.22 : 0.10;
      }
    }
  }
  return {
    chronoStacks: 0,  // legacy compat
    atkSpeedBonus,
  };
}

function computeCombatStatsFromRoster(rosterUnit, traitCounts, teamAura){
  // Base (already star-scaled on roster)
  const c = cloneForCombat(rosterUnit, "player");

  const base = {
    maxHP: c.maxHP,
    atk: c.atk,
    spd: c.spd,
    range: c.range
  };

  // Explicit multiplier/additive fields
  let hpMult = 1.0;
  let atkMult = 1.0;
  let spdMult = 1.0;   // finalSpd = baseSpd / spdMult (higher -> faster)
  let rangeAdd = 0;
  let moveMult = 1.0;
  let damageReductionAdd = 0.0;
  let regenPct = 0.0;

  let firstHitBonus = 0.0;

  // 3) Synergies (tier-based)
  const counts = traitCounts || {};
  for (const trait of ["Warrior","Ranger","Mage","Rogue","Kingdom","Wilds","Cult"]){
    const n = counts[trait] || 0;
    const tt = traitTier(trait, n);
    if (tt.tier <= 0) continue;

    const tIndex = clamp(tt.tier, 1, 5) - 1;

    if (trait === "Warrior"){
      hpMult *= SYNERGY_EFFECTS.Warrior.hpMult[tIndex];
    } else if (trait === "Ranger"){
      const atkSpeed = SYNERGY_EFFECTS.Ranger.atkSpeed[tIndex];
      spdMult *= (1 + atkSpeed);
    } else if (trait === "Mage"){
      atkMult *= SYNERGY_EFFECTS.Mage.atkMult[tIndex];
    } else if (trait === "Rogue"){
      firstHitBonus = Math.max(firstHitBonus, SYNERGY_EFFECTS.Rogue.firstHit[tIndex]);
      moveMult *= (1 + SYNERGY_EFFECTS.Rogue.move[tIndex]);
    } else if (trait === "Kingdom"){
      if (c.role === "Front"){
        damageReductionAdd += SYNERGY_EFFECTS.Kingdom.frontDR[tIndex];
      }
    } else if (trait === "Wilds"){
      regenPct += SYNERGY_EFFECTS.Wilds.regenPct[tIndex];
    } else if (trait === "Cult"){
      c.cultTier = tt.tier;
      c.cultShieldPct = SYNERGY_EFFECTS.Cult.shieldOnKillPct[tIndex];
      c.cultShieldDur = SYNERGY_EFFECTS.Cult.shieldDur[tIndex];
    }
  }

  // 4) Augments
  const scopedStacks = augStacks("A4");
  if (scopedStacks > 0 && isRangedUnit(c)) rangeAdd += 35 * scopedStacks;

  const knifeStacks = augStacks("A6");
  if (knifeStacks > 0){
    atkMult *= Math.pow(1.12, knifeStacks);
    hpMult  *= Math.pow(0.95, knifeStacks);
  }

  const thickStacks = augStacks("A7");
  if (thickStacks > 0 && c.classTag === "Warrior"){
    damageReductionAdd += 0.06 * thickStacks;
  }

  const rapidStacks = augStacks("A8");
  if (rapidStacks > 0 && c.classTag === "Ranger"){
    // old behavior: spd *= 0.92 per stack => spdMult *= (1/0.92)^stacks
    spdMult *= Math.pow(1/0.92, rapidStacks);
  }

  // 5) Team aura (Chrono Relic) - stacks (each is +10% attack speed)
  if (teamAura && teamAura.atkSpeedBonus > 0){
    spdMult *= (1 + teamAura.atkSpeedBonus);
  }

  // Resolve once
  c.maxHP = Math.max(1, Math.round(base.maxHP * hpMult));
  c.atk   = Math.max(1, Math.round(base.atk * atkMult));
  c.range = Math.max(1, Math.round(base.range + rangeAdd));
  c.spd   = base.spd / Math.max(0.0001, spdMult);
  c.spd   = clamp(c.spd, 0.20, 9.0);

  c.moveMult = (c.moveMult || 1) * moveMult;
  c.firstHitBonus = firstHitBonus;

  c.damageReduction = clamp(damageReductionAdd, 0, 0.65);
  c.regenPerSec = regenPct * c.maxHP;

  c.hp = c.maxHP;

  // 6) Per-unit items LAST (then re-derive regenPerSec from regenPct so HP items affect regen)
  const arr = Array.isArray(c.items) ? c.items : [];
  for (const it of arr){
    if (!it || !it.type) continue;
    const def = ITEMS[it.type];
    const tierData = getItemTier(def, it.tier || 1);
    if (tierData && tierData.apply) tierData.apply(c);
  }

  c.maxHP = Math.max(1, c.maxHP|0);
  c.atk   = Math.max(1, c.atk|0);
  c.spd   = clamp(Number(c.spd)||0.9, 0.20, 9.0);
  c.range = Math.max(1, c.range|0);
  c.damageReduction = clamp(Number(c.damageReduction)||0, 0, 0.65);

  // regen derived after items too
  c.regenPerSec = regenPct * c.maxHP;

  if (DEBUG_STATS){
    const dbg = {
      unit: `${rosterUnit.name} ★${rosterUnit.star}`,
      base,
      multipliers: { hpMult, atkMult, spdMult, rangeAdd, moveMult, damageReductionAdd, regenPct, firstHitBonus },
      final: { maxHP:c.maxHP, atk:c.atk, spd:c.spd, range:c.range, dr:c.damageReduction, regenPerSec:c.regenPerSec, chronoStacks:(teamAura?.chronoStacks||0) },
      aug: { A4:scopedStacks, A6:knifeStacks, A7:thickStacks, A8:rapidStacks },
      traits: traitCounts
    };
    console.log("[DEBUG_STATS] computeCombatStatsFromRoster", dbg);
    if (!(c.maxHP>0) || !(c.atk>0) || !(c.spd>0) || !(c.range>0)) console.error("[DEBUG_STATS] invalid stats (clamped)", dbg);
  }

  return c;
}

/* =========================================================
   ENEMY SPAWNS (round scaling ramps until inevitable loss)
========================================================= */
function enemyRoundScaling(round){
  const r = Math.max(1, round);
  const x = (r - 1);
  // Early gentle, later steep
  const roundHpMult  = 1 + 0.10*x + 0.01*x*x;
  const roundAtkMult = 1 + 0.06*x + 0.006*x*x;
  return { roundHpMult, roundAtkMult };
}

function spawnEnemyWave(){
  const r = S.round;
  const baseCount = Math.min(22, 3 + Math.floor(r/2) + Math.floor((r-1)/7)); // slight extra count over time
  const count = S.node.isElite ? Math.min(26, baseCount + 2) : baseCount;

  const odds = rarityOddsByRound(r, !!S.node?.isElite);

  const { roundHpMult, roundAtkMult } = enemyRoundScaling(r);

  const eliteMultHp = S.node.isElite ? 1.25 : 1.0;
  const eliteMultAtk = S.node.isElite ? 1.10 : 1.0;

  const nextHp = (S.nextEnemyMod?.hpMult || 1.0);
  const nextAtk = (S.nextEnemyMod?.atkMult || 1.0);

  const finalHpMult = eliteMultHp * roundHpMult * nextHp;
  const finalAtkMult = eliteMultAtk * roundAtkMult * nextAtk;

  S.E = [];
  for (let i=0;i<count;i++){
    const rar = rollRarity(odds);
    const t = pickUnitTemplateByRarity(rar);

    // enemies also ramp star slightly as round increases
    const starRoll = Math.random();
    let star = 1;
    if (r >= 7 && starRoll < 0.22) star = 2;
    if (r >= 12 && starRoll < 0.08) star = 3;

    const e = makeUnit(t.name, star, "enemy");
    e.maxHP = Math.max(1, Math.round(e.maxHP * finalHpMult));
    e.hp = e.maxHP;
    e.atk = Math.max(1, Math.round(e.atk * finalAtkMult));
    e.items = [];
    S.E.push(e);
  }

  S.nextEnemyMod = null;
}

/* ===== Formation deployment ===== */
function deployArmies(){
  S.projectiles = [];
  S.floaters = [];

  const counts = getTraitCounts(S.army);
  const aura = computeTeamAuraFromRoster(S.army);

  S.P = S.army.map(u => computeCombatStatsFromRoster(u, counts, aura));
  S.E = S.E.map(u => {
    const c = cloneForCombat(u, "enemy");
    // Ensure enemy hp is set after cloning
    c.hp = c.maxHP;
    return c;
  });

  if (DEBUG_STATS){
    try{
      const p = S.P.find(x=>x && x.alive);
      const e = S.E.find(x=>x && x.alive);
      if (p) console.log("[DEBUG_STATS] Sample Player Unit", {name:p.name, maxHP:p.maxHP, atk:p.atk, spd:p.spd, range:p.range, dr:p.damageReduction, regenPerSec:p.regenPerSec});
      if (e) console.log("[DEBUG_STATS] Sample Enemy Unit", {name:e.name, maxHP:e.maxHP, atk:e.atk, spd:e.spd, range:e.range});
    }catch(err){}
  }

  const centerLineX = W/2;
  const sidePadX = W*0.08;
  const topPadY  = H*0.14;
  const bottomPadY = H*0.10;
  const usableH = Math.max(80, H - topPadY - bottomPadY);

  const frontDepth = W*0.12;
  const backGap = W*0.08;

  function splitGroups(arr){
    const front = [];
    const back = [];
    const flank = [];
    for (const u of arr){
      if (u.role === "Skirmish") flank.push(u);
      else if (isRangedUnit(u)) back.push(u);
      else front.push(u);
    }
    return {front, back, flank};
  }

  function placeRank(units, baseX, sideSign){
    const n = units.length;
    if (!n) return;

    const maxRowsTarget = 10;
    const cols = Math.min(4, Math.max(1, Math.ceil(n / maxRowsTarget)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const yStep = usableH / (rows + 1);

    const colOffset = Math.max(14, W*0.02);

    for (let i=0;i<n;i++){
      const col = Math.floor(i / rows);
      const row = i % rows;

      let x = baseX + sideSign * (col * colOffset);
      let y = topPadY + (row + 1) * yStep;

      y += (i % 2 ? 6 : -6);
      x += ((i % 3) - 1) * 4;

      x = clamp(x, 16, W-16);
      y = clamp(y, 16, H-16);

      units[i].x = x;
      units[i].y = y;
    }
  }

  function placeFlanks(units, baseX, sideSign){
    const n = units.length;
    if (!n) return;

    const half = Math.ceil(n / 2);
    const topCount = half;
    const botCount = n - half;

    const band = usableH * 0.28;
    const topStart = topPadY;
    const botStart = topPadY + usableH - band;

    const colOffset = Math.max(14, W*0.02);
    const cols = Math.min(3, Math.max(1, Math.ceil(n / 8)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const yStepTop = band / (Math.min(topCount, rows) + 1);
    const yStepBot = band / (Math.min(botCount, rows) + 1);

    for (let i=0;i<n;i++){
      const col = Math.floor(i / rows);
      const row = i % rows;

      let x = baseX + sideSign * (col * colOffset + backGap*0.35);
      let y;

      if (i < topCount){
        y = topStart + (Math.min(row, topCount-1) + 1) * yStepTop;
      } else {
        const j = i - topCount;
        y = botStart + (Math.min(j % rows, Math.max(1, botCount)-1) + 1) * yStepBot;
      }

      y += (i % 2 ? 6 : -6);
      x += ((i % 3) - 1) * 4;

      x = clamp(x, 16, W-16);
      y = clamp(y, 16, H-16);

      units[i].x = x;
      units[i].y = y;
    }
  }

  function placeSide(arr, side){
    const sideSign = (side === "player") ? -1 : 1;
    const {front, back, flank} = splitGroups(arr);

    const frontX = centerLineX + sideSign * frontDepth;
    const backX  = centerLineX + sideSign * (frontDepth + backGap);

    const minX = sidePadX;
    const maxX = W - sidePadX;
    const clampX = (x)=> clamp(x, minX, maxX);

    placeRank(front, clampX(frontX), sideSign);
    placeRank(back,  clampX(backX), sideSign);
    placeFlanks(flank, clampX(frontX), sideSign);
  }

  placeSide(S.P, "player");
  placeSide(S.E, "enemy");

  for (const u of S.P){
    if (u.startShield && u.startShield > 0){
      const amt = u.maxHP * u.startShield;
      u.shield = Math.max(u.shield||0, amt);
      u.shieldTimer = 3.0;
      pushTag(u, "Shield");
    }
  }
}

function alive(arr){ return arr.filter(u => u.alive && u.hp > 0); }
function findNearest(att, enemies){
  let best=null, bestD=1e18;
  for (const e of enemies){
    if (!e.alive) continue;
    const dx = e.x - att.x;
    const dy = e.y - att.y;
    const d = dx*dx + dy*dy;
    if (d < bestD){ bestD=d; best=e; }
  }
  return best;
}
function findWeakestBackliner(enemies){
  const cand = enemies.filter(e=>e.alive && (isRangedUnit(e) || e.role==="Mage"));
  const list = cand.length ? cand : enemies.filter(e=>e.alive);
  if (!list.length) return null;
  let best=list[0];
  for (const e of list){
    if (e.hp < best.hp) best = e;
  }
  return best;
}
function findByIdAnySide(id){
  for (const u of S.P) if (u.id === id) return u;
  for (const u of S.E) if (u.id === id) return u;
  return null;
}

/* ===== Floating numbers ===== */
function pushFloater(x, y, text, kind){
  if (S.floaters.length > 80) S.floaters.shift();
  S.floaters.push({
    x, y,
    text: String(text),
    kind,
    ttl: 0.9,
    vy: -28,
    vx: (Math.random()*18 - 9),
    alpha: 1
  });
}
function pushDamage(tgt, amount){
  pushFloater(tgt.x + (Math.random()*10-5), tgt.y - 18 + (Math.random()*6-3), Math.round(amount), "dmg");
}
function pushHeal(tgt, amount){
  pushFloater(tgt.x + (Math.random()*10-5), tgt.y - 18 + (Math.random()*6-3), `+${Math.round(amount)}`, "heal");
}
function pushShield(tgt, amount){
  pushFloater(tgt.x + (Math.random()*10-5), tgt.y - 18 + (Math.random()*6-3), `Abs ${Math.round(amount)}`, "shield");
}
function pushTag(u, txt){
  if (u.tagCd && u.tagCd > 0) return;
  u.tagCd = 0.5;
  pushFloater(u.x + (Math.random()*10-5), u.y - 34, txt, "tag");
}
function updateFloaters(dt){
  for (let i=S.floaters.length-1;i>=0;i--){
    const f = S.floaters[i];
    f.ttl -= dt;
    f.y += f.vy * dt;
    f.x += f.vx * dt;
    f.alpha = clamp(f.ttl / 0.9, 0, 1);
    if (f.ttl <= 0) S.floaters.splice(i,1);
  }
}

/* ===== Damage system ===== */
function applyDamage(att, tgt, rawDmg){
  if (!tgt.alive) return;
  let dmg = rawDmg;

  if (att && att.firstHitReady && att.firstHitBonus > 0){
    dmg = dmg * (1 + att.firstHitBonus);
    att.firstHitReady = false;
    pushTag(att, "First Hit");
  }

  if (att && att.name === "Berserker"){
    const pct = 1 - (att.hp / att.maxHP);
    if (pct > 0.15){
      const mult = 1 + Math.min(0.35, pct*0.45);
      dmg *= mult;
      if (pct > 0.35) pushTag(att, "Enrage");
    }
  }

  dmg = dmg * (1 - (tgt.damageReduction || 0));

  let absorbed = 0;
  if (tgt.shield && tgt.shield > 0){
    absorbed = Math.min(tgt.shield, dmg);
    tgt.shield -= absorbed;
    dmg -= absorbed;
    if (absorbed > 0) pushShield(tgt, absorbed);
  }

  dmg = Math.max(0, dmg);
  if (dmg > 0) pushDamage(tgt, dmg);

  if (dmg <= 0) return;

  tgt.hp = Math.max(0, tgt.hp - dmg);

  if (att && att.chainEvery && att.chainEvery > 0){
    att.chainReady = (att.chainReady||0) + 1;
    if (att.chainReady >= att.chainEvery){
      att.chainReady = 0;
      const foes = (att.side === "player") ? alive(S.E) : alive(S.P);
      // sort by proximity to target, skip the target itself
      const sorted = foes.filter(f => f.id !== tgt.id).sort((a,b)=>{
        const da = (a.x-tgt.x)**2+(a.y-tgt.y)**2;
        const db = (b.x-tgt.x)**2+(b.y-tgt.y)**2;
        return da-db;
      });
      const targets = att.chainTargets || 1;
      const chainDmg = dmg * 0.30 * (att.chainDmgMult || 1.0);
      let chained = 0;
      for (const f of sorted){
        if (chained >= targets) break;
        const d = (f.x-tgt.x)**2+(f.y-tgt.y)**2;
        if (d <= (100*100)){
          if (chained === 0) pushTag(att, "Chain");
          applyDamage(att, f, chainDmg);
          chained++;
        }
      }
    }
  }

  if (tgt.hp <= 0){
    const revCap = (tgt.reviveCount || 0) || (tgt.reviveOnce && !tgt.revived ? 1 : 0);
    if (revCap > 0 && !tgt._revivesUsed){ tgt._revivesUsed = 0; }
    const usedRevives = tgt._revivesUsed || 0;
    if (revCap > 0 && usedRevives < revCap){
      tgt._revivesUsed = usedRevives + 1;
      tgt.revived = true; // compat
      const hpPct = tgt.reviveHpPct || 0.25;
      tgt.hp = Math.max(1, Math.round(tgt.maxHP * hpPct));
      if (tgt.reviveBonusAtk) tgt.atk = Math.round(tgt.atk * (1 + tgt.reviveBonusAtk));
      pushTag(tgt, "Revive!");
      pushHeal(tgt, tgt.hp);
    } else {
      tgt.alive = false;
      onKill(att, tgt);
    }
  }

  if (att && att.lifesteal && att.lifesteal > 0 && att.alive){
    const heal = dmg * att.lifesteal;
    const before = att.hp;
    att.hp = Math.min(att.maxHP, att.hp + heal);
    const actual = att.hp - before;
    if (actual > 0) pushHeal(att, actual);
  }

  // Bomb splash logic (bombReady / bombCharges / bombEvery)
  let doSplash = false;
  if (att && att.bombReady){ doSplash = true; att.bombReady = false; }
  if (att && att.bombCharges > 0){ doSplash = true; att.bombCharges--; }
  if (att && att.bombEvery > 0){ att.bombCounter = (att.bombCounter||0)+1; if (att.bombCounter >= att.bombEvery){ att.bombCounter = 0; doSplash = true; } }
  if (doSplash){
    const foes = (att.side === "player") ? alive(S.E) : alive(S.P);
    let near=null, best=1e18;
    for (const f of foes){
      if (f.id === tgt.id) continue;
      const dx = f.x - tgt.x; const dy = f.y - tgt.y;
      const d = dx*dx + dy*dy;
      if (d < best){ best=d; near=f; }
    }
    if (near && best <= (50*50)){
      pushTag(att, "Splash");
      applyDamage(att, near, dmg * 0.40);
    }
  }
}

function onKill(att){
  if (!att || !att.alive) return;
  if (att.cultTier && att.cultTier > 0 && att.cultShieldPct > 0){
    const amt = att.maxHP * att.cultShieldPct;
    att.shield = Math.max(att.shield || 0, amt);
    att.shieldTimer = att.cultShieldDur || 2.0;
    pushTag(att, "Cult");
    pushShield(att, amt);
  }
  if (att.shieldRefreshOnKill && att.startShield > 0){
    const amt = att.maxHP * att.startShield;
    att.shield = Math.max(att.shield || 0, amt);
    att.shieldTimer = Math.max(att.shieldTimer||0, 2.0);
    pushTag(att, "Shield+");
    pushShield(att, amt);
  }
}

/* ===== Projectiles + melee swing ===== */
function spawnProjectile(att, target, extra={}) {
  if (S.projectiles.length > 90) S.projectiles.shift();

  const dx = target.x - att.x;
  const dy = target.y - att.y;
  const dist = Math.max(1, Math.sqrt(dx*dx + dy*dy));
  const flight = Math.max(0.22, Math.min(0.45, dist / 520));
  const vx = dx / flight;
  const vy = dy / flight;

  S.projectiles.push({
    x: att.x, y: att.y,
    vx, vy,
    ttl: flight + 0.08,
    targetId: target.id,
    damage: att.atk,
    color: att.classFx || "#cfe0ff",
    attackerId: att.id,
    pierce: !!extra.pierce,
    root: !!extra.root,
    rootDur: extra.rootDur || 0,
  });

  // Used by sprite animation: briefly treat as "attacking" for ranged units.
  att._shotAt = S.animT || 0;
}

function updateProjectiles(dt){
  for (let i=S.projectiles.length-1; i>=0; i--){
    const p = S.projectiles[i];
    p.ttl -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const tgt = findByIdAnySide(p.targetId);
    if (!tgt || !tgt.alive){
      S.projectiles.splice(i,1);
      continue;
    }

    const dx = tgt.x - p.x;
    const dy = tgt.y - p.y;
    const d = Math.sqrt(dx*dx + dy*dy);

    if (d < 14 || p.ttl <= 0){
      const att = findByIdAnySide(p.attackerId);

      if (p.root && tgt.alive){
        tgt.rootT = Math.max(tgt.rootT||0, p.rootDur);
        pushTag(tgt, "Root");
      }

      applyDamage(att, tgt, p.damage);

      if (p.pierce){
        p.ttl = 0.12;
        p.targetId = "";
        p.pierce = false;
      } else {
        S.projectiles.splice(i,1);
      }
    }
  }
}

/* ===== Combat step ===== */
function stepCombat(dt){
  const P = alive(S.P);
  const E = alive(S.E);

  if (P.length === 0 || E.length === 0){
    endCombat(P.length > 0);
    return;
  }

  for (const u of S.P){
    u.swingT = Math.max(0, u.swingT - dt);
    u.tagCd = Math.max(0, (u.tagCd||0) - dt);

    if (u.shieldTimer && u.shieldTimer > 0){
      u.shieldTimer -= dt;
      if (u.shieldTimer <= 0) u.shield = 0;
    }

    if (u.rootT && u.rootT > 0) u.rootT -= dt;

    if (u.regenPerSec && u.regenPerSec > 0 && u.alive){
      const before = u.hp;
      u.hp = Math.min(u.maxHP, u.hp + u.regenPerSec * dt);
      const healed = u.hp - before;
      if (healed > 0 && chance(0.25)) pushHeal(u, healed);
    }

    if (hasAug("A5") && !u.secondWindUsed && u.hp > 0 && u.hp < 0.30*u.maxHP){
      const before = u.hp;
      u.hp = Math.min(u.maxHP, u.hp + 0.20*u.maxHP);
      const healed = u.hp - before;
      u.secondWindUsed = true;
      if (healed > 0){ pushTag(u, "Second Wind"); pushHeal(u, healed); }
    }

    if (u.name === "Healer" && u.alive){
      u.healPulseCd -= dt;
      if (u.healPulseCd <= 0){
        u.healPulseCd = 2.5;
        let low = null;
        for (const a of P){
          if (!a.alive) continue;
          if (!low || (a.hp/a.maxHP) < (low.hp/low.maxHP)) low = a;
        }
        if (low){
          const amt = 18 + (u.star-1)*12;
          const before = low.hp;
          low.hp = Math.min(low.maxHP, low.hp + amt);
          const healed = low.hp - before;
          if (healed > 0){
            pushTag(u, "Heal");
            pushHeal(low, healed);
          }
        }
      }
    }

    if (u.name === "Shade" && u.alive){
      u.blinkCd -= dt;
      if (u.blinkCd <= 0){
        u.blinkCd = 4.0;
        const target = findWeakestBackliner(E);
        if (target){
          u.x = clamp(target.x - 26, 18, W-18);
          u.y = clamp(target.y + (Math.random()*18-9), 18, H-18);
          pushTag(u, "Blink");
        }
      }
    }

    if (u.name === "Warlord" && u.alive){
      for (const a of P){
        if (!a.alive) continue;
        const dx = a.x - u.x, dy = a.y - u.y;
        if (dx*dx + dy*dy <= (110*110)){
          a.damageReduction = clamp((a.damageReduction||0) + 0.0008, 0, 0.65);
        }
      }
    }
  }

  for (const u of S.E){
    u.swingT = Math.max(0, u.swingT - dt);
    if (u.rootT && u.rootT > 0) u.rootT -= dt;
  }

  updateProjectiles(dt);
  updateFloaters(dt);

  function stepSide(friends, foes){
    for (const u of friends){
      u.cd -= dt;
      const t = findNearest(u, foes);
      if (!t) continue;

      const dx = t.x - u.x;
      const dy = t.y - u.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const inRange = dist <= u.range;

      const rooted = (u.rootT && u.rootT > 0);

      if (!inRange && !rooted){
        const baseSpeed = 62 + (u.star-1)*8;
        const speed = baseSpeed * (u.moveMult || 1);
        const nx = dx / (dist||1);
        const ny = dy / (dist||1);
        u.x += nx * speed * dt;
        u.y += ny * speed * dt;
        u.x = clamp(u.x, 18, W-18);
        u.y = clamp(u.y, 18, H-18);
      }

      if (u.cd <= 0 && inRange){
        const ang = Math.atan2(dy, dx);
        u.aimA = ang;

        if (isRangedUnit(u)){
          let extra = {};
          if (u.name === "Trapper" && !u.trapUsed){
            u.trapUsed = true;
            extra.root = true;
            extra.rootDur = 0.7;
            pushTag(u, "Trap");
          }
          if (u.name === "Invoker" || (u.pierceEvery && u.pierceEvery > 0)){
            const pEvery = u.pierceEvery || 3;
            u.pierceCounter = (u.pierceCounter||0) + 1;
            if (u.pierceCounter >= pEvery){
              u.pierceCounter = 0;
              extra.pierce = true;
              pushTag(u, "Pierce");
            }
          }
          spawnProjectile(u, t, extra);
        } else {
          let dmg = u.atk;
          if (u.name === "Spearman" && t.role === "Skirmish"){
            dmg *= 1.25;
            pushTag(u, "Counter");
          }
          applyDamage(u, t, dmg);
          u.swingT = 0.18;
        }

        u.cd = u.spd;
      }

      // Animation hints for sprite sheets (read by renderer)
      u._moving = (!inRange && !rooted);
      const shotAgo = (S.animT || 0) - (u._shotAt || -999);
      u._attacking = (u.swingT > 0) || (shotAgo >= 0 && shotAgo < 0.18);
    }
  }

  stepSide(P, E);
  stepSide(E, P);
}

/* ===== Drawing ===== */
function drawPoly(points){
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i=1;i<points.length;i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
function drawShape(x,y,r,shape){
  const pts = [];
  if (shape === "square"){
    const s = r * 0.95;
    pts.push({x:x-s, y:y-s},{x:x+s, y:y-s},{x:x+s, y:y+s},{x:x-s, y:y+s});
    drawPoly(pts); return;
  }
  if (shape === "triangle"){
    const s = r * 1.05;
    pts.push({x:x, y:y-s},{x:x+s, y:y+s},{x:x-s, y:y+s});
    drawPoly(pts); return;
  }
  if (shape === "diamond"){
    const s = r * 1.05;
    pts.push({x:x, y:y-s},{x:x+s, y:y},{x:x, y:y+s},{x:x-s, y:y});
    drawPoly(pts); return;
  }
  if (shape === "hex"){
    const s = r * 1.02;
    for (let i=0;i<6;i++){
      const a = (Math.PI/3)*i - Math.PI/6;
      pts.push({x: x + Math.cos(a)*s, y: y + Math.sin(a)*s});
    }
    drawPoly(pts); return;
  }
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
}
function drawSwing(u, r){
  if (u.swingT <= 0) return;
  const p = Math.min(1, u.swingT / 0.18);
  const len = r * 1.7;
  const a = u.aimA;
  ctx.save();
  ctx.globalAlpha = 0.10 + 0.35 * p;
  ctx.strokeStyle = u.classFx || "#ffd36a";
  ctx.lineWidth = 2 + 2*p;

  const x1 = u.x + Math.cos(a - 0.55) * (r*0.7);
  const y1 = u.y + Math.sin(a - 0.55) * (r*0.7);
  const x2 = u.x + Math.cos(a + 0.35) * len;
  const y2 = u.y + Math.sin(a + 0.35) * len;

  ctx.beginPath();
  ctx.moveTo(x1,y1);
  ctx.lineTo(x2,y2);
  ctx.stroke();
  ctx.restore();
}
function drawProjectiles(){
  for (const p of S.projectiles){
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = p.color || "#cfe0ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - p.vx*0.02, p.y - p.vy*0.02);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#e8eefc";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}
function drawFloaters(){
  if (!S.floaters.length) return;
  ctx.save();
  const base = Math.max(12, Math.floor(W/70));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const f of S.floaters){
    ctx.globalAlpha = 0.95 * f.alpha;
    let color = getCSS("--tag");
    let size = base;
    if (f.kind === "dmg"){ color = getCSS("--dmg"); size = base + 1; }
    if (f.kind === "heal"){ color = getCSS("--heal"); size = base + 0; }
    if (f.kind === "shield"){ color = getCSS("--shield"); size = base - 1; }
    if (f.kind === "tag"){ color = getCSS("--tag"); size = base - 1; ctx.globalAlpha = 0.75 * f.alpha; }

    ctx.fillStyle = color;
    ctx.font = `${size}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
}
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0,0,W,H);

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#141d35";
  for (let i=0;i<10;i++){
    ctx.fillRect(i*(W/10), 0, (W/10)-2, H);
  }
  ctx.globalAlpha = 1;

  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#233357";
  ctx.lineWidth = Math.max(2, Math.floor(W/320));
  ctx.beginPath();
  ctx.moveTo(W/2, 10);
  ctx.lineTo(W/2, H-10);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // ===== Dynamic battlefield camera =====
  // Scale + center the active combat area so units don't look tiny on tall screens.
  // Uses smoothing and ignores fast-changing elements (floaters/projectiles) to avoid jitter.
  // Capped to keep pixel-art readable.

  if (!S._cam) S._cam = { scale: 1, tx: 0, ty: 0 };

  const lerp = (a,b,t)=>a+(b-a)*t;
  const approach = (a,b,maxD)=>{
    const d = b - a;
    if (Math.abs(d) <= maxD) return b;
    return a + Math.sign(d) * maxD;
  };

  function computeCameraTarget(){
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let any = false;

    const consider = (x,y)=>{
      if (!isFinite(x) || !isFinite(y)) return;
      any = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };

    // Only units affect the camera. (Projectiles/floaters jitter too much.)
    for (const u of S.P) if (u.alive) consider(u.x, u.y);
    for (const u of S.E) if (u.alive) consider(u.x, u.y);

    if (!any){
      return { scale: 1, tx: 0, ty: 0 };
    }

    // Add padding so HP bars/names don't clip.
    const pad = 120;
    minX -= pad; maxX += pad;
    minY -= pad; maxY += pad;

    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);

    // Screen margin (leave a little breathing room).
    const m = Math.max(18, Math.floor(Math.min(W,H) * 0.05));
    const sx = (W - 2*m) / bw;
    const sy = (H - 2*m) / bh;
    let scale = Math.min(sx, sy);

    // Only zoom in (never zoom out), and cap.
    scale = clamp(scale, 1, 2.15);

    const tx = (W - bw*scale)/2 - minX*scale;
    const ty = (H - bh*scale)/2 - minY*scale;
    return { scale, tx, ty };
  }

  // Smooth toward target camera (reduces shake).
  const camT = computeCameraTarget();
  const cam = S._cam;
  // dt isn't available here; use conservative per-frame smoothing.
  cam.scale = lerp(cam.scale, camT.scale, 0.08);
  cam.tx    = lerp(cam.tx,    camT.tx,    0.10);
  cam.ty    = lerp(cam.ty,    camT.ty,    0.10);
  // Clamp max movement per frame for extra stability.
  cam.tx = approach(cam.tx, camT.tx, 45);
  cam.ty = approach(cam.ty, camT.ty, 45);
  cam.scale = approach(cam.scale, camT.scale, 0.06);

  // Draw combat layer with camera transform
  ctx.save();
  ctx.setTransform(cam.scale, 0, 0, cam.scale, cam.tx, cam.ty);

  drawProjectiles();

  function drawUnit(u){
    const r = 14 + (u.star-1)*4;
    // Visual half-size used for UI placement (sprites can be larger than collision radius)
    let visHalf = r;

    // Sprite render (fallback to shapes)
    let drewSprite = false;
    if (spritesReady){
      const k = spriteKeyForUnit(u);
      const entry = SpriteDB[k];
      const img = entry && entry.img;
      if (img && img.complete && img.naturalWidth){
        if (entry.type === 'static'){
          // Static PNG (single frame)
          const px = (r * 2.35);
          const scale = (1 + (u.star-1) * 0.10);
          const dw = px * scale;
          const dh = px * scale;
          visHalf = dh/2;

          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha = 1;
          ctx.drawImage(img, u.x - dw/2, u.y - dh/2, dw, dh);
          ctx.restore();
          drewSprite = true;
        } else {
          // Sheet sprite (use a stable per-unit frame so packs with different layouts still look right)
          const meta = entry.meta || _metaFromImg(img, SPRITE_META);
          const fw = meta.frameW || 32;
          const fh = meta.frameH || 32;
          const cols = Math.max(1, meta.cols || Math.floor((img.naturalWidth||fw)/fw));
          const rows = Math.max(1, meta.rows || Math.floor((img.naturalHeight||fh)/fh));

          // Prefer frames that are not fully transparent. Precomputed at load time.
          const frames = (entry.frames && entry.frames.length) ? entry.frames : null;
          const frameCount = frames ? frames.length : (cols * rows);

          // Stable base pick per unit (fallback if we can't animate)
          if (u._sprFrame == null){
            const h = _hash32(`${u.name}|${u.id}|${u.team}`);
            u._sprFrame = (h % Math.max(1, frameCount));
          }

          // Animation (best-effort):
          // - Row 0: idle/walk
          // - Row 1: attack (if present)
          // If those rows don't exist, we fall back to the stable frame.
          let flatIdx;
          const frameRows = entry.frameRows || (frames ? _buildFrameRows(frames, cols) : null);
          const hasRow0 = frameRows && frameRows[0] && frameRows[0].length;
          const hasRow1 = frameRows && frameRows[1] && frameRows[1].length;
          const wantsAttack = !!u._attacking;
          const wantsMove = !!u._moving;

          if (frameRows && (hasRow0 || hasRow1)){
            const useRow = (wantsAttack && hasRow1) ? 1 : 0;
            const list = (frameRows[useRow] && frameRows[useRow].length) ? frameRows[useRow] : (hasRow0 ? frameRows[0] : frameRows[1]);
            if (list && list.length){
              const fps = wantsAttack ? 12 : (wantsMove ? 10 : 0);
              if (fps > 0 && list.length > 1){
                const idx = Math.floor((S.animT || 0) * fps) % list.length;
                flatIdx = list[idx];
              } else {
                flatIdx = list[0];
              }
            }
          }
          if (flatIdx == null){
            flatIdx = frames ? frames[u._sprFrame] : u._sprFrame;
          }

          const frame = (flatIdx % cols);
          const row = Math.floor(flatIdx / cols) % rows;

          const sx = frame * fw;
          const sy = row * fh;

          const px = (r * 2.15);
          const scale = (1 + (u.star-1) * 0.08);
          const dw = px * scale;
          const dh = px * scale;
          visHalf = dh/2;

          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha = 1;
          ctx.drawImage(img, sx, sy, fw, fh, u.x - dw/2, u.y - dh/2, dw, dh);
          ctx.restore();
          drewSprite = true;
        }
      }
    }

    if (!drewSprite){
      ctx.fillStyle = u.classFill || "#6aa6ff";
      ctx.strokeStyle = (u.side==="player") ? "#cfe0ff" : "#ffd0d9";
      ctx.lineWidth = 2;
      drawShape(u.x, u.y, r, u.shape);
    }

    // Remember last pos for movement detection
    u._px = u.x; u._py = u.y;

    if (u.shield && u.shield > 0){
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "#8cc0ff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(u.x, u.y, visHalf+5, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    drawSwing(u, r);

    // HP bar + name (keep them close to the sprite, regardless of asset scale)
    const barW = 52 + (u.star-1)*10;
    const barH = 6;
    const barX = u.x - barW/2;
    const spriteTop = u.y - (visHalf || 16);
    const barY = spriteTop - 10;

    ctx.fillStyle = "#1d2638";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = (u.side==="player") ? "#55d38a" : "#ff5c7a";
    ctx.fillRect(barX, barY, barW * (u.hp/u.maxHP), barH);

    ctx.fillStyle = "#e8eefc";
    ctx.font = `${Math.max(11, Math.floor(W/60))}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(u.name, u.x, barY - 4);

    ctx.fillStyle = "#cfe0ff";
    ctx.font = `${Math.max(10, Math.floor(W/70))}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textBaseline = "top";
    ctx.fillText("★".repeat(u.star), u.x, u.y + visHalf + 2);

    // (HP bar drawn above, before name)
  }

  for (const u of S.P) if (u.alive) drawUnit(u);
  for (const u of S.E) if (u.alive) drawUnit(u);

  drawFloaters();

  ctx.restore();
}

/* ===== Main loop ===== */
let lastT = 0;
let rafId = null;
function loop(t){
  if (!lastT) lastT = t;
  const dt = Math.min(0.05, (t-lastT)/1000);
  lastT = t;

  S.animT += dt;

  if (S.combatRunning) stepCombat(dt);
  if (S.screen === "battle") draw();

  rafId = requestAnimationFrame(loop);
}

/* ===== Permadeath ===== */
function applyPermadeath(){
  // Permadeath disabled: keep roster intact and simply heal units between battles.
  return;
}

/* ===== Battle flow ===== */
function startCombat(){
  if (S.army.length === 0){ showToast("Not enough units", "bad"); return; }
  if (S.overlay !== "none") return;

  setScreen("battle");
  setPhase("combat");
  S.combatRunning = true;

  showToast("Battle started", "info");
  resizeCanvas();

  spawnEnemyWave();
  deployArmies();

  document.body.dataset.result = "hide";
  updateButtons();
}

function showResult(win, summary, type){
  S.combatRunning = false;
  setPhase("result");

  document.body.dataset.result = "show";
  el.resultTitle.textContent = win ? "Victory" : "Defeat";
  el.resultTitle.style.color = win ? "var(--good)" : "var(--bad)";
  el.resultText.textContent = summary;
  showToast(summary, type);

  updateButtons();
  renderStats();
}

function endCombat(win){
  applyPermadeath();
  renderAll();

  if (win){
    S.streak += 1;
    const base = 4 + Math.floor(S.round/2);
    const streakBonus = Math.min(4, Math.floor(S.streak/2));
    const goldGain = base + streakBonus;
    S.gold += goldGain;
    showResult(true, `Victory! +${goldGain}g`, "good");
  } else {
    S.streak = 0;
    const dmg = 2 + Math.floor(S.round/2);
    S.hp = Math.max(0, S.hp - dmg);
    S.gold += 3;

    if (S.hp <= 0){
      document.body.dataset.result = "show";
      el.resultTitle.textContent = "Game Over";
      el.resultTitle.style.color = "var(--bad)";
      el.resultText.textContent = "You ran out of HP. Start a new run from the menu.";
      showToast("Game Over", "bad");

      el.btnNext.disabled = true;
      el.btnResultNext.disabled = true;

      try{
        const data = serializeState();
        data.ended = true;
        localStorage.setItem(SAVE_KEY_V4, JSON.stringify(data));
      }catch(e){}
      refreshContinueBtn();
      return;
    } else {
      showResult(false, `Defeat. -${dmg} HP, +3g`, "bad");
    }
  }

  saveGame();
}

/* ===== Post-battle roguelike pipeline ===== */
function randomItemDrop(){
  const r = S.round;
  let odds;
  if (r <= 3) odds = {Common:0.70, Uncommon:0.25, Rare:0.05, Epic:0.00, Legendary:0.00};
  else if (r <= 7) odds = {Common:0.45, Uncommon:0.35, Rare:0.16, Epic:0.04, Legendary:0.00};
  else odds = {Common:0.30, Uncommon:0.35, Rare:0.22, Epic:0.10, Legendary:0.03};

  if (S.node.isElite){
    odds.Epic += 0.03; odds.Legendary += 0.01;
    odds.Common = Math.max(0, odds.Common - 0.03);
    odds.Uncommon = Math.max(0, odds.Uncommon - 0.01);
  }
  const sum = Object.values(odds).reduce((a,b)=>a+b,0) || 1;
  for (const k of Object.keys(odds)) odds[k]/=sum;

  const rar = rollRarity(odds);
  const pool = Object.keys(ITEMS).filter(id => (ITEMS[id].rarity||"Common") === rar);
  const id = pool.length ? pick(pool) : pick(Object.keys(ITEMS));
  return { id:rndId(), type:id, tier:1 };
}

function beginPostBattleFlow(){
  if (S.hp <= 0) return;

  S.overlayQueue = [];

  const lastWasWin = (el.resultTitle.textContent === "Victory");
  if (lastWasWin){
    if (S.node.isElite){
      const it = randomItemDrop();
      S.items.push(it);
      S.overlayQueue.push({ name:"item", payload: it });
      S.overlayQueue.push({ name:"augment" });
    } else {
      if (chance(0.40)){
        const it = randomItemDrop();
        S.items.push(it);
        S.overlayQueue.push({ name:"item", payload: it });
      }
      if (S.round % 3 === 0) S.overlayQueue.push({ name:"augment" });
    }
  } else {
    if (S.round % 3 === 0) S.overlayQueue.push({ name:"augment" });
  }

  S.overlayQueue.push({ name:"node" });

  saveGame();
  nextOverlay();
}

function startNextRoundPlanning(){
  S.round += 1;
  let income = 2 + augStacks("A1");
  S.gold += income;

  showToast(`Round ${S.round} — +${income}g`, "info");

  setScreen("planning");
  setPhase("planning");
  rerollShop(true);
  renderAll();
  saveGame();
}

/* ===== Overlays ===== */
function openAugmentPick(){
  setOverlay("augment");
  el.augmentChoices.innerHTML = "";

  const allIds = Object.keys(AUGMENTS);
  // eligible: stackables always, uniques only if not taken
  const eligible = allIds.filter(id => canTakeAug(id));

  const picks = [];
  const pool = eligible.slice();

  while (picks.length < 3 && pool.length){
    const id = pool.splice(Math.floor(Math.random()*pool.length), 1)[0];
    if (!picks.includes(id)) picks.push(id);
  }

  if (picks.length === 0){
    const card = document.createElement("div");
    card.className = "choiceCard";
    card.innerHTML = `<div class="name"><span>No augments available</span><span class="rarMini">—</span></div>
                      <div class="desc">Nothing left to pick right now. Continue.</div>`;
    const btn = document.createElement("button");
    btn.className = "btnPrimary";
    btn.textContent = "Continue";
    btn.addEventListener("click", ()=> nextOverlay());
    card.appendChild(btn);
    el.augmentChoices.appendChild(card);
    return;
  }

  for (const id of picks){
    const a = AUGMENTS[id];
    const cur = augStacks(id);
    const isUnique = !a.stackable;

    const tag = isUnique ? "Unique" : `x${cur || 0}`;
    const card = document.createElement("div");
    card.className = "choiceCard";
    card.innerHTML = `<div class="name"><span>${a.name}</span><span class="rarMini">${tag}</span></div><div class="desc">${a.desc}</div>`;

    const btn = document.createElement("button");
    btn.className = "btnPrimary";
    btn.textContent = "Pick";
    btn.addEventListener("click", ()=>{
      const added = addAugment(id, 1);
      if (added <= 0){
        showToast("Cannot take this", "bad");
        openAugmentPick();
        return;
      }
      const now = augStacks(id);
      showToast(`Augment: ${a.name}${a.stackable ? ` (x${now})` : ""}`, "good");
      renderAll();
      saveGame();
      nextOverlay();
    });

    card.appendChild(btn);
    el.augmentChoices.appendChild(card);
  }
}

function openItemReward(itemObj){
  setOverlay("item");
  const def = ITEMS[itemObj.type];
  const rarCol = rarityColor(def.rarity || "Common");
  el.itemRewardCard.innerHTML = `
    <div class="name"><span>${def.name}</span><span class="rarMini" style="border-color:${rarCol}; color:${rarCol};">${def.rarity||"Common"}</span></div>
    <div class="desc">${def.desc}</div>
    <div class="desc" style="margin-top:6px;">Inventory → equip (higher rarity units hold more). Unequip returns items.</div>
  `;
}
el.btnItemContinue.addEventListener("click", ()=>{ nextOverlay(); });

function openNodeSelect(){
  setOverlay("node");
  el.nodeChoices.innerHTML = "";

  const pool = [
    { type:"battle", isElite:false, title:"Battle", desc:"Normal fight." },
    { type:"battle", isElite:true,  title:"Elite",  desc:"Harder enemies. Guaranteed item + augment on win." },
    { type:"event",  isElite:false, title:"Event",  desc:"Pick one risk/reward outcome." },
  ];

  const nodes = [];
  const temp = pool.slice();
  while(nodes.length < 2 && temp.length){
    const idx = Math.floor(Math.random() * temp.length);
    nodes.push(temp.splice(idx,1)[0]);
  }

  for (const n of nodes){
    const card = document.createElement("div");
    card.className = "choiceCard";
    card.innerHTML = `<div class="name"><span>${n.title}</span><span class="rarMini">${n.isElite?"Elite":"Node"}</span></div><div class="desc">${n.desc}</div>`;
    const btn = document.createElement("button");
    btn.className = "btnPrimary";
    btn.textContent = "Choose";
    btn.addEventListener("click", ()=>{
      if (n.type === "event"){
        S.node = { type:"event", isElite:false };
        saveGame();
        openEventSelect();
      } else {
        S.node = { type:"battle", isElite: !!n.isElite };
        saveGame();
        setOverlay("none");
        startNextRoundPlanning();
      }
    });
    card.appendChild(btn);
    el.nodeChoices.appendChild(card);
  }
}

function openEventSelect(){
  setOverlay("event");
  el.eventChoices.innerHTML = "";

  const pool = EVENTS.slice();
  const picks = [];
  while (picks.length < 3 && pool.length){
    picks.push(pool.splice(Math.floor(Math.random()*pool.length), 1)[0]);
  }

  for (const ev of picks){
    const card = document.createElement("div");
    card.className = "choiceCard";
    card.innerHTML = `<div class="name"><span>${ev.name}</span><span class="rarMini">Event</span></div><div class="desc">${ev.desc}</div>`;
    const btn = document.createElement("button");
    btn.className = "btnPrimary";
    btn.textContent = "Take";
    btn.addEventListener("click", ()=>{
      ev.apply(S);
      mergeAllSafe();
      renderAll();
      saveGame();

      S.node = { type:"battle", isElite:false };
      setOverlay("none");
      startNextRoundPlanning();
    });
    card.appendChild(btn);
    el.eventChoices.appendChild(card);
  }
}

/* ===== Inventory overlay ===== */
let selectedInvItemId = null;
let selectedInvItemType = null;

function clearInvSelection(showMsg=false){
  selectedInvItemId = null;
  selectedInvItemType = null;
  if (showMsg) showToast("Selection cleared", "info");
  el.invHint.textContent = "Tap an item, then equip it to a unit. Unequip returns to inventory.";
}

function openInventory(){
  setOverlay("inventory");
  clearInvSelection(false);
  renderInventory();
}

function getSelectedInvItem(){
  if (!S.items || !S.items.length) return null;
  let idx = -1;
  if (selectedInvItemId) idx = S.items.findIndex(x => x.id === selectedInvItemId);
  if (idx < 0 && selectedInvItemType) idx = S.items.findIndex(x => x.type === selectedInvItemType);
  if (idx < 0) return null;
  return { idx, item: S.items[idx] };
}

function updateSelectedBar(){
  const sel = getSelectedInvItem();
  if (!sel){
    el.invSelectedBar.style.display = "none";
    return;
  }
  const def = ITEMS[sel.item.type];
  const rar = def?.rarity || "Common";
  el.invSelectedText.textContent = `${def?.name || "Item"} (${rar})`;
  el.invSelectedBar.style.display = "flex";
}

function renderEquippedSection(u){
  const arr = Array.isArray(u.items) ? u.items.filter(x=>x && x.type) : [];
  const max = u.itemSlotsMax || 1;

  let chips = "";
  if (!arr.length){
    chips = `<span class="smallTag muted">No items equipped</span>`;
  } else {
    for (const it of arr){
      const def = ITEMS[it.type];
      const rarCol = rarityColor(def?.rarity || "Common");
      const itTier = it.tier || 1;
      const tierBadge = itTier > 1 ? ` <span class="tierBadge">${itemTierLabel(itTier)}</span>` : "";
      chips += `<span class="equipChip" style="border-color:${rarCol};">
        <span class="txt">${def?.name || "Item"}${tierBadge}</span>
      </span>`;
    }
  }

  const fx = arr.map(it => itemDesc(it.type, it.tier||1)).filter(Boolean).join("; ");
  const fxLine = fx ? `<div class="equipFxLine">${fx}</div>` : ``;

  return `
    <div class="equipWrap">
      <div class="equipRow">${chips}</div>
      ${fxLine}
      <div class="desc">Slots ${arr.length}/${max}</div>
    </div>
  `;
}

function equipSelectedToUnit(u){
  const sel = getSelectedInvItem();
  if (!sel){
    showToast("Select an item first", "bad");
    return false;
  }

  const curItems = Array.isArray(u.items) ? u.items.filter(x=>x && x.type) : [];
  const have = curItems.length;
  const max = u.itemSlotsMax || 1;

  if (have >= max){
    // open replace flow
    const pickedItem = sel.item;
    S.pendingEquip = {
      unitId: u.id,
      pickedItemType: pickedItem.type,
      pickedItemId: pickedItem.id,
      prevOverlay: "inventory"
    };
    showToast("Choose a slot to replace", "info");
    openReplaceOverlay();
    return true;
  }

  // equip directly
  const pickedItem = S.items.splice(sel.idx, 1)[0];
  (u.items ||= []).push({ id:rndId(), type:pickedItem.type, tier:pickedItem.tier||1 });

  showToast(`Equipped ${itemLabel(pickedItem.type)} → ${u.name}`, "good");
  clearInvSelection(false);
  el.invHint.textContent = "Equipped. Select another item to equip more.";
  renderAll();
  saveGame();
  renderInventory();
  return true;
}

function renderInventory(){
  el.invItems.innerHTML = "";
  el.invUnits.innerHTML = "";
  el.invCount.textContent = `${S.items.length} item${S.items.length===1?"":"s"}`;
  el.invUnitsCount.textContent = `${S.army.length} unit${S.army.length===1?"":"s"}`;

  updateSelectedBar();

  // Items
  for (const it of S.items){
    const def = ITEMS[it.type];
    const rarCol = rarityColor(def.rarity || "Common");
    const sel = (selectedInvItemId === it.id);

    const card = document.createElement("div");
    card.className = "choiceCard invItem";
    card.style.borderColor = sel ? "rgba(106,166,255,0.95)" : "rgba(42,58,99,0.95)";
    if (sel) card.style.boxShadow = "0 0 0 2px rgba(106,166,255,0.18) inset";

    const itTier = it.tier || 1;
    const tierStr = itTier > 1 ? ` <span class="tierBadge">${itemTierLabel(itTier)}</span>` : "";
    const desc = itemDesc(it.type, itTier);
    const isMaxTier = itTier >= (def.maxTier||3);
    card.innerHTML = `
      <div class="name">
        <span>${def.name}${tierStr}</span>
        <span class="rarMini" style="border-color:${rarCol}; color:${rarCol};">${def.rarity||"Common"}</span>
      </div>
      <div class="desc">${desc}</div>
    `;

    const btnRow = document.createElement("div");
    btnRow.style.display = "flex"; btnRow.style.gap = "6px"; btnRow.style.flexWrap = "wrap";

    const btn = document.createElement("button");
    btn.className = sel ? "btnPrimary" : "";
    btn.textContent = sel ? "Selected" : "Select";
    btn.addEventListener("click", ()=>{
      selectedInvItemId = it.id;
      selectedInvItemType = it.type;
      el.invHint.textContent = `Selected: ${def.name} ${itemTierLabel(itTier)} — tap a unit to equip.`;
      showToast(`Selected ${def.name} ${itemTierLabel(itTier)}`, "info");
      renderInventory();
    });
    btnRow.appendChild(btn);

    // Merge button: show if 2+ of same type+tier exist and not max tier
    if (!isMaxTier){
      const sameCount = S.items.filter(x => x && x.type===it.type && (x.tier||1)===itTier).length;
      if (sameCount >= 2){
        const mergeBtn = document.createElement("button");
        mergeBtn.className = "btnPrimary";
        mergeBtn.style.background = "linear-gradient(135deg,#a855f7,#7c3aed)";
        mergeBtn.textContent = `Merge → ${itemTierLabel(itTier+1)}`;
        mergeBtn.addEventListener("click", ()=>{
          mergeItems(it.type, itTier);
        });
        btnRow.appendChild(mergeBtn);
      }
    }

    card.appendChild(btnRow);
    el.invItems.appendChild(card);
  }
  if (!S.items.length){
    const empty = document.createElement("div");
    empty.className = "choiceCard invItem";
    empty.innerHTML = `<div class="name">No items</div><div class="desc">Win fights to find items.</div>`;
    el.invItems.appendChild(empty);
  }

  // Units
  for (const u of S.army){
    const rarCol = rarityColor(u.rarity || "Common");
    const curItems = Array.isArray(u.items) ? u.items.filter(x=>x && x.type) : [];
    const have = curItems.length;
    const max = u.itemSlotsMax || 1;

    const card = document.createElement("div");
    card.className = "choiceCard invUnit";

    card.innerHTML = `
      <div class="name">
        <span>${u.name} ${"★".repeat(u.star)}</span>
        <span class="rarMini" style="border-color:${rarCol}; color:${rarCol};">${u.rarity}</span>
      </div>
      <div class="desc">${u.classTag}/${u.originTag}</div>
      ${renderEquippedSection(u)}
    `;

    // Tap unit card (not the buttons) to equip/replace when an item is selected
    card.addEventListener("click", (e)=>{
      if (e.target.closest("button")) return;
      if (!(selectedInvItemId || selectedInvItemType)) return;
      equipSelectedToUnit(u);
    });

    const actions = document.createElement("div");
    actions.className = have ? "unitActions" : "unitActions one";

    const hasSel = !!(selectedInvItemId || selectedInvItemType);

    if (have >= max){
      if (hasSel){
        const replaceBtn = document.createElement("button");
        replaceBtn.className = "btnPrimary";
        replaceBtn.textContent = "Replace Item";
        replaceBtn.addEventListener("click", ()=>{
          const sel = getSelectedInvItem();
          if (!sel){
            showToast("Item not found (reselect)", "bad");
            clearInvSelection(false);
            renderInventory();
            return;
          }
          const pickedItem = sel.item;
          S.pendingEquip = {
            unitId: u.id,
            pickedItemType: pickedItem.type,
            pickedItemId: pickedItem.id,
            prevOverlay: "inventory"
          };
          showToast("Choose a slot to replace", "info");
          openReplaceOverlay();
        });
        actions.appendChild(replaceBtn);
      } else {
        const full = document.createElement("div");
        full.className = "pillLike";
        full.textContent = "Slots full";
        actions.appendChild(full);
      }
    } else {
      const equipBtn = document.createElement("button");
      equipBtn.className = hasSel ? "btnPrimary" : "";
      equipBtn.textContent = hasSel ? "Equip Selected" : "Select an item";
      equipBtn.disabled = !hasSel;

      equipBtn.addEventListener("click", ()=>{
        if (!hasSel){
          showToast("Select an item first", "bad");
          return;
        }
        const ok = equipSelectedToUnit(u);
        if (!ok) showToast("Equip failed (reselect)", "bad");
      });

      actions.appendChild(equipBtn);
    }

    // Unequip
    if (have){
      const unequipBtn = document.createElement("button");
      unequipBtn.className = "btnGhost";
      unequipBtn.textContent = (have > 1) ? "Unequip All" : "Unequip";
      unequipBtn.addEventListener("click", ()=>{
        let returned = 0;
        const arr = Array.isArray(u.items) ? u.items : [];
        for (let i=arr.length-1;i>=0;i--){
          const it = arr[i];
          if (it && it.type){
            S.items.push({ id:rndId(), type: it.type, tier: it.tier||1 });
            returned++;
          }
          arr.splice(i,1);
        }
        showToast(`Unequipped ${returned} item${returned!==1?"s":""} from ${u.name}`, "info");
        el.invHint.textContent = "Unequipped. Select an item to equip again.";
        renderAll();
        saveGame();
        renderInventory();
      });

      if (actions.classList.contains("one")){
        actions.classList.remove("one");
        actions.classList.add("unitActions");
        actions.style.gridTemplateColumns = "1fr 1fr";
      }
      actions.appendChild(unequipBtn);
    }

    card.appendChild(actions);
    el.invUnits.appendChild(card);
  }

  if (!S.army.length){
    const empty = document.createElement("div");
    empty.className = "choiceCard invUnit";
    empty.innerHTML = `<div class="name">No units</div><div class="desc">Buy units in the shop.</div>`;
    el.invUnits.appendChild(empty);
  }
}

/* ===== Replace overlay ===== */
function openReplaceOverlay(){
  if (!S.pendingEquip) return;
  setOverlay("replace");
  renderReplaceOverlay();
}
function renderReplaceOverlay(){
  el.replaceChoices.innerHTML = "";
  const pe = S.pendingEquip;
  const unit = S.army.find(u=>u.id===pe.unitId);
  if (!unit){
    S.pendingEquip = null;
    setOverlay("inventory");
    renderInventory();
    return;
  }

  const pickedDef = ITEMS[pe.pickedItemType];
  el.replaceSub.textContent = `Replace an item on ${unit.name} with ${pickedDef?.name || "Item"}.`;

  const items = Array.isArray(unit.items) ? unit.items : [];
  for (let i=0;i<items.length;i++){
    const it = items[i];
    const def = ITEMS[it.type];
    const rarCol = rarityColor(def?.rarity || "Common");

    const card = document.createElement("div");
    card.className = "choiceCard";
    card.innerHTML = `
      <div class="name"><span>Replace: ${def?.name || "Item"}</span><span class="rarMini" style="border-color:${rarCol}; color:${rarCol};">${def?.rarity || "Common"}</span></div>
      <div class="desc">${def?.desc || ""}</div>
    `;
    const btn = document.createElement("button");
    btn.className = "btnPrimary";
    btn.textContent = "Replace this slot";
    btn.addEventListener("click", ()=>{ commitReplace(i); });
    card.appendChild(btn);
    el.replaceChoices.appendChild(card);
  }
}
function commitReplace(slotIndex){
  const pe = S.pendingEquip;
  const unit = S.army.find(u=>u.id===pe.unitId);
  if (!pe || !unit){
    S.pendingEquip=null;
    setOverlay("inventory");
    renderInventory();
    return;
  }

  let invIdx = S.items.findIndex(x => x.id === pe.pickedItemId);
  if (invIdx < 0) invIdx = S.items.findIndex(x => x.type === pe.pickedItemType);
  if (invIdx < 0){
    showToast("Item not in inventory (reselect)", "bad");
    S.pendingEquip=null;
    setOverlay("inventory");
    renderInventory();
    return;
  }

  const cur = Array.isArray(unit.items) ? unit.items : (unit.items=[]);
  const replaced = cur[slotIndex];
  if (replaced && replaced.type){
    S.items.push({ id:rndId(), type: replaced.type, tier: replaced.tier||1 });
  }

  const picked = S.items.splice(invIdx,1)[0];
  cur[slotIndex] = { id:rndId(), type: picked.type, tier: picked.tier||1 };

  showToast(`Equipped ${itemLabel(picked.type)} → ${unit.name}`, "good");

  clearInvSelection(false);
  S.pendingEquip = null;

  renderAll();
  saveGame();

  setOverlay("inventory");
  renderInventory();
}
el.btnReplaceCancel.addEventListener("click", ()=>{
  S.pendingEquip = null;
  setOverlay("inventory");
  renderInventory();
});

/* ===== Result "Next" handling ===== */
function proceedFromResult(){
  if (S.overlay !== "none") return;
  document.body.dataset.result = "hide";
  setOverlay("none");
  beginPostBattleFlow();
}

/* ===== Events wiring ===== */
el.btnReroll.addEventListener("click", () => rerollShop(false));
el.btnStart.addEventListener("click", startCombat);
el.btnNext.addEventListener("click", proceedFromResult);
el.btnResultNext.addEventListener("click", proceedFromResult);

el.btnMenu.addEventListener("click", () => {
  setOverlay("none");
  setScreen("menu");
  showToast("Menu", "info");
  refreshContinueBtn();
});
el.btnInventory.addEventListener("click", () => openInventory());
el.btnSynergies.addEventListener("click", () => openSynergiesOverlay());
el.btnBonuses.addEventListener("click", () => openBonusesOverlay());
el.btnSynClose.addEventListener("click", () => { setOverlay("none"); });
el.btnBonusesClose.addEventListener("click", () => { setOverlay("none"); });

function showInvInfo(){
  clearTimeout(toastTimer);
  toastEl.classList.remove("good","bad","show");
  toastEl.textContent = "Select an item → tap a unit to equip. 2× same item+tier = Merge. Unequip returns items.";
  void toastEl.offsetWidth;
  toastEl.classList.add("show");
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 4000);
}
(function(){
  const btn = document.getElementById("btnInvInfo");
  btn.addEventListener("click", showInvInfo);
  btn.addEventListener("touchend", (e)=>{ e.preventDefault(); showInvInfo(); });
})();
el.btnInvClose.addEventListener("click", ()=>{
  setOverlay("none");
  renderAll();
});
el.btnInvClearSel.addEventListener("click", ()=>{
  clearInvSelection(true);
  renderInventory();
});

el.btnHowTo.addEventListener("click", () => {
  document.body.dataset.howto = (document.body.dataset.howto === "open") ? "closed" : "open";
});
el.btnNewGame.addEventListener("click", () => newGame());
el.btnContinue.addEventListener("click", () => {
  const ok = loadGame();
  if (!ok) showToast("No save found", "bad");
});

/* ===== Init / New Game ===== */
function newGame(){
  initSprites();

  clearSave();

  S.round = 1;
  S.gold = 10;
  S.hp = 20;
  S.streak = 0;
  S.shop = [];
  S.army = [];
  S.items = [];
  S.augments = {};
  S.node = { type:"battle", isElite:false };
  S.nextEnemyMod = null;
  S.overlay = "none";
  S.overlayQueue = [];
  S.pendingEquip = null;

  S.projectiles = [];
  S.floaters = [];
  S.P = []; S.E = [];
  S.combatRunning = false;

  S.army.push(makeUnit("Brawler", 1, "player"));
  S.army.push(makeUnit("Archer", 1, "player"));

  setScreen("planning");
  setPhase("planning");
  rerollShop(true);
  renderAll();
  showToast("New Game", "good");
  saveGame();
}

function init(){
  resizeCanvas();
  refreshContinueBtn();

  if (!localStorage.getItem(SAVE_KEY_V4) && !localStorage.getItem(SAVE_KEY_V3)){
    if (!tryMigrateV2()) tryMigrateV1();
  }

  setScreen("menu");
  setPhase("planning");
  showToast("Welcome", "info");
  if (!rafId) rafId = requestAnimationFrame(loop);
}
init();
