/**
 * Frozen canonical village geometry.
 *
 * Authored from the user-approved Balhaunis vector composition. Runtime code
 * selects ordered prefixes from these arrays; it never plans or randomizes a
 * village. Source IDs preserve a design-time audit trail back to the flattened
 * export without becoming runtime identity.
 */
export const CANONICAL_VILLAGE_SIZE = 6000;
export const CANONICAL_VILLAGE_BACKGROUND =
  "systems/crows/assets/village/canonical/background.svg";
export const CANONICAL_UNBUILT_PLOT =
  "systems/crows/assets/village/canonical/unbuilt-plot.svg";

const freezeEntries = entries => Object.freeze(entries.map(entry => Object.freeze(entry)));
const freezeRecord = record => Object.freeze(Object.fromEntries(
  Object.entries(record).map(([key, value]) => [key, Object.freeze(value)])
));

/**
 * Which drawing stands on each institution plot.
 *
 * Named here rather than left to the art-set resolver. A slot carrying no art
 * falls through to whatever catalogue happens to be configured, and that
 * default is the legacy 2 Minute Tabletop PNG set — so every institution on the
 * canonical map rendered as watercolour raster over source vector, three of
 * them through the old substitutions: a crypt drawn as a cave mouth, a stables
 * as a straw hut, a general store as market tents.
 *
 * These point at the authored institution set because a village map has to be
 * *read*: a player looking for the smithy needs it to look like a smithy. The
 * twelve source buildings standing on these same plots are shipped and
 * available — each slot's `sourceId` names one, alchemist `B12` being
 * `canonical/housing/building-12.svg` — and they match the surrounding art
 * exactly, but they are undifferentiated houses. Preferring them is a change of
 * these values and nothing else.
 */
export const CANONICAL_INSTITUTION_ART = Object.freeze({
  alchemist: "systems/crows/assets/institutions/alchemist.svg",
  auctionHouse: "systems/crows/assets/institutions/auction-house.svg",
  barracks: "systems/crows/assets/institutions/barracks.svg",
  beacon: "systems/crows/assets/institutions/beacon.svg",
  blacksmith: "systems/crows/assets/institutions/blacksmith.svg",
  bookseller: "systems/crows/assets/institutions/bookseller.svg",
  crypt: "systems/crows/assets/institutions/crypt.svg",
  enchanter: "systems/crows/assets/institutions/enchanter.svg",
  generalStore: "systems/crows/assets/institutions/general-store.svg",
  inn: "systems/crows/assets/institutions/inn.svg",
  stables: "systems/crows/assets/institutions/stables.svg",
  temple: "systems/crows/assets/institutions/temple.svg"
});

