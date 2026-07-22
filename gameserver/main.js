const dotenv = require("dotenv");

global.main = this;

this.PRODUCTION = false;
this.PORT = this.PRODUCTION ? 443 : 7777;
//this.SERVER_URL = this.PRODUCTION ? "wss://usa.flapn.fun:443" : "ws://192.168.1.191:7777";
//this.GATEWAY_URL = this.PRODUCTION ? "https://gate.flapn.fun" : "http://127.0.0.1:443";
this.GATEWAY_PASSWORD = process.env.GATEWAY_PASSWORD;
this.CCU = 0;

global.main.USD_PER_SOL = 80;
global.main.USD_PER_SKR = 0.02282;
global.main.USD_PER_PROJECT_TOKEN = 0.000001;
global.main.USD_PER_USDC = 1;

this.MAX_PLAYERS = 100;

const jsdom = require('jsdom');
const domsim = require('./domsim.js');
const express = require('express');
const pc = require('./src/playcanvas.js');
const { join } = require('path');
const utils = require('./src/utils.js');
const fetch = require('node-fetch');
const admin = require('./src/admin.js');
const Loader = require('./src/loader.js');

let expressApp;
// Express is only used privately so that the world server can
// load up .glb files for the world simulation,
// it should never be exposed to the public internet
function startExpress()
{
    let expressApp = express();
    const port = 3000;
    const path = __dirname;

    const fullPath = join(path, "res");
    expressApp.use("/", express.static(fullPath));

    expressApp.listen(port, () => {
        console.log(`PRIVATE Express server started on port ${port}`);
        console.log("World server is now ready to load GLB files for the world simulation.");
    });
}

let app, loader;

const AmmoLib = require('./res/ammo.wasm.js');

async function startEngine()
{
     domsim();

    // Create the PlayCanvas application that will run the
    // server-side simulations
    const canvas = document.createElement('canvas');

    // Null graphics device, we don't need to render
    // anything on the server
    const graphicsDevice = new pc.NullGraphicsDevice(canvas);
    app = new pc.Application(canvas, { graphicsDevice });
    global.main.app = app;

    app.on("start", function () {
        console.log("PlayCanvas application started.");
    });
    app.start();

    // Initialize the GLB Loader to simulate the world on the WorldServer
    let promise = new Promise((resolve) => {
        loader = new Loader(()=>{
            console.log("Loader initialized.");
            global.main.loader = loader;
            resolve();
        });
    });
    await promise;

    // Load Ammo.js (Bullet Physics) for physics simulation
    const Ammo = await AmmoLib({
        locateFile: (path) => {
            if (path.endsWith('.wasm')) return './res/ammo.wasm.wasm';
            return path;
        }
    });

    global.Ammo = Ammo;

    const heapBytes = Ammo.HEAPU8.byteLength;
    const heapMB = heapBytes / 1024 / 1024;
    
    console.log(`Ammo heap: ${heapBytes} bytes (${heapMB.toFixed(2)} MB)`);
    console.log(`WASM pages: ${heapBytes / 65536}`);

    app.systems.rigidbody.onLibraryLoaded();
    app.systems.rigidbody.fixedTimeStep = 1 / 60;

    console.log("Playcanvas physics ready!");

    // Update the simulation
    setInterval(() => {
        update(0.029);
    }, 29);

    global.main.world = new (require('./src/world.js'))();
    global.main.network = require('./src/network.js');
}

function update(dt){
    app.update(1 / 30);

    if(global.main.world)
        global.main.world.update(0.029);
}

// Spin up express for .glb loading
startExpress();
// Start the engine for world simulation
startEngine();