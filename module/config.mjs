export const CROWS = {
  id: "crows",
  characteristics: { agility: "A", mind: "M", strength: "S" },
  tiers: { t1Max: 11, t2Max: 16 },            // ≤11 t1, 12-16 t2, 17+ t3
  doomFaces: [2, 3],                           // natural 2d10 sum
  critFaces: [19, 20],
  containers: {
    hand: 2, belt: 2, waist: 1, neck: 1, gloves: 1, boots: 1,
    ring: 1, head: 1, backpack: 10
  },
  backpackSize: 10
};
