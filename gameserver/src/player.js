const { PacketHeader, IncomingPacket, OutgoingPacket } = require("./packet.js");
const pc = require("./playcanvas.js");
const Grass = require('./grass.js');
const constants = require('./constants.js');

class Player
{
    static SYNC_RATE = 40;

    static LIST = new Array(100).fill(null);
    static getFreeSlot()
    {
        const index = Player.LIST.findIndex((p) => p === null);
        if(index === -1) return null;
        return index;
    }
    static freeupSlot(index)
    {
        if(index < 0 || index >= Player.LIST.length) return;
        Player.LIST[index] = null;
    }

    static getPlayerById(id)
    {
        const player = Player.LIST.find((p) => p && p.id === id);
        return player || null;
    }

    static update(dt)
    {
        for (let i = 0; i < Player.LIST.length; i++) {
            const player = Player.LIST[i];
            if (!player) continue;

            player.onUpdate(dt);
        }
    }

    constructor(ws)
    {
        const self = this;

        this.ws = ws;

        this.id = Player.getFreeSlot();
        Player.LIST[this.id] = this;

        this.tempVec = new pc.Vec3();

        this.position = new pc.Vec3();
        this.eulers = new pc.Vec3();
        this.bladeRotationSpeed = 0;

        this.name = "Player " + this.id;
        this.lastPingDate = null;
        this.latency = 100;
        this.startPingLoop();

        this.awareOfEntities = [];
        this.insideOfGrassPatches = [];

        console.log("Player created with id:", this.id, "name:", this.name);

        // Send over this player's id
        const pkt = new OutgoingPacket(PacketHeader.GameServer.YOUR_ID, 1 + 4);
        pkt.WriteInt(this.id);
        try{ this.ws.send(pkt.buffer, true); }catch(err){ }

        setTimeout(()=>
        {
            self.spawn();
        }, 1_500);
    }

    addInsideGrassPatch(patch)
    {
        if(this.insideOfGrassPatches.includes(patch)) return;
        this.insideOfGrassPatches.push(patch);
    }

    removeInsideGrassPatch(patch)
    {
        const index = this.insideOfGrassPatches.indexOf(patch);
        if(index === -1) return;
        this.insideOfGrassPatches.splice(index, 1);
    }

    sortInsideGrassPatchesByDistance()
    {
        let closestPatch = null;
        let closestDistance = Infinity;

        for(let i = 0; i < this.insideOfGrassPatches.length; i++)
        {
            const patch = this.insideOfGrassPatches[i];
            this.tempVec.set(patch.centerX, this.position.y, patch.centerZ);
            const distance = this.position.distance(this.tempVec);
            if(distance < closestDistance)
            {
                closestDistance = distance;
                closestPatch = patch;
            }
        }

        this.insideOfGrassPatches.sort((a, b) => {
            this.tempVec.set(a.centerX, this.position.y, a.centerZ);
            const distanceA = this.position.distance(this.tempVec);
            this.tempVec.set(b.centerX, this.position.y, b.centerZ);
            const distanceB = this.position.distance(this.tempVec);
            return distanceA - distanceB;
        });
    }

    startPingLoop()
    {
        const self = this;

        this.pingInterval = setInterval(() => {
            if (!self.ws) return;

            self.lastPingDate = Date.now();

            const pkt = new OutgoingPacket(PacketHeader.Common.PING, 1 + 1);
            pkt.WriteByte(self.latency);
            try{ self.ws.send(pkt.buffer, true); }catch(err){ }
        }, 1_000);
    }

    onPing()
    {
        const diff = Date.now() - this.lastPingDate;
        this.latency = diff;
        this.lastPingDate = Date.now();

        console.log("Player", this.id, "ping:", this.latency + "ms");
    }

    spawn()
    {
        this.entity = new pc.Entity("player_" + this.id);
        this.entity.player = this;
        this.entity.addComponent("collision", {
            type: "sphere",
            radius: 0.5
        });
        this.entity.addComponent("rigidbody", {
            type: "dynamic",
            mass: 1,
            linearDamping: 0.1,
            angularDamping: 0,
            friction: 0,
            restitution: 0.1,
        });
        this.awarenessBubble = new pc.Entity("awarenessBubble_" + this.id);
        this.awarenessBubble.addComponent("collision", {
            type: "sphere",
            radius: 5,
        });
        this.awarenessBubble.collision.on("triggerenter", (otherEntity)=>{
            console.log("Player", this.id, "entered awareness bubble of", otherEntity.name);

            if(otherEntity.player)
            {
                this.onAwarenessGained(otherEntity);
            }
        });
        this.awarenessBubble.collision.on("triggerleave", (otherEntity)=>{
            console.log("Player", this.id, "left awareness bubble of", otherEntity.name);

            if(otherEntity.player)
            {
                this.onAwarenessLost(otherEntity);
            }
        });
        this.entity.setPosition(0, 1, 0);
        global.main.app.root.addChild(this.entity);
        global.main.app.root.addChild(this.awarenessBubble);
    }

