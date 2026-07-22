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

    const floor = new pc.Entity("floor");
    const floorMaterial = new pc.StandardMaterial();
    floorMaterial.diffuse = new pc.Color(0.5, 0.5, 0.5);
    floorMaterial.update();
    floor.addComponent("render", {
        type: "plane",
        castShadows: false,
        receiveShadows: false,
        material: floorMaterial,
    });
    floor.addComponent("collision", {
        type: "box",
        halfExtents: new pc.Vec3(5, 0.01, 5),
    });
    floor.addComponent("rigidbody", {
        type: "static",
        friction: 0,
        restitution: 0
    });
    floor.setLocalScale(10, 1, 10);
    game.root.addChild(floor);
}