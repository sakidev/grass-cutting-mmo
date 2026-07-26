const pc = require('./playcanvas.js');
const { PacketHeader, OutgoingPacket } = require("./packet.js");
const fs = require('fs');

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
            this.loadWorldTile(
                this.tilePaths[i],
                this.tilePaths[i].replace(/^res\/world_tiles\//, "").replace("http://localhost:3000/", "")
            );
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
                console.log("World tile loaded", instance.name);

                instance.addComponent("collision", {
                    type: "mesh",
                    renderAsset: instance.render.asset,
                });
                instance.addComponent("rigidbody", {
                    type: "static",
                    friction: 0,
                    restitution: 0
                });

                instance.collision.on("collisionstart", (result)=>{
                    const otherEntity = result.other;
                    console.log("Collision detected between", instance.name, "and", otherEntity.name);
                });

                global.main.app.root.addChild(instance);

                for(let i = 0; i < instance.children.length; i++)
                {
                    console.log("Child", i, ":", instance.children[i].name);
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