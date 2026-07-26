
// Classes & objects
let loader;
let client;
let ui;
let camera;
let physics;
let terrain;
let grass;

const SCRIPTS_TO_UPDATE = [];
const PREFABS = [];

// Variables
const FIXED_DT = 1 / 60;
let time = 0;
let BLURRED;
let USD_PER_SOL = 78.04;
let USD_PER_SKR = 0.02;

let tempVec;

async function injectAnalytics()
{
    try
    {
        const gtagScript = document.createElement('script');
        gtagScript.async = true;
        gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-E70EEL9Y9X';
        document.head.appendChild(gtagScript);

        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-E70EEL9Y9X');
    }
    catch(err)
    {
        console.log("Failed to load analytics script", err);
    }
}

async function init()
{
    //injectAnalytics();
    await Physics.inject();
    physics = new Physics();

    const canvas = document.getElementById("game-renderer");

    let devices = ["webgpu", "webgl2", "webgl"];
    //let devices = ["webgl2", "webgl"];
    if(isMobile && window.mobileDevice === "iOS")
        devices = ["webgl2"];

    let graphicsDeviceOptions = {
        deviceTypes: devices,
        antialias: false,
        maxPixelRatio: 1,
        powerPreference: "low-power"
    };

    const gd = await pc.createGraphicsDevice(canvas, graphicsDeviceOptions);

    const createOptions = new pc.AppOptions();
    createOptions.graphicsDevice = gd;
    createOptions.mouse = new pc.Mouse(canvas);
    createOptions.keyboard = new pc.Keyboard(window);
    createOptions.touch = new pc.TouchDevice(canvas);
    createOptions.soundManager = new pc.SoundManager();

    createOptions.componentSystems = [
        pc.RenderComponentSystem,
        pc.CameraComponentSystem,
        pc.AnimationComponentSystem,
        pc.AnimComponentSystem,
        pc.AudioListenerComponentSystem,
        pc.SoundComponentSystem,
        pc.LightComponentSystem,
        pc.ParticleSystemComponentSystem,
        pc.CollisionComponentSystem,
        pc.RigidBodyComponentSystem
    ];

    createOptions.resourceHandlers = [
        pc.TextureHandler,
        pc.ContainerHandler,
        pc.AudioHandler,
        pc.AnimationHandler,
        pc.AnimClipHandler,
        pc.ModelHandler,
        pc.MaterialHandler
    ];

    game = new pc.AppBase(canvas);
    game.init(createOptions);

    gd.application = game;

    installGlobalCurvatureShader(game.graphicsDevice);

    game.mouse.disableContextMenu();

    loader = new Loader(game);

    game.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    game.setCanvasResolution(
        pc.RESOLUTION_AUTO,
        window.innerWidth,
        window.innerHeight
    );

    window.addEventListener("resize", ()=>{
        game.resizeCanvas();
    });

    game.on("update", ()=>{
        update(FIXED_DT);
    });
    game.on("start", ()=>{
        const canvas = game.graphicsDevice.canvas;
        canvas.removeAttribute('data-engine');
    });
    game.autoRender = true;
    game.start();

    //installParticleCurvature(game.graphicsDevice);

    tempVec = new pc.Vec3();

    // Batcher
    game._batcher = new pc.BatchManager(game.graphicsDevice, game.root, game.scene);
    // example: game.batcher.addGroup("coins", true, 1000);

    await setupScene();
    await loader.loadModel("res/models/assets.glb", "assets", (assetPack)=>{
        const assets = assetPack.instantiateRenderEntity();
        assets.enabled = false;
        console.log(assets);
        game.root.addChild(assets);

        PREFABS.push({
            name: "player",
            entity: assets.findByName("Player")
        });

        PREFABS.push({
            name: "blob_shadow",
            entity: assets.findByName("blob_shadow")
        });
        console.log(PREFABS[1]);
    });

    camera = new Camera();

    document.getElementById("pre-launch").remove();
    document.getElementById("landing").remove();

    //ui = new UI(game);

    window.onblur = function() {
        BLURRED = true;
    };

    window.onfocus = function() {
        BLURRED = false;
    };

    await TerrainMaterial.buildMaterial();
    terrain = new TerrainManager();

    /*const meadow = new Grass(15, -15, 10, 10, 5000);
    const purple = new Grass(25, -25, 10, 10, 5000, {
        baseColor: [0.15, 0.10, 0.30],
        tipColor:  [0.60, 0.35, 0.90],
        minHeight: 0.4, maxHeight: 0.9,
        renderDist: 40
    });
    purple.cutRadius(25, -25, 2);
    const white = new Grass(35, -35, 10, 10, 5000, {
        baseColor: [0.15, 0.15, 0.15],
        tipColor:  [0.90, 0.90, 0.90],
        minHeight: 0.4, maxHeight: 2.5,
        renderDist: 40
    });

    const red = new Grass(10, -10, 10, 10, 5000, {
        baseColor: [0.30, 0.10, 0.10],
        tipColor:  [0.90, 0.35, 0.35],
        minHeight: 0.4, maxHeight: 1.5,
        renderDist: 40
    });
    const green = new Grass(20, -10, 10, 10, 5000, {
        baseColor: [0.10, 0.30, 0.10],
        tipColor:  [0.35, 0.90, 0.35],
        minHeight: 0.4, maxHeight: 1.5,
        renderDist: 40
    });
    const blue = new Grass(30, -10, 10, 10, 5000, {
        baseColor: [0.10, 0.10, 0.30],
        tipColor:  [0.35, 0.35, 0.90],
        minHeight: 0.4, maxHeight: 1.5,
        renderDist: 40
    });*/
    Grass.fromTexture('res/textures/grass_0_0_100_100.png', 200_000,
    {
        spawnColor: [255, 255, 255],   // default
        tolerance: 0.75,              // exact match
        baseColor: [0.15, 0.10, 0.30],
        tipColor:  [0.60, 0.35, 0.90],
        flipZ: true,
    });
    Grass.fromTexture('res/textures/grass_0_0_100_100.png', 200_000,
    {
        spawnColor: [255, 0, 0],   // default
        tolerance: 0.75,              // exact match
        baseColor: [255, 255 * 0.5, 0],
        tipColor:  [255, 0, 0],
        flipZ: true,
    });
    /*Grass.buildMaterial();
    Grass.setupInstancing();
    Grass.installMesh(
        Grass.createBladeMesh(),
        1.0,
        true
    );
    grass = new Grass();
    // …or a GLB
    // Grass.loadBladeGlb('assets/blade.glb');

    // Spawn a field
    Grass.scatter(20, -20, 10, 10, 5_000);
    /*
    // or place blades individually from your own matrices
    const m = new pc.Mat4();
    m.setTRS(new pc.Vec3(5, 0, 3), new pc.Quat().setFromEulerAngles(0, 45, 0), new pc.Vec3(1, 0.8, 1));
    const handle = Grass.addBlade(m);*/

    // cutting
    // Grass.cutRadius(playerX, playerZ, 1.5);

    /*
    const h = Grass.findBlade(playerX, playerZ, 0.5);
    if (h >= 0) Grass.removeBlade(h);*/

    /*
    // recolour whenever
    Grass.setColors([0.1, 0.3, 0.05], [0.6, 0.85, 0.3]);
    Grass.setColorVariance(0.8);
    Grass.setVarianceSplit(0.1, 0.35, 1.0);   // splitY, dim below, bright above*/

    // Start up the login and game clients
    client = new Client();
    client.connect({
        url: "ws://192.168.1.191:7777"
    });
}

function update(dt)
{
    time += dt;

    if(ui) ui.update();

    for(let i = 0; i < SCRIPTS_TO_UPDATE.length; i++)
        if(SCRIPTS_TO_UPDATE[i].update)
            SCRIPTS_TO_UPDATE[i].update(dt);

    // Postupdate
    for(let i = 0; i < SCRIPTS_TO_UPDATE.length; i++)
        if(SCRIPTS_TO_UPDATE[i].postUpdate)
            SCRIPTS_TO_UPDATE[i].postUpdate();

    if(ui) ui.postUpdate();

    if(terrain && client && client.mPlayer)
    {
        terrain.update(client.mPlayer.entity.getPosition().x, client.mPlayer.entity.getPosition().z);
    }

    if(camera && camera.entity)
        updateCurvatureUniforms(camera.entity, game.graphicsDevice);
}



init();