class Player
{
    static LIST = [];
    static getPlayerById(id)
    {
        const player = Player.LIST.find((p) => p && p.id === id);
        return player || null;
    }

    constructor(id, position)
    {
        this.id = id;
        this.position = position;
        this.eulers = [0, 0, 0];

        this.isMine = client.mPlayerId === this.id;

        this.tempQuat = new pc.Quat();

        if(this.isMine)
        {
            client.mPlayer = this;

            this.syncRate = 25;
            this.lastSyncDate = new Date();

            this.latestFacingAngle = 0;
            this.latestFacingEulers = new pc.Vec3();
            this.latestFacingQuat = new pc.Quat();
        }
        else
        {
            this.remotePos = new pc.Vec3();
            this.remotePosLerped = new pc.Vec3();
            this.remoteEulers = new pc.Vec3();
            this.remoteQuaternion = new pc.Quat();
            this.remoteQuaternionLerped = new pc.Quat();
        }

        this.tempVec = new pc.Vec3();
        this.tempVec2 = new pc.Vec3();

        this.gravity = 0;

        this.movementVec = new pc.Vec3(0, 0, 0);
        this.movementSpeed = 5;

        this.bladeRotation = 0;
        this.bladeRotationSpeed = 5;
        this.bladeMaxRotationSpeed = 10;

        this.grounded = false;
        this.groundDistance = 0;

        this.snapDistance = 1;
        this.snapStiffness = 10;
        this.groundDistance = Infinity;

        this.shadowRotationQuat = new pc.Quat();
        this.shadowRotationMatrix = new pc.Mat4();

        this.addedVelocity = new pc.Vec3();

        console.log("Creating player with id:", this.id, "isMine:", this.isMine);

        Player.LIST.push(this);

        SCRIPTS_TO_UPDATE.push(this);
    }

    spawn(position)
    {
        if(this.entity)
        {
            this.entity.enabled = true;

            if(this.isMine)
            {
                camera.controller.setTarget(this.entity);
            }

            return;
        }

        this.entity = new pc.Entity("player_" + this.id);
        this.entity.player = this;

        this.modelHolder = new pc.Entity("modelHolder_" + this.id);
        /*this.modelHolder.addComponent("render", {
            type: "sphere",
            radius: 0.5
        });*/
        const playerPrefab = PREFABS.find((p) => p.name === "player").entity.clone();
        playerPrefab.setLocalScale(0.35, 0.35, 0.35);
        this.modelHolder.addChild(playerPrefab);
        this.bladesHolder = new pc.Entity("bladesHolder_" + this.id);
        playerPrefab.addChild(this.bladesHolder);
        playerPrefab.findByName("Blade").reparent(this.bladesHolder);

        const shadowPrefab = PREFABS.find((p) => p.name === "blob_shadow").entity.clone();
        this.shadow = shadowPrefab;
        this.entity.addChild(shadowPrefab);
        
        this.entity.addChild(this.modelHolder);

        this.entity.addComponent("collision", {
            type: "sphere",
            radius: 0.5
        });
        this.entity.addComponent("rigidbody", {
            type: "dynamic",
            mass: 1,
            linearDamping: 0,
            angularDamping: 0,
            angularFactor: new pc.Vec3(0, 0, 0),
            friction: 0,
            restitution: 0,
        });

        if(this.isMine)
        {
            this.entity.collision.on("collisionstart", (result) => {
                //console.log("Player", this.id, "collided with", result.other.name);
    
                if(result.other.player && result.other.player !== this)
                {
                    //if(!result.other.player.isMine) return;

                    console.log("Player", this.id, "collided with another player:", result.other.player.id);

                    tempVec.copy(this.entity.getPosition());
                    tempVec.sub(result.other.getPosition()).normalize().scale(7);
                    tempVec.y = this.entity.getPosition().y;
                    this.addedVelocity.add(tempVec);
                }
            });
        }

        this.entity.setPosition(
            position[0],
            position[1],
            position[2]
        );
        game.root.addChild(this.entity);

        if(this.isMine)
        {
            camera.setTarget(this.entity);
        }
    }

    despawn()
    {
        if(!this.entity) return;

        this.entity.enabled = false;
    }

    sync(position, eulers, bladeRotSpeed)
    {
        this.position = position;
        this.eulers = eulers;
        this.bladeRotation = bladeRotSpeed;

        if(!this.entity) return;
        if(this.isMine) return;
    }

    isGrounded()
    {
        this.tempVec.copy(this.entity.getPosition());
        this.tempVec2.copy(pc.Vec3.UP).scale(-1.2).add(this.entity.getPosition());

        const result = game.systems.rigidbody.raycastFirst(this.tempVec, this.tempVec2);
        if (!result || !result.entity.name.includes("tile")) {
            this.groundDistance = Infinity;
            return false;
        }

        this.groundDistance = result.point.distance(this.entity.getPosition());

        this.tempVec.copy(result.normal).scale(0.25).add(result.point);
        if(this.shadow)
        {
            this.shadow.setPosition(this.tempVec);
            
            const axis = this.tempVec.cross(result.normal, pc.Vec3.RIGHT);
            this.shadowRotationQuat.set(0, 0, 0, 0);
            setMat4Up(
                this.shadowRotationMatrix,
                axis,
                result.normal
            );
            this.shadowRotationQuat.setFromMat4(this.shadowRotationMatrix);
            this.shadow.setRotation(this.shadowRotationQuat);
        }

        return this.groundDistance <= this.snapDistance; // e.g. 0.75
    }

