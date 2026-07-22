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

        SCRIPTS_TO_UPDATE.push(this);
    }

    update(dt)
    {
        
    }

    postUpdate(dt)
    {

    }
}

export { Camera }