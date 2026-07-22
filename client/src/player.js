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

        this.isMine = client.mPlayerId === this.id;

        if(this.isMine)
        {
            this.syncRate = 25;
            this.lastSyncDate = new Date();
        }

        this.movementVec = new pc.Vec3(0, 0, 0);
        this.movementSpeed = 5;

        console.log("Creating player with id:", this.id, "isMine:", this.isMine);

        Player.LIST.push(this);

        SCRIPTS_TO_UPDATE.push(this);
    }

    spawn(position)
    {
        if(this.entity)
        {
            this.entity.enabled = true;
            return;
        }

        this.entity = new pc.Entity("player_" + this.id);
        this.entity.player = this;
        this.entity.addComponent("render", {
            type: "sphere",
            radius: 0.5
        });

        if(this.isMine)
        {
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
        }

        this.entity.setPosition(
            position[0],
            position[1],
            position[2]
        );
        game.root.addChild(this.entity);
    }

    despawn()
    {
        if(!this.entity) return;

        this.entity.enabled = false;
    }

    sync(position, eulers)
    {
        this.position = position;
        //this.eulers = eulers;

        if(!this.entity) return;
        if(this.isMine) return;
        
        this.entity.setPosition(
            this.position[0],
            this.position[1],
            this.position[2]
        );
        /*
        this.entity.setEulerAngles(
            this.eulers[0],
            this.eulers[1],
            this.eulers[2]
        );*/
    }

    local()
    {
        if(!this.entity.rigidbody) return;

        this.movementVec.set(0, 0, 0);

        if(game.keyboard.isPressed(pc.KEY_W)) this.movementVec.z -= 1;
        if(game.keyboard.isPressed(pc.KEY_A)) this.movementVec.x -= 1;
        if(game.keyboard.isPressed(pc.KEY_S)) this.movementVec.z += 1;
        if(game.keyboard.isPressed(pc.KEY_D)) this.movementVec.x += 1;

        this.movementVec.normalize().scale(this.movementSpeed);

        this.entity.rigidbody.linearVelocity = this.movementVec;

        const now = new Date();
        if(now - this.lastSyncDate >= this.syncRate)
        {
            this.lastSyncDate = now;

            client.sendLocalSnapshot(
                this.entity.getPosition(),
                this.entity.getEulerAngles()
            );
        }
    }

    remote()
    {

    }

    update()
    {
        if(this.isMine) this.local();
        else this.remote();
    }
}