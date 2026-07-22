let STATIC_SOUNDS = null;

function setupStaticSounds()
{
    STATIC_SOUNDS = new pc.Entity("_STATIC_SOUNDS");
    STATIC_SOUNDS.addComponent("sound", {
        positional: false
    });
    utils.initSoundForEntity(STATIC_SOUNDS);
    game.root.addChild(STATIC_SOUNDS);
}