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

        this.movementVec = new pc.Vec3(0, 0, 0);
        this.movementSpeed = 5;

        this.bladeRotation = 0;
        this.bladeRotationSpeed = 5;
        this.bladeMaxRotationSpeed = 10;

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

    local(dt)
    {
        if(!this.entity.rigidbody) return;

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

        if(!this.entity) return;

        this.entity.rigidbody.teleport(this.remotePosLerped, this.remoteQuaternionLerped);

        if(this.entity.rigidbody)
            this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
    }

    update(dt)
    {
        if(this.isMine) this.local(dt);
        else this.remote(dt);


        // Animate the blade holder
        if(this.bladesHolder)
        {
            this.bladesHolder.rotateLocal(0, -this.bladeRotation, 0);
        }
    }
}