const GRASS_PATCHES = [
    {
        fileName: 'res/textures/grass_0_0_100_100.png',
        bladeAmount: 2000,
        spawnColor: [255, 255, 255],
        tolerance: 0.75,
        baseColor: [0.15, 0.10, 0.30],
        tipColor:  [0.60, 0.35, 0.90],
        flipZ: true,
        cutBits: [], // The state of the cut grass blades is stored here
        seed: 1
    },
    {
        fileName: 'res/textures/grass_0_0_100_100.png',
        bladeAmount: 10_000,
        spawnColor: [255, 0, 0],
        tolerance: 0.75,
        baseColor: [0.5, 0.5, 0.5],
        tipColor:  [0.90, 0.90, 0.90],
        flipZ: true,
        cutBits: [], // The state of the cut grass blades is stored here
        seed: 2
    }
];