    local(dt)
    {
        if (!this.entity.rigidbody) return;

        if (!this.grounded) {
            this.gravity += 9.81 * 2 * dt;
        }
        else {
            const target = 0.6;
            const error = this.groundDistance - target; // >0 = floating, <0 = sunk

            // gravity is positive-down here, matching your accumulator
            this.gravity = error * this.snapStiffness; // e.g. 10
            this.gravity = pc.math.clamp(this.gravity, -3, 3);

            if (Math.abs(error) < 0.005) this.gravity = 0;
        }

        this.addedVelocity.mulScalar(0.92);

        // Calculate & apply movement
        this.movementVec.set(0, 0, 0);
        this.latestFacingEulers.set(0, 0, 0);

        let isMoving = false;

        if(game.keyboard.isPressed(pc.KEY_W)
        || game.keyboard.isPressed(pc.KEY_UP))
        {
            this.movementVec.z -= 1;
            this.latestFacingEulers.x = -15;
            isMoving = true;
        }
        if(game.keyboard.isPressed(pc.KEY_A)
        || game.keyboard.isPressed(pc.KEY_LEFT))
        {
            this.movementVec.x -= 1;
            this.latestFacingEulers.z = 15;
            isMoving = true;
        }
        if(game.keyboard.isPressed(pc.KEY_S)
        || game.keyboard.isPressed(pc.KEY_DOWN))
        {
            this.movementVec.z += 1;
            this.latestFacingEulers.x = 15;
            isMoving = true;
        }
        if(game.keyboard.isPressed(pc.KEY_D)
        || game.keyboard.isPressed(pc.KEY_RIGHT))
        {
            this.movementVec.x += 1;
            this.latestFacingEulers.z = -15;
            isMoving = true;
        }

        this.movementVec.normalize().scale(this.movementSpeed);
        this.movementVec.add(this.addedVelocity);
        this.movementVec.y = -this.gravity;

        this.entity.rigidbody.linearVelocity = this.movementVec;

        /*// If we're moving, calculate the facing angle and apply it to the model holder
        if(this.movementVec.length() > 0.01)
        {
            const angle = Math.atan2(this.movementVec.x, this.movementVec.z) * pc.math.RAD_TO_DEG + 180;
            this.latestFacingAngle = angle;
        }*/

        this.latestFacingQuat.slerp(
            this.latestFacingQuat,
            this.tempQuat.setFromEulerAngles(this.latestFacingEulers),
            5 * dt
        );

        this.modelHolder.setRotation(this.latestFacingQuat);

        // Locally animate blade rotation speed
        if(isMoving)
        {
            this.bladeRotation += 14.5 * 0.016;
            if(this.bladeRotation > this.bladeMaxRotationSpeed)
                this.bladeRotation = this.bladeMaxRotationSpeed;
        }
        else
        {
            this.bladeRotation -= 5 * 0.016;
            if(this.bladeRotation < 5)
            {
                this.bladeRotation = 5;
            }
        }

        // Send out local snapshots to the game server
        const now = new Date();
        if(now - this.lastSyncDate >= this.syncRate)
        {
            this.lastSyncDate = now;

            client.sendLocalSnapshot(
                this.entity.getPosition(),
                this.modelHolder.getEulerAngles(),
                this.bladeRotation
            );

            // Try to cut grass if we're inside a patch
            /*const hits = [];
            const query = Grass.queryRadiusAll(
                this.entity.getPosition().x,
                this.entity.getPosition().z,
                1,
                hits
            );

            for(let i = 0; i < hits.length; i++)
            {
                const hit = hits[i];
                // per-blade info available here: h.x, h.y, h.z, h.distSq
                hit.patch.removeBlade(hit.index);
            }*/
        }
    }

    remote(dt)
    {
        this.remotePos.set(this.position[0], this.position[1], this.position[2]);
        this.remotePosLerped.lerp(this.remotePosLerped, this.remotePos, 15 * 0.016);
        this.remoteQuaternion.setFromEulerAngles(this.eulers[0], this.eulers[1], this.eulers[2]);
        this.remoteQuaternionLerped.slerp(
            this.remoteQuaternionLerped,
            this.remoteQuaternion,
            15 * 0.016
        );

        if(this.remotePosLerped.distance(this.remotePos) > 5)
            this.remotePosLerped.copy(this.remotePos);

        if(!this.entity) return;

        this.entity.rigidbody.teleport(this.remotePosLerped, this.remoteQuaternionLerped);

        if(this.entity.rigidbody)
            this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
    }

    update(dt)
    {
        this.grounded = this.isGrounded();

        if(this.isMine) this.local(dt);
        else this.remote(dt);


        // Animate the blade holder
        if(this.bladesHolder)
        {
            this.bladesHolder.rotateLocal(0, -this.bladeRotation, 0);
        }
    }
}