    onAwarenessGained(actor)
    {
        if(this.awareOfEntities.includes(actor)) return;

        this.awareOfEntities.push(actor);

        const pkt = new OutgoingPacket(PacketHeader.GameServer.ON_AWARENESS_GAINED, 1 + 4 + (4*3));
        pkt.WriteInt(actor.player.id);
        pkt.WriteFloat(actor.getPosition().x);
        pkt.WriteFloat(actor.getPosition().y);
        pkt.WriteFloat(actor.getPosition().z);
        try{ this.ws.send(pkt.buffer, true); }catch(err){
            console.log("Error sending awareness gained packet to player", this.id, ":", err);
         }
    }

    onAwarenessLost(actor)
    {
        const index = this.awareOfEntities.indexOf(actor);
        if(index === -1) return;

        this.awareOfEntities.splice(index, 1);

        const pkt = new OutgoingPacket(PacketHeader.GameServer.ON_AWARENESS_LOST, 1 + 4);
        pkt.WriteInt(actor.player.id);
        try{ this.ws.send(pkt.buffer, true); }catch(err){ }
    }

    onUpdate(dt)
    {
        if(!this.entity) return;

        this.awarenessBubble.setPosition(this.position);
        this.entity.rigidbody.teleport(
            this.position.x,
            this.position.y,
            this.position.z
        );
        this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
    }

    onLocalSnapshot(pos, eulers, bladeRotSpeed)
    {
        if(!this.entity) return;

        this.position.set(pos[0], pos[1], pos[2]);
        this.eulers.set(eulers[0], eulers[1], eulers[2]);
        this.bladeRotationSpeed = bladeRotSpeed;

        for(let i = 0; i < this.insideOfGrassPatches.length; i++)
        {
            const patch = this.insideOfGrassPatches[i];
            if(patch)
            {
                // Make cuts
                this.tempVec.set(this.position.x, this.position.y, this.position.z);
                const indexesCut = [];
                const cutBlades = patch.originalPatch.cutRadius(this.tempVec.x, this.tempVec.z, 1, indexesCut);
                patch.cutBits = patch.originalPatch.cutBits;

                if(cutBlades > 0)
                {
                    // Broadcast the cut blades!
                    const pkt = new OutgoingPacket(
                        PacketHeader.GameServer.GRASS_EVENT,
                        1 + 4 + 4 + (indexesCut.length * 4)
                    );
                    pkt.WriteInt(constants.GRASS_PATCHES.indexOf(patch));
                    pkt.WriteInt(indexesCut.length);
                    for(let i = 0; i < indexesCut.length; i++)
                        pkt.WriteInt(indexesCut[i]);

                    console.log("Player", this.id, "cut", cutBlades, "blades in patch", constants.GRASS_PATCHES.indexOf(patch), "at position", this.tempVec.toString());
                    
                    global.main.network.broadcast(pkt);
                }
            }
        }
    }

    onDisconnect()
    {
        if(this.entity) this.entity.destroy();
        if(this.awarenessBubble) this.awarenessBubble.destroy();

        console.log("Player disconnected with id:", this.id, "name:", this.name);
        Player.freeupSlot(this.id);
    }
}

setInterval(()=>
{
    for(let i = 0; i < Player.LIST.length; i++)
    {
        const player = Player.LIST[i];
        if(!player) continue;

        let bytes = 1 + 4;
        bytes += player.awareOfEntities.length * (4 + 4*3 + 4*3 + 4);

        const pkt = new OutgoingPacket(PacketHeader.GameServer.ACTORS_SYNC, bytes);
        pkt.WriteInt(player.awareOfEntities.length);
        for(let x = 0; x < player.awareOfEntities.length; x++)
        {
            const actor = player.awareOfEntities[x];
            pkt.WriteInt(actor.player.id);
            pkt.WriteFloat(actor.getPosition().x);
            pkt.WriteFloat(actor.getPosition().y);
            pkt.WriteFloat(actor.getPosition().z);
            pkt.WriteFloat(actor.player.eulers.x);
            pkt.WriteFloat(actor.player.eulers.y);
            pkt.WriteFloat(actor.player.eulers.z);
            pkt.WriteFloat(actor.player.bladeRotationSpeed);
        }

        try{ player.ws.send(pkt.buffer, true); }catch(err){ }
    }
}, Player.SYNC_RATE);

module.exports = Player;