export const CANONICAL_INSTITUTION_SLOTS = freezeRecord({
  "alchemist": {
    "id": "alchemist",
    "sourceId": "B12",
    "x": 3145,
    "y": 1823,
    "width": 256,
    "height": 256,
    "rotation": -10
  },
  "auctionHouse": {
    "id": "auctionHouse",
    "sourceId": "B29",
    "x": 4406,
    "y": 2636,
    "width": 346,
    "height": 346,
    "rotation": -80
  },
  "barracks": {
    "id": "barracks",
    "sourceId": "B49",
    "x": 2332,
    "y": 2265,
    "width": 260,
    "height": 260,
    "rotation": 70
  },
  "beacon": {
    "id": "beacon",
    "sourceId": "B03",
    "x": 5012,
    "y": 3162,
    "width": 356,
    "height": 356,
    "rotation": -70
  },
  "blacksmith": {
    "id": "blacksmith",
    "sourceId": "B69",
    "x": 1564,
    "y": 4548,
    "width": 229,
    "height": 229,
    "rotation": -15
  },
  "bookseller": {
    "id": "bookseller",
    "sourceId": "B65",
    "x": 1762,
    "y": 3651,
    "width": 242,
    "height": 242,
    "rotation": 0
  },
  "crypt": {
    "id": "crypt",
    "sourceId": "B02",
    "x": 2834,
    "y": 1226,
    "width": 338,
    "height": 338,
    "rotation": -10
  },
  "enchanter": {
    "id": "enchanter",
    "sourceId": "B23",
    "x": 3647,
    "y": 3157,
    "width": 224,
    "height": 224,
    "rotation": 90
  },
  "generalStore": {
    "id": "generalStore",
    "sourceId": "B53",
    "x": 1725,
    "y": 2655,
    "width": 246,
    "height": 246,
    "rotation": 15
  },
  "inn": {
    "id": "inn",
    "sourceId": "B37",
    "x": 2385,
    "y": 3887,
    "width": 324,
    "height": 324,
    "rotation": 30
  },
  "stables": {
    "id": "stables",
    "sourceId": "B01",
    "x": 3264,
    "y": 5394,
    "width": 344,
    "height": 344,
    "rotation": -25
  },
  "temple": {
    "id": "temple",
    "sourceId": "B32",
    "x": 3657,
    "y": 2593,
    "width": 456,
    "height": 456,
    "rotation": 90
  }
});
export const CANONICAL_HOUSING_SLOTS = freezeEntries([
  {
    "sourceId": "B21",
    "asset": "systems/crows/assets/village/canonical/housing/building-21.svg",
    "x": 2840,
    "y": 3335,
    "width": 295,
    "height": 221,
    "id": "housing-01"
  },
  {
    "sourceId": "B22",
    "asset": "systems/crows/assets/village/canonical/housing/building-22.svg",
    "x": 2856,
    "y": 3524,
    "width": 222,
    "height": 186,
    "id": "housing-02"
  },
  {
    "sourceId": "B20",
    "asset": "systems/crows/assets/village/canonical/housing/building-20.svg",
    "x": 2834,
    "y": 3191,
    "width": 296,
    "height": 191,
    "id": "housing-03"
  },
  {
    "sourceId": "B05",
    "asset": "systems/crows/assets/village/canonical/housing/building-05.svg",
    "x": 3315,
    "y": 3351,
    "width": 240,
    "height": 190,
    "id": "housing-04"
  },
  {
    "sourceId": "B04",
    "asset": "systems/crows/assets/village/canonical/housing/building-04.svg",
    "x": 3288,
    "y": 3573,
    "width": 257,
    "height": 179,
    "id": "housing-05"
  },
  {
    "sourceId": "B36",
    "asset": "systems/crows/assets/village/canonical/housing/building-36.svg",
    "x": 2598,
    "y": 3655,
    "width": 333,
    "height": 312,
    "id": "housing-06"
  },
  {
    "sourceId": "B06",
    "asset": "systems/crows/assets/village/canonical/housing/building-06.svg",
    "x": 3371,
    "y": 3162,
    "width": 259,
    "height": 202,
    "id": "housing-07"
  },
  {
    "sourceId": "B62",
    "asset": "systems/crows/assets/village/canonical/housing/building-62.svg",
    "x": 2579,
    "y": 3135,
    "width": 238,
    "height": 262,
    "id": "housing-08"
  },
  {
    "sourceId": "B19",
    "asset": "systems/crows/assets/village/canonical/housing/building-19.svg",
    "x": 2774,
    "y": 2859,
    "width": 279,
    "height": 192,
    "id": "housing-09"
  },
  {
    "sourceId": "B61",
    "asset": "systems/crows/assets/village/canonical/housing/building-61.svg",
    "x": 2407,
    "y": 3187,
    "width": 232,
    "height": 297,
    "id": "housing-10"
  },
  {
    "sourceId": "B07",
    "asset": "systems/crows/assets/village/canonical/housing/building-07.svg",
    "x": 3256,
    "y": 2807,
    "width": 265,
    "height": 204,
    "id": "housing-11"
  },
  {
    "sourceId": "B35",
    "asset": "systems/crows/assets/village/canonical/housing/building-35.svg",
    "x": 3492,
    "y": 3842,
    "width": 255,
    "height": 226,
    "id": "housing-12"
  },
  {
    "sourceId": "B18",
    "asset": "systems/crows/assets/village/canonical/housing/building-18.svg",
    "x": 2835,
    "y": 2639,
    "width": 232,
    "height": 197,
    "id": "housing-13"
  },
  {
    "sourceId": "B63",
    "asset": "systems/crows/assets/village/canonical/housing/building-63.svg",
    "x": 2657,
    "y": 2671,
    "width": 213,
    "height": 286,
    "id": "housing-14"
  },
  {
    "sourceId": "B68",
    "asset": "systems/crows/assets/village/canonical/housing/building-68.svg",
    "x": 2172,
    "y": 3371,
    "width": 328,
    "height": 217,
    "id": "housing-15"
  },
  {
    "sourceId": "B33",
    "asset": "systems/crows/assets/village/canonical/housing/building-33.svg",
    "x": 3411,
    "y": 2714,
    "width": 212,
    "height": 280,
    "id": "housing-16"
  },
  {
    "sourceId": "B08",
    "asset": "systems/crows/assets/village/canonical/housing/building-08.svg",
    "x": 3226,
    "y": 2624,
    "width": 260,
    "height": 186,
    "id": "housing-17"
  },
  {
    "sourceId": "B67",
    "asset": "systems/crows/assets/village/canonical/housing/building-67.svg",
    "x": 2178,
    "y": 3556,
    "width": 238,
    "height": 190,
    "id": "housing-18"
  },
  {
    "sourceId": "B60",
    "asset": "systems/crows/assets/village/canonical/housing/building-60.svg",
    "x": 2193,
    "y": 3166,
    "width": 204,
    "height": 214,
    "id": "housing-19"
  },
  {
    "sourceId": "B64",
    "asset": "systems/crows/assets/village/canonical/housing/building-64.svg",
    "x": 2397,
    "y": 2734,
    "width": 235,
    "height": 287,
    "id": "housing-20"
  },
  {
    "sourceId": "B34",
    "asset": "systems/crows/assets/village/canonical/housing/building-34.svg",
    "x": 3595,
    "y": 4084,
    "width": 294,
    "height": 216,
    "id": "housing-21"
  },
  {
    "sourceId": "B24",
    "asset": "systems/crows/assets/village/canonical/housing/building-24.svg",
    "x": 3877,
    "y": 3153,
    "width": 237,
    "height": 276,
    "id": "housing-22"
  },
  {
    "sourceId": "B17",
    "asset": "systems/crows/assets/village/canonical/housing/building-17.svg",
    "x": 2776,
    "y": 2469,
    "width": 285,
    "height": 196,
    "id": "housing-23"
  },
  {
    "sourceId": "B38",
    "asset": "systems/crows/assets/village/canonical/housing/building-38.svg",
    "x": 2388,
    "y": 4186,
    "width": 233,
    "height": 199,
    "id": "housing-24"
  },
  {
    "sourceId": "B09",
    "asset": "systems/crows/assets/village/canonical/housing/building-09.svg",
    "x": 3245,
    "y": 2420,
    "width": 251,
    "height": 206,
    "id": "housing-25"
  },
  {
    "sourceId": "B55",
    "asset": "systems/crows/assets/village/canonical/housing/building-55.svg",
    "x": 2158,
    "y": 2794,
    "width": 283,
    "height": 229,
    "id": "housing-26"
  },
  {
    "sourceId": "B56",
    "asset": "systems/crows/assets/village/canonical/housing/building-56.svg",
    "x": 2202,
    "y": 2650,
    "width": 249,
    "height": 199,
    "id": "housing-27"
  },
  {
    "sourceId": "B70",
    "asset": "systems/crows/assets/village/canonical/housing/building-70.svg",
    "x": 1873,
    "y": 3492,
    "width": 290,
    "height": 203,
    "id": "housing-28"
  },
  {
    "sourceId": "B16",
    "asset": "systems/crows/assets/village/canonical/housing/building-16.svg",
    "x": 2792,
    "y": 2295,
    "width": 265,
    "height": 218,
    "id": "housing-29"
  },
  {
    "sourceId": "B25",
    "asset": "systems/crows/assets/village/canonical/housing/building-25.svg",
    "x": 4030,
    "y": 3137,
    "width": 158,
    "height": 227,
    "id": "housing-30"
  },
  {
    "sourceId": "B71",
    "asset": "systems/crows/assets/village/canonical/housing/building-71.svg",
    "x": 1822,
    "y": 3315,
    "width": 274,
    "height": 199,
    "id": "housing-31"
  },
  {
    "sourceId": "B57",
    "asset": "systems/crows/assets/village/canonical/housing/building-57.svg",
    "x": 2242,
    "y": 2481,
    "width": 302,
    "height": 221,
    "id": "housing-32"
  },
  {
    "sourceId": "B31",
    "asset": "systems/crows/assets/village/canonical/housing/building-31.svg",
    "x": 3854,
    "y": 2650,
    "width": 413,
    "height": 458,
    "id": "housing-33"
  },
  {
    "sourceId": "B10",
    "asset": "systems/crows/assets/village/canonical/housing/building-10.svg",
    "x": 3272,
    "y": 2184,
    "width": 330,
    "height": 232,
    "id": "housing-34"
  },
  {
    "sourceId": "B26",
    "asset": "systems/crows/assets/village/canonical/housing/building-26.svg",
    "x": 4161,
    "y": 3178,
    "width": 289,
    "height": 277,
    "id": "housing-35"
  },
  {
    "sourceId": "B66",
    "asset": "systems/crows/assets/village/canonical/housing/building-66.svg",
    "x": 1787,
    "y": 3821,
    "width": 312,
    "height": 244,
    "id": "housing-36"
  },
  {
    "sourceId": "B39",
    "asset": "systems/crows/assets/village/canonical/housing/building-39.svg",
    "x": 2419,
    "y": 4549,
    "width": 257,
    "height": 229,
    "id": "housing-37"
  },
  {
    "sourceId": "B15",
    "asset": "systems/crows/assets/village/canonical/housing/building-15.svg",
    "x": 2720,
    "y": 2135,
    "width": 293,
    "height": 208,
    "id": "housing-38"
  },
  {
    "sourceId": "B54",
    "asset": "systems/crows/assets/village/canonical/housing/building-54.svg",
    "x": 1775,
    "y": 2898,
    "width": 243,
    "height": 206,
    "id": "housing-39"
  },
  {
    "sourceId": "B50",
    "asset": "systems/crows/assets/village/canonical/housing/building-50.svg",
    "x": 2532,
    "y": 2178,
    "width": 247,
    "height": 247,
    "id": "housing-40"
  },
  {
    "sourceId": "B43",
    "asset": "systems/crows/assets/village/canonical/housing/building-43.svg",
    "x": 2060,
    "y": 4317,
    "width": 267,
    "height": 266,
    "id": "housing-41"
  },
  {
    "sourceId": "B30",
    "asset": "systems/crows/assets/village/canonical/housing/building-30.svg",
    "x": 4143,
    "y": 2713,
    "width": 201,
    "height": 215,
    "id": "housing-42"
  },
  {
    "sourceId": "B11",
    "asset": "systems/crows/assets/village/canonical/housing/building-11.svg",
    "x": 3183,
    "y": 2014,
    "width": 312,
    "height": 220,
    "id": "housing-43"
  },
  {
    "sourceId": "B27",
    "asset": "systems/crows/assets/village/canonical/housing/building-27.svg",
    "x": 4366,
    "y": 3184,
    "width": 230,
    "height": 271,
    "id": "housing-44"
  },
  {
    "sourceId": "B40",
    "asset": "systems/crows/assets/village/canonical/housing/building-40.svg",
    "x": 2498,
    "y": 4751,
    "width": 289,
    "height": 256,
    "id": "housing-45"
  },
  {
    "sourceId": "B46",
    "asset": "systems/crows/assets/village/canonical/housing/building-46.svg",
    "x": 2286,
    "y": 4680,
    "width": 280,
    "height": 291,
    "id": "housing-46"
  },
  {
    "sourceId": "B52",
    "asset": "systems/crows/assets/village/canonical/housing/building-52.svg",
    "x": 1815,
    "y": 2501,
    "width": 276,
    "height": 211,
    "id": "housing-47"
  },
  {
    "sourceId": "B44",
    "asset": "systems/crows/assets/village/canonical/housing/building-44.svg",
    "x": 1880,
    "y": 4408,
    "width": 275,
    "height": 263,
    "id": "housing-48"
  },
  {
    "sourceId": "B78",
    "asset": "systems/crows/assets/village/canonical/housing/building-78.svg",
    "x": 1447,
    "y": 3530,
    "width": 247,
    "height": 193,
    "id": "housing-49"
  },
  {
    "sourceId": "B79",
    "asset": "systems/crows/assets/village/canonical/housing/building-79.svg",
    "x": 1455,
    "y": 3709,
    "width": 238,
    "height": 201,
    "id": "housing-50"
  },
  {
    "sourceId": "B28",
    "asset": "systems/crows/assets/village/canonical/housing/building-28.svg",
    "x": 4519,
    "y": 3252,
    "width": 266,
    "height": 269,
    "id": "housing-51"
  },
  {
    "sourceId": "B77",
    "asset": "systems/crows/assets/village/canonical/housing/building-77.svg",
    "x": 1390,
    "y": 3357,
    "width": 298,
    "height": 222,
    "id": "housing-52"
  },
  {
    "sourceId": "B41",
    "asset": "systems/crows/assets/village/canonical/housing/building-41.svg",
    "x": 2691,
    "y": 4921,
    "width": 271,
    "height": 271,
    "id": "housing-53"
  },
  {
    "sourceId": "B51",
    "asset": "systems/crows/assets/village/canonical/housing/building-51.svg",
    "x": 1819,
    "y": 2318,
    "width": 261,
    "height": 201,
    "id": "housing-54"
  },
  {
    "sourceId": "B42",
    "asset": "systems/crows/assets/village/canonical/housing/building-42.svg",
    "x": 2984,
    "y": 4975,
    "width": 222,
    "height": 286,
    "id": "housing-55"
  },
  {
    "sourceId": "B76",
    "asset": "systems/crows/assets/village/canonical/housing/building-76.svg",
    "x": 1392,
    "y": 3215,
    "width": 301,
    "height": 197,
    "id": "housing-56"
  },
  {
    "sourceId": "B45",
    "asset": "systems/crows/assets/village/canonical/housing/building-45.svg",
    "x": 2110,
    "y": 4734,
    "width": 274,
    "height": 290,
    "id": "housing-57"
  },
  {
    "sourceId": "B80",
    "asset": "systems/crows/assets/village/canonical/housing/building-80.svg",
    "x": 1422,
    "y": 3900,
    "width": 296,
    "height": 205,
    "id": "housing-58"
  },
  {
    "sourceId": "B75",
    "asset": "systems/crows/assets/village/canonical/housing/building-75.svg",
    "x": 1383,
    "y": 3023,
    "width": 295,
    "height": 199,
    "id": "housing-59"
  },
  {
    "sourceId": "B47",
    "asset": "systems/crows/assets/village/canonical/housing/building-47.svg",
    "x": 2433,
    "y": 1833,
    "width": 301,
    "height": 253,
    "id": "housing-60"
  },
  {
    "sourceId": "B74",
    "asset": "systems/crows/assets/village/canonical/housing/building-74.svg",
    "x": 1421,
    "y": 2823,
    "width": 301,
    "height": 209,
    "id": "housing-61"
  },
  {
    "sourceId": "B81",
    "asset": "systems/crows/assets/village/canonical/housing/building-81.svg",
    "x": 1483,
    "y": 4122,
    "width": 272,
    "height": 223,
    "id": "housing-62"
  },
  {
    "sourceId": "B48",
    "asset": "systems/crows/assets/village/canonical/housing/building-48.svg",
    "x": 2292,
    "y": 1866,
    "width": 272,
    "height": 276,
    "id": "housing-63"
  },
  {
    "sourceId": "B14",
    "asset": "systems/crows/assets/village/canonical/housing/building-14.svg",
    "x": 2713,
    "y": 1721,
    "width": 256,
    "height": 203,
    "id": "housing-64"
  },
  {
    "sourceId": "B73",
    "asset": "systems/crows/assets/village/canonical/housing/building-73.svg",
    "x": 1457,
    "y": 2590,
    "width": 244,
    "height": 210,
    "id": "housing-65"
  },
  {
    "sourceId": "B13",
    "asset": "systems/crows/assets/village/canonical/housing/building-13.svg",
    "x": 3130,
    "y": 1637,
    "width": 269,
    "height": 212,
    "id": "housing-66"
  },
  {
    "sourceId": "B72",
    "asset": "systems/crows/assets/village/canonical/housing/building-72.svg",
    "x": 1447,
    "y": 2421,
    "width": 224,
    "height": 177,
    "id": "housing-67"
  },
  {
    "sourceId": "B58",
    "asset": "systems/crows/assets/village/canonical/housing/building-58.svg",
    "x": 1895,
    "y": 1877,
    "width": 254,
    "height": 278,
    "id": "housing-68"
  },
  {
    "sourceId": "B59",
    "asset": "systems/crows/assets/village/canonical/housing/building-59.svg",
    "x": 1447,
    "y": 2101,
    "width": 283,
    "height": 259,
    "id": "housing-69"
  }
]);
export const CANONICAL_FARMLAND_SLOTS = freezeEntries([
  {
    "sourceId": "F03",
    "asset": "systems/crows/assets/village/canonical/fields/field-03.svg",
    "x": 3949,
    "y": 3773,
    "width": 448,
    "height": 305,
    "id": "farmland-01"
  },
  {
    "sourceId": "F02",
    "asset": "systems/crows/assets/village/canonical/fields/field-02.svg",
    "x": 4028,
    "y": 3446,
    "width": 595,
    "height": 337,
    "id": "farmland-02"
  },
  {
    "sourceId": "F05",
    "asset": "systems/crows/assets/village/canonical/fields/field-05.svg",
    "x": 3588,
    "y": 2169,
    "width": 256,
    "height": 512,
    "id": "farmland-03"
  },
  {
    "sourceId": "F04",
    "asset": "systems/crows/assets/village/canonical/fields/field-04.svg",
    "x": 3910,
    "y": 2138,
    "width": 306,
    "height": 500,
    "id": "farmland-04"
  },
  {
    "sourceId": "F09",
    "asset": "systems/crows/assets/village/canonical/fields/field-09.svg",
    "x": 4322,
    "y": 1858,
    "width": 432,
    "height": 413,
    "id": "farmland-05"
  },
  {
    "sourceId": "F13",
    "asset": "systems/crows/assets/village/canonical/fields/field-13.svg",
    "x": 5127,
    "y": 4109,
    "width": 945,
    "height": 1150,
    "id": "farmland-06"
  },
  {
    "sourceId": "F15",
    "asset": "systems/crows/assets/village/canonical/fields/field-15.svg",
    "x": 2804,
    "y": 5757,
    "width": 1301,
    "height": 486,
    "id": "farmland-07"
  },
  {
    "sourceId": "F01",
    "asset": "systems/crows/assets/village/canonical/fields/field-01.svg",
    "x": 4234,
    "y": 5503,
    "width": 1715,
    "height": 993,
    "id": "farmland-08"
  },
  {
    "sourceId": "F22",
    "asset": "systems/crows/assets/village/canonical/fields/field-22.svg",
    "x": 1269,
    "y": 1398,
    "width": 936,
    "height": 714,
    "id": "farmland-09"
  },
  {
    "sourceId": "F17",
    "asset": "systems/crows/assets/village/canonical/fields/field-17.svg",
    "x": 1258,
    "y": 5358,
    "width": 1859,
    "height": 1284,
    "id": "farmland-10"
  },
  {
    "sourceId": "F19",
    "asset": "systems/crows/assets/village/canonical/fields/field-19.svg",
    "x": 302,
    "y": 3322,
    "width": 604,
    "height": 1319,
    "id": "farmland-11"
  },
  {
    "sourceId": "F14",
    "asset": "systems/crows/assets/village/canonical/fields/field-14.svg",
    "x": 4999,
    "y": 5129,
    "width": 1384,
    "height": 1390,
    "id": "farmland-12"
  },
  {
    "sourceId": "F08",
    "asset": "systems/crows/assets/village/canonical/fields/field-08.svg",
    "x": 4309,
    "y": 991,
    "width": 932,
    "height": 709,
    "id": "farmland-13"
  },
  {
    "sourceId": "F18",
    "asset": "systems/crows/assets/village/canonical/fields/field-18.svg",
    "x": 427,
    "y": 4495,
    "width": 854,
    "height": 1431,
    "id": "farmland-14"
  },
  {
    "sourceId": "F11",
    "asset": "systems/crows/assets/village/canonical/fields/field-11.svg",
    "x": 5625,
    "y": 2569,
    "width": 750,
    "height": 1083,
    "id": "farmland-15"
  },
  {
    "sourceId": "F20",
    "asset": "systems/crows/assets/village/canonical/fields/field-20.svg",
    "x": 441,
    "y": 2004,
    "width": 881,
    "height": 1505,
    "id": "farmland-16"
  },
  {
    "sourceId": "F06",
    "asset": "systems/crows/assets/village/canonical/fields/field-06.svg",
    "x": 3052,
    "y": 521,
    "width": 1086,
    "height": 1042,
    "id": "farmland-17"
  },
  {
    "sourceId": "F12",
    "asset": "systems/crows/assets/village/canonical/fields/field-12.svg",
    "x": 5609,
    "y": 4424,
    "width": 782,
    "height": 1559,
    "id": "farmland-18"
  },
  {
    "sourceId": "F16",
    "asset": "systems/crows/assets/village/canonical/fields/field-16.svg",
    "x": 2155,
    "y": 607,
    "width": 1189,
    "height": 1214,
    "id": "farmland-19"
  },
  {
    "sourceId": "F10",
    "asset": "systems/crows/assets/village/canonical/fields/field-10.svg",
    "x": 5293,
    "y": 1385,
    "width": 1414,
    "height": 1716,
    "id": "farmland-20"
  },
  {
    "sourceId": "F21",
    "asset": "systems/crows/assets/village/canonical/fields/field-21.svg",
    "x": 948,
    "y": 675,
    "width": 1387,
    "height": 1350,
    "id": "farmland-21"
  },
  {
    "sourceId": "F07",
    "asset": "systems/crows/assets/village/canonical/fields/field-07.svg",
    "x": 4714,
    "y": 491,
    "width": 1419,
    "height": 982,
    "id": "farmland-22"
  }
]);
export const CANONICAL_DRESSING_SLOTS = freezeEntries([
  {
    "sourceId": "T02",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-02.svg",
    "x": 3566,
    "y": 3557,
    "width": 240,
    "height": 198,
    "id": "dressing-01"
  },
  {
    "sourceId": "T01",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-01.svg",
    "x": 3563,
    "y": 3701,
    "width": 240,
    "height": 199,
    "id": "dressing-02"
  },
  {
    "sourceId": "T33",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-33.svg",
    "x": 2116,
    "y": 3727,
    "width": 248,
    "height": 224,
    "id": "dressing-03"
  },
  {
    "sourceId": "T13",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-13.svg",
    "x": 3387,
    "y": 1780,
    "width": 228,
    "height": 207,
    "id": "dressing-04"
  },
  {
    "sourceId": "T32",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-32.svg",
    "x": 2206,
    "y": 4882,
    "width": 233,
    "height": 215,
    "id": "dressing-05"
  },
  {
    "sourceId": "T12",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-12.svg",
    "x": 3553,
    "y": 1762,
    "width": 233,
    "height": 215,
    "id": "dressing-06"
  },
  {
    "sourceId": "T16",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-16.svg",
    "x": 4290,
    "y": 2248,
    "width": 248,
    "height": 205,
    "id": "dressing-07"
  },
  {
    "sourceId": "T27",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-27.svg",
    "x": 2876,
    "y": 5153,
    "width": 211,
    "height": 186,
    "id": "dressing-08"
  },
  {
    "sourceId": "T11",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-11.svg",
    "x": 3721,
    "y": 1752,
    "width": 201,
    "height": 165,
    "id": "dressing-09"
  },
  {
    "sourceId": "T30",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-30.svg",
    "x": 2491,
    "y": 5129,
    "width": 240,
    "height": 207,
    "id": "dressing-10"
  },
  {
    "sourceId": "T31",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-31.svg",
    "x": 2057,
    "y": 4959,
    "width": 240,
    "height": 198,
    "id": "dressing-11"
  },
  {
    "sourceId": "T69",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-69.svg",
    "x": 2425,
    "y": 1633,
    "width": 334,
    "height": 267,
    "id": "dressing-12"
  },
  {
    "sourceId": "T67",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-67.svg",
    "x": 2200,
    "y": 1709,
    "width": 365,
    "height": 331,
    "id": "dressing-13"
  },
  {
    "sourceId": "T09",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-09.svg",
    "x": 3422,
    "y": 1607,
    "width": 248,
    "height": 205,
    "id": "dressing-14"
  },
  {
    "sourceId": "T36",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-36.svg",
    "x": 1189,
    "y": 3904,
    "width": 240,
    "height": 198,
    "id": "dressing-15"
  },
  {
    "sourceId": "T18",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-18.svg",
    "x": 4500,
    "y": 2400,
    "width": 225,
    "height": 208,
    "id": "dressing-16"
  },
  {
    "sourceId": "T35",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-35.svg",
    "x": 1237,
    "y": 4057,
    "width": 228,
    "height": 207,
    "id": "dressing-17"
  },
  {
    "sourceId": "T37",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-37.svg",
    "x": 1136,
    "y": 3742,
    "width": 201,
    "height": 165,
    "id": "dressing-18"
  },
  {
    "sourceId": "T45",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-45.svg",
    "x": 1100,
    "y": 3325,
    "width": 207,
    "height": 195,
    "id": "dressing-19"
  },
  {
    "sourceId": "T26",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-26.svg",
    "x": 2735,
    "y": 5214,
    "width": 242,
    "height": 212,
    "id": "dressing-20"
  },
  {
    "sourceId": "T43",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-43.svg",
    "x": 1097,
    "y": 3517,
    "width": 207,
    "height": 195,
    "id": "dressing-21"
  },
  {
    "sourceId": "T34",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-34.svg",
    "x": 1288,
    "y": 4215,
    "width": 242,
    "height": 212,
    "id": "dressing-22"
  },
  {
    "sourceId": "T22",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-22.svg",
    "x": 3068,
    "y": 5259,
    "width": 215,
    "height": 206,
    "id": "dressing-23"
  },
  {
    "sourceId": "T10",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-10.svg",
    "x": 3898,
    "y": 1746,
    "width": 248,
    "height": 224,
    "id": "dressing-24"
  },
  {
    "sourceId": "T46",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-46.svg",
    "x": 1090,
    "y": 3019,
    "width": 248,
    "height": 224,
    "id": "dressing-25"
  },
  {
    "sourceId": "T15",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-15.svg",
    "x": 4429,
    "y": 2201,
    "width": 228,
    "height": 207,
    "id": "dressing-26"
  },
  {
    "sourceId": "T08",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-08.svg",
    "x": 3588,
    "y": 1583,
    "width": 233,
    "height": 215,
    "id": "dressing-27"
  },
  {
    "sourceId": "T29",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-29.svg",
    "x": 2343,
    "y": 5188,
    "width": 248,
    "height": 224,
    "id": "dressing-28"
  },
  {
    "sourceId": "T25",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-25.svg",
    "x": 2572,
    "y": 5272,
    "width": 207,
    "height": 195,
    "id": "dressing-29"
  },
  {
    "sourceId": "T06",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-06.svg",
    "x": 3116,
    "y": 1453,
    "width": 248,
    "height": 205,
    "id": "dressing-30"
  },
  {
    "sourceId": "T21",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-21.svg",
    "x": 2914,
    "y": 5320,
    "width": 210,
    "height": 188,
    "id": "dressing-31"
  },
  {
    "sourceId": "T57",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-57.svg",
    "x": 4835,
    "y": 2918,
    "width": 315,
    "height": 265,
    "id": "dressing-32"
  },
  {
    "sourceId": "T71",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-71.svg",
    "x": 2703,
    "y": 1442,
    "width": 321,
    "height": 308,
    "id": "dressing-33"
  },
  {
    "sourceId": "T70",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-70.svg",
    "x": 2512,
    "y": 1470,
    "width": 294,
    "height": 280,
    "id": "dressing-34"
  },
  {
    "sourceId": "T17",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-17.svg",
    "x": 4629,
    "y": 2366,
    "width": 211,
    "height": 186,
    "id": "dressing-35"
  },
  {
    "sourceId": "T05",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-05.svg",
    "x": 3280,
    "y": 1439,
    "width": 215,
    "height": 206,
    "id": "dressing-36"
  },
  {
    "sourceId": "T66",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-66.svg",
    "x": 2334,
    "y": 1506,
    "width": 302,
    "height": 260,
    "id": "dressing-37"
  },
  {
    "sourceId": "T07",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-07.svg",
    "x": 3764,
    "y": 1580,
    "width": 248,
    "height": 224,
    "id": "dressing-38"
  },
  {
    "sourceId": "T68",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-68.svg",
    "x": 2061,
    "y": 1600,
    "width": 294,
    "height": 280,
    "id": "dressing-39"
  },
  {
    "sourceId": "T61",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-61.svg",
    "x": 4741,
    "y": 2501,
    "width": 294,
    "height": 280,
    "id": "dressing-40"
  },
  {
    "sourceId": "T44",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-44.svg",
    "x": 942,
    "y": 3336,
    "width": 240,
    "height": 207,
    "id": "dressing-41"
  },
  {
    "sourceId": "T20",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-20.svg",
    "x": 2756,
    "y": 5375,
    "width": 199,
    "height": 183,
    "id": "dressing-42"
  },
  {
    "sourceId": "T42",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-42.svg",
    "x": 938,
    "y": 3519,
    "width": 201,
    "height": 165,
    "id": "dressing-43"
  },
  {
    "sourceId": "T04",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-04.svg",
    "x": 3451,
    "y": 1428,
    "width": 240,
    "height": 207,
    "id": "dressing-44"
  },
  {
    "sourceId": "T55",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-55.svg",
    "x": 4816,
    "y": 2622,
    "width": 294,
    "height": 280,
    "id": "dressing-45"
  },
  {
    "sourceId": "T28",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-28.svg",
    "x": 2180,
    "y": 5251,
    "width": 215,
    "height": 206,
    "id": "dressing-46"
  },
  {
    "sourceId": "T14",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-14.svg",
    "x": 4565,
    "y": 2163,
    "width": 240,
    "height": 198,
    "id": "dressing-47"
  },
  {
    "sourceId": "T24",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-24.svg",
    "x": 2425,
    "y": 5337,
    "width": 242,
    "height": 212,
    "id": "dressing-48"
  },
  {
    "sourceId": "T75",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-75.svg",
    "x": 1698,
    "y": 1777,
    "width": 358,
    "height": 300,
    "id": "dressing-49"
  },
  {
    "sourceId": "T41",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-41.svg",
    "x": 978,
    "y": 3897,
    "width": 240,
    "height": 207,
    "id": "dressing-50"
  },
  {
    "sourceId": "T40",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-40.svg",
    "x": 1024,
    "y": 4053,
    "width": 240,
    "height": 207,
    "id": "dressing-51"
  },
  {
    "sourceId": "T73",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-73.svg",
    "x": 1281,
    "y": 2202,
    "width": 294,
    "height": 280,
    "id": "dressing-52"
  },
  {
    "sourceId": "T39",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-39.svg",
    "x": 1071,
    "y": 4206,
    "width": 210,
    "height": 188,
    "id": "dressing-53"
  },
  {
    "sourceId": "T74",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-74.svg",
    "x": 1165,
    "y": 2330,
    "width": 330,
    "height": 284,
    "id": "dressing-54"
  },
  {
    "sourceId": "T38",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-38.svg",
    "x": 1125,
    "y": 4359,
    "width": 228,
    "height": 207,
    "id": "dressing-55"
  },
  {
    "sourceId": "T03",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-03.svg",
    "x": 3628,
    "y": 1414,
    "width": 240,
    "height": 198,
    "id": "dressing-56"
  },
  {
    "sourceId": "T19",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-19.svg",
    "x": 2611,
    "y": 5439,
    "width": 228,
    "height": 207,
    "id": "dressing-57"
  },
  {
    "sourceId": "T56",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-56.svg",
    "x": 4947,
    "y": 2752,
    "width": 399,
    "height": 306,
    "id": "dressing-58"
  },
  {
    "sourceId": "T54",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-54.svg",
    "x": 4806,
    "y": 2337,
    "width": 294,
    "height": 280,
    "id": "dressing-59"
  },
  {
    "sourceId": "T23",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-23.svg",
    "x": 2258,
    "y": 5401,
    "width": 240,
    "height": 207,
    "id": "dressing-60"
  },
  {
    "sourceId": "T53",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-53.svg",
    "x": 4737,
    "y": 2202,
    "width": 294,
    "height": 280,
    "id": "dressing-61"
  },
  {
    "sourceId": "T76",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-76.svg",
    "x": 4909,
    "y": 2480,
    "width": 336,
    "height": 287,
    "id": "dressing-62"
  },
  {
    "sourceId": "T51",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-51.svg",
    "x": 4551,
    "y": 1927,
    "width": 330,
    "height": 284,
    "id": "dressing-63"
  },
  {
    "sourceId": "T58",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-58.svg",
    "x": 5008,
    "y": 2594,
    "width": 321,
    "height": 308,
    "id": "dressing-64"
  },
  {
    "sourceId": "T52",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-52.svg",
    "x": 4731,
    "y": 2042,
    "width": 336,
    "height": 287,
    "id": "dressing-65"
  },
  {
    "sourceId": "T60",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-60.svg",
    "x": 4953,
    "y": 2327,
    "width": 289,
    "height": 264,
    "id": "dressing-66"
  },
  {
    "sourceId": "T50",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-50.svg",
    "x": 4504,
    "y": 1709,
    "width": 365,
    "height": 331,
    "id": "dressing-67"
  },
  {
    "sourceId": "T77",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-77.svg",
    "x": 4896,
    "y": 2173,
    "width": 370,
    "height": 336,
    "id": "dressing-68"
  },
  {
    "sourceId": "T59",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-59.svg",
    "x": 5070,
    "y": 2472,
    "width": 294,
    "height": 280,
    "id": "dressing-69"
  },
  {
    "sourceId": "T49",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-49.svg",
    "x": 4661,
    "y": 1827,
    "width": 319,
    "height": 283,
    "id": "dressing-70"
  },
  {
    "sourceId": "T48",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-48.svg",
    "x": 4824,
    "y": 1964,
    "width": 315,
    "height": 265,
    "id": "dressing-71"
  },
  {
    "sourceId": "T62",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-62.svg",
    "x": 5070,
    "y": 2204,
    "width": 294,
    "height": 280,
    "id": "dressing-72"
  },
  {
    "sourceId": "T47",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-47.svg",
    "x": 4999,
    "y": 2054,
    "width": 308,
    "height": 272,
    "id": "dressing-73"
  },
  {
    "sourceId": "T72",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-72.svg",
    "x": 1048,
    "y": 1709,
    "width": 365,
    "height": 331,
    "id": "dressing-74"
  },
  {
    "sourceId": "T65",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-65.svg",
    "x": 694,
    "y": 1729,
    "width": 315,
    "height": 265,
    "id": "dressing-75"
  },
  {
    "sourceId": "T63",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-63.svg",
    "x": 761,
    "y": 1584,
    "width": 284,
    "height": 260,
    "id": "dressing-76"
  },
  {
    "sourceId": "T64",
    "asset": "systems/crows/assets/village/canonical/dressing/tree-64.svg",
    "x": 569,
    "y": 1528,
    "width": 335,
    "height": 320,
    "id": "dressing-77"
  }
]);

/** Monotonic length; returning to a prior Prosperity restores its exact prefix. */
export function canonicalPrefixCount(prosperity, capacity) {
  const value = Math.max(-10, Math.min(10, Math.floor(Number(prosperity) || 0)));
  return Math.round(((value + 10) / 20) * Math.max(0, Math.floor(Number(capacity) || 0)));
}
