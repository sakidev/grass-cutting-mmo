const pc = require('./playcanvas.js');
const { PacketHeader, OutgoingPacket } = require("./packet.js");
const fs = require('fs');
const Grass = require('./grass.js');
const constants = require('./constants.js');

class World {
    constructor(rankedGame) {
        const self = this;

        this.physics = global.main.app.systems.rigidbody;

        this.physics.fixedTimeStep = 1 / 30;
        console.log("Physics fixed time step set to", this.physics.fixedTimeStep);

        this.tempVec = new pc.Vec3();

        // Load the world tiles
        this.tilePaths = [];
        // Read all filenames from the "world_tiles" directory
        const worldTilesDir = 'res/world_tiles';
        const files = fs.readdirSync(worldTilesDir);
        for (const file of files) {
            if (file.endsWith('.glb')) {
                const tilePath = `world_tiles/${file}`;
                this.tilePaths.push(tilePath);
            }
        }

        this.volumesIdentified = [];
        this.volumesSpawned = [];

        /*this.floor = new pc.Entity("floor");
        this.floor.addComponent("collision", {
            type: "box",
            halfExtents: new pc.Vec3(10, 0.001, 10),
        });
        this.floor.addComponent("rigidbody", {
            type: "static",
            friction: 0,
            restitution: 0
        });
        global.main.app.root.addChild(this.floor);*/
    }

