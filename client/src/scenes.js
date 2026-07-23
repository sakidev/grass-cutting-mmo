async function setupScene()
{
    // We don't have a sun, so make the ambient light as clear as absolutely possible
    game.scene.ambientLight = new pc.Color(0.5, 0.5, 0.5);

    const light = new pc.Entity("Light");
    light.addComponent("light", {
        type: "directional",
        color: new pc.Color(1, 1, 1),
        intensity: 1,
        castShadows: false,
    });
    light.setEulerAngles(42, 0, 0);
    light.setPosition(0, 0, 0);
    game.root.addChild(light);
}