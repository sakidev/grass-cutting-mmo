
// Classes & objects
let loader;
let client;
let ui;
let camera;
let physics;
let terrain;

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

    installParticleCurvature(game.graphicsDevice);

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

    // Start up the login and game clients
    client = new Client();
    client.connect({
        url: "ws://127.0.0.1:7777"
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

    if(terrain && client.mPlayer)
    {
        terrain.update(client.mPlayer.entity.getPosition().x, client.mPlayer.entity.getPosition().z);
    }

    updateCurvatureUniforms(camera.entity, game.graphicsDevice);
}



init();