    async loadWorld()
    {
        for(let i = 0; i < this.tilePaths.length; i++)
        {
            console.log("Loading World tile", i, ":", this.tilePaths[i]);
            await this.loadWorldTile(
                this.tilePaths[i],
                this.tilePaths[i].replace(/^res\/world_tiles\//, "").replace("http://localhost:3000/", "")
            );
        }

        // After all of the terrain world tiles have been loaded up, we can now spawn the grass
        for(let i = 0; i < constants.GRASS_PATCHES.length; i++)
        {
            const newPatch = Grass.fromTexture(
                constants.GRASS_PATCHES[i].fileName,
                constants.GRASS_PATCHES[i].bladeAmount,
                {
                    spawnColor: constants.GRASS_PATCHES[i].spawnColor,
                    tolerance: constants.GRASS_PATCHES[i].tolerance,
                    baseColor: constants.GRASS_PATCHES[i].baseColor,
                    tipColor: constants.GRASS_PATCHES[i].tipColor,
                    flipZ: constants.GRASS_PATCHES[i].flipZ,
                    seed: constants.GRASS_PATCHES[i].seed
                }
            );

            constants.GRASS_PATCHES[i].originalPatch = newPatch;
        }
    }

    async loadScene(sceneName)
    {
        return await new Promise((resolve)=>{
            global.main.loader.loadModel("scenes/" + sceneName + ".glb", sceneName, (model)=>
            {
                const instance = model.instantiateRenderEntity();
                global.main.app.root.addChild(instance);

                for(const child of instance.children)
                {
                    if(child.name.includes("NebulaeRing"))
                    {
                        child.addComponent("collision", {
                            type: "sphere",
                            radius: 5
                        });
                        child.collision.on("triggerenter", (otherEntity)=>{
                            if(otherEntity.actor)
                            {
                                console.log(">>>>>>>>>>>>>>>", otherEntity.name);
                                otherEntity.actor.onEnterTrigger(child);
                            }
                        });
                    }
                }

                console.log("Scene " + sceneName + " loaded");

                resolve(true);
            });
        });
    }

    async loadWorldTile(path, fileName)
    {
        const promise = new Promise((resolve)=>{
            console.log("loading world tile", path);
            global.main.loader.loadModel(path, fileName, (model)=>
            {
                const instance = model.instantiateRenderEntity();
                console.log("World tile loaded", path);

                global.main.app.root.addChild(instance);

                // Now iterate all children and ignore the tile itself
                for(let i = 0; i < instance.children.length; i++)
                {
                    const child = instance.children[i];
                    console.log("Child", i, ":", instance.children[i].name);
                    
                    if(child.name.includes("tile_"))
                    {
                        const instanceTile = child;
                        instanceTile.addComponent("collision", {
                            type: "mesh",
                            renderAsset: instanceTile.render.asset,
                        });
                        instanceTile.addComponent("rigidbody", {
                            type: "static",
                            friction: 0,
                            restitution: 0
                        });
        
                        instanceTile.collision.on("collisionstart", (result)=>{
                            const otherEntity = result.other;
                            console.log("Collision detected between", instance.name, "and", otherEntity.name);
                        });
                    }
                    // Grass Volumes are used to identify
                    // areas were huge amounts of grass are present,
                    // so that we can order the client to load/unload
                    // them as they enter/exit the volume triggers
                    else if(child.name.includes("GrassVolume"))
                    {
                        const grassVolumeIdx = parseInt(child.name.split("_")[1])
                        if(this.volumesIdentified.includes(grassVolumeIdx))
                            continue;

                        console.log("Identified grass volume", grassVolumeIdx, "in world tile", fileName);
                        this.volumesIdentified.push(grassVolumeIdx);

                        const volume = new pc.Entity("grass_volume_" + grassVolumeIdx);
                        volume.addComponent("collision", {
                            type: "box",
                            halfExtents: child.render.meshInstances[0].aabb.halfExtents,
                        });
                        volume.collision.on("triggerenter", (otherEntity)=>{
                            if(otherEntity.player)
                            {
                                console.log("Player", otherEntity.player.id, "entered grass volume", grassVolumeIdx);

                                if(otherEntity.player.ws)
                                {
                                    const pkt = new OutgoingPacket(PacketHeader.GameServer.ORDER_LOAD_GRASS_PATCH, 1 + 4 + 4 + (constants.GRASS_PATCHES[grassVolumeIdx - 1].cutBits.length));
                                    pkt.WriteInt(grassVolumeIdx - 1); // Grass patches array is 0-indexed, but the volume names are 1-indexed, so convert it here
                                    pkt.WriteInt(constants.GRASS_PATCHES[grassVolumeIdx - 1].cutBits.length);
                                    for(let j = 0; j < constants.GRASS_PATCHES[grassVolumeIdx - 1].cutBits.length; j++)
                                    {
                                        pkt.WriteByte(constants.GRASS_PATCHES[grassVolumeIdx - 1].cutBits[j]);
                                    }
                                    try{
                                        otherEntity.player.ws.send(pkt.buffer, true);
                                    }catch(err){ }

                                    otherEntity.player.addInsideGrassPatch(
                                        constants.GRASS_PATCHES[grassVolumeIdx - 1]
                                    );
                                    otherEntity.player.sortInsideGrassPatchesByDistance();
                                }
                            }
                        });
                        volume.collision.on("triggerleave", (otherEntity)=>{
                            if(otherEntity.player)
                            {
                                console.log("Player", otherEntity.player.id, "left grass volume", grassVolumeIdx);

                                if(otherEntity.player.ws)
                                {
                                    const pkt = new OutgoingPacket(PacketHeader.GameServer.ORDER_UNLOAD_GRASS_PATCH, 1 + 4);
                                    pkt.WriteInt(grassVolumeIdx - 1);
                                    try{
                                        otherEntity.player.ws.send(pkt.buffer, true);
                                    }catch(err){ }

                                    otherEntity.player.removeInsideGrassPatch(
                                        constants.GRASS_PATCHES[grassVolumeIdx - 1]
                                    );
                                    otherEntity.player.sortInsideGrassPatchesByDistance();
                                }
                            }
                        });
                        volume.setPosition(child.getPosition());
                        console.log(volume.getPosition(), "half extents", volume.collision.halfExtents);
                        this.volumesSpawned.push(volume);
                        global.main.app.root.addChild(volume);
                    }

                }
                resolve(true);
            });
        });

        return await promise;
    }

    update(dt)
    {
        //console.log("World update called with dt:", dt);

        // Update all players
        global.main.network.player.update(dt);
    }
}

module.exports = World;