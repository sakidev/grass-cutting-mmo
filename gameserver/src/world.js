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

        this.floor = new pc.Entity("floor");
        this.floor.addComponent("collision", {
            type: "box",
            halfExtents: new pc.Vec3(10, 0.001, 10),
        });
        this.floor.addComponent("rigidbody", {
            type: "static",
            friction: 0,
            restitution: 0
        });
        global.main.app.root.addChild(this.floor);
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

    update(dt)
    {
        //console.log("World update called with dt:", dt);

        // Update all players
        global.main.network.player.update(dt);
    }
}

module.exports = World;