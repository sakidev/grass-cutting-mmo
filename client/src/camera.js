class Camera
{
    constructor()
    {
        this.entity = new pc.Entity("camera");
        this.entity.addComponent("camera", {
            clearColor: new pc.Color(0.25, 0.5, 0.5),
            farClip: 1000,
            nearClip: 0.1,
        });

        this.entity.rotateLocal(-45, 0, 0);

        this.entity.setPosition(0, 10, 10);
        game.root.addChild(this.entity);

        this.target = null;
        this.targetFollowVec = new pc.Vec3();
        this.targetFollowLerpedVec = new pc.Vec3();

        this.zoom = 10;
        this.zoomLerped = 0;

        game.mouse.on(pc.EVENT_MOUSEWHEEL, (event)=>{
            this.zoom -= event.wheel;
            if(this.zoom < 1) this.zoom = 1;
        }, this);

        SCRIPTS_TO_UPDATE.push(this);
    }

    setTarget(entity)
    {
        this.target = entity;
    }

    update(dt)
    {
        if(!this.target) return;

        this.zoomLerped = pc.math.lerp(this.zoomLerped, this.zoom, 15 * dt);

        this.targetFollowVec.copy(this.entity.forward).scale(-this.zoomLerped).add(this.target.getPosition());
        this.targetFollowLerpedVec.lerp(this.targetFollowLerpedVec, this.targetFollowVec, 2.5 * 0.016);

        this.entity.setPosition(
            this.targetFollowLerpedVec.x,
            this.targetFollowLerpedVec.y,
            this.targetFollowLerpedVec.z
        );
    }

    postUpdate(dt)
    {

    }
}

export { Camera }