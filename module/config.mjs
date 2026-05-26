export const CROWS = {
  id: "crows",
  characteristics: { agility: "A", mind: "M", strength: "S" },
  tiers: { t1Max: 11, t2Max: 16 },            // ≤11 t1, 12-16 t2, 17+ t3
  doomFaces: [2, 3],                           // natural 2d10 sum
  critFaces: [19, 20],
  containers: {
    hand: 2, belt: 2, head: 1, neck: 1, waist: 1, arms: 1, finger: 1, feet: 1, backpack: 10
  },
  backpackSize: 10
};

Object.assign(CROWS, {
  skills: [
    "alchemy","blacksmithing","climb","enchanting","endurance","gymnastics",
    "handleAnimal","hide","historicalLore","jump","lift","magicLore",
    "monsterLore","natureLore","navigate","pickLock","religiousLore","sabotage",
    "search","sleightOfHand","sneak","swim",
    "alteration","benefaction","conjuration","elemental","illusion","necromancy",
    "bashing","bow","chopping","slashing","stabbing","unarmed"
  ],
  weaponTypes: ["bashing","bow","chopping","slashing","stabbing","unarmed"],
  weaponQualities: ["brutal","cumbersome","disengage","dismember","light","parry","pummeling","reload"],
  armorTypes: ["shield","light","medium","heavy"],
  armorBaseAD: { shield: 5, light: 5, medium: 10, heavy: 15 },
  armorSlots: { shield: 1, light: 2, medium: 3, heavy: 4 },
  disciplines: ["alteration","benefaction","conjuration","elemental","illusion","necromancy"],
  traitTrees: [
    "alchemy","alteration","archery","armor","bashing","benefaction","blacksmithing",
    "camping","chopping","conjuration","elemental","enchantment","illusion","knowledge",
    "leverage","necromancy","pets","reputation","slashing","stabbing","thievery",
    "travel","unarmed"
  ],
  traitTierXP: { 1: 500, 2: 1000, 3: 1500, 4: 2000 },
  creatureTypes: ["animal","blood","undead","demon","angel","plant","unique"],
  sizes: ["tiny","small","medium","large","huge","holyShit"],
  castTypes: ["action","maneuver","reaction","attack","outOfCombat"],
  usageExpiry: ["useless","refuel","rest","activate","dt"],
  equipSlotTypes: ["head","neck","waist","arms","finger","feet"],
  qualityTiers: ["standard","fine","masterwork"],
  gearSubtypes: ["tool","utility","light","wand","ring","wornMagic","treasure"],
  conditions: ["blessed","boned","grabbed","prone","unconscious","hidden","invisible"]
});
