const TerrainFragmentShaderGLSL = `
uniform sampler2D uBlendTex;
uniform sampler2D uTexOne;    // grass (default / flat)
uniform sampler2D uTexTwo;    // rock (inclined + red channel)
uniform sampler2D uTexThree;  // green channel
uniform sampler2D uTexFour;   // blue channel
uniform sampler2D uTexFive;   // white channel

uniform float uSlopeThreshold;
uniform float uSlopeBlend;
uniform float uTiling;

void getAlbedo(){
    vec2 tiledUv = vUv0 * uTiling;

    vec4 t1 = texture2D(uTexOne,   tiledUv);
    vec4 t2 = texture2D(uTexTwo,   tiledUv);
    vec4 t3 = texture2D(uTexThree, tiledUv);
    vec4 t4 = texture2D(uTexFour,  tiledUv);
    vec4 t5 = texture2D(uTexFive,  tiledUv);

    // Slope-based blend: flat = grass, steep = rock
    float slope = dot(normalize(vNormalW), vec3(0.0, 1.0, 0.0));
    float rockFactor = 1.0 - smoothstep(uSlopeThreshold - uSlopeBlend, uSlopeThreshold + uSlopeBlend, slope);

    // Start with slope-driven base
    vec3 color = mix(t1.rgb, t2.rgb, rockFactor);

    // Blend map overrides — R, G, B channels paint textures on top
    vec4 blend = texture2D(uBlendTex, vUv0);

    float whiteFactor = min(blend.r, min(blend.g, blend.b));

    float used = blend.r + blend.g + blend.b;

    // If blend map has paint, it overrides the slope blend
    if(used > 0.01){
        // Normalize weights so they sum to 1, with leftover going to slope base
        float base = max(1.0 - used, 0.0);
        color = color * base
              + t2.rgb * blend.r
              + t3.rgb * blend.g
              + t4.rgb * blend.b;
    }

    color = mix(color, t5.rgb, whiteFactor);

    dAlbedo = color;
}`;

const TerrainFragmentShaderWGSL = `
var uBlendTex: texture_2d<f32>;
var uBlendTexSampler: sampler;
var uTexOne: texture_2d<f32>;
var uTexOneSampler: sampler;
var uTexTwo: texture_2d<f32>;
var uTexTwoSampler: sampler;
var uTexThree: texture_2d<f32>;
var uTexThreeSampler: sampler;
var uTexFour: texture_2d<f32>;
var uTexFourSampler: sampler;
var uTexFive: texture_2d<f32>;
var uTexFiveSampler: sampler;

uniform uSlopeThreshold: f32;
uniform uSlopeBlend: f32;
uniform uTiling: f32;

fn getAlbedo() {
    let tiledUv: vec2f = vUv0 * uniform.uTiling;

    let t1: vec4f = textureSample(uTexOne, uTexOneSampler, tiledUv);
    let t2: vec4f = textureSample(uTexTwo, uTexTwoSampler, tiledUv);
    let t3: vec4f = textureSample(uTexThree, uTexThreeSampler, tiledUv);
    let t4: vec4f = textureSample(uTexFour, uTexFourSampler, tiledUv);
    let t5: vec4f = textureSample(uTexFive, uTexFiveSampler, tiledUv);
    let slope: f32 = dot(normalize(vNormalW), vec3f(0.0, 1.0, 0.0));
    let rockFactor: f32 = 1.0 - smoothstep(uniform.uSlopeThreshold - uniform.uSlopeBlend, uniform.uSlopeThreshold + uniform.uSlopeBlend, slope);

    var color: vec3f = mix(t1.rgb, t2.rgb, rockFactor);

    let blend: vec4f = textureSample(uBlendTex, uBlendTexSampler, vUv0);

    let whiteFactor: f32 = min(blend.r, min(blend.g, blend.b));

    let used: f32 = blend.r + blend.g + blend.b;

    if (used > 0.01) {
        let base: f32 = max(1.0 - used, 0.0);
        color = color * base
              + t2.rgb * blend.r
              + t3.rgb * blend.g
              + t4.rgb * blend.b;
    }

    color = mix(color, t5.rgb, whiteFactor);

    dAlbedo = color;
}
`;

class TerrainMaterial {
    static TERRAIN_MATERIAL = null;
    static async buildMaterial()
    {
        const promise = new Promise(async (resolve)=>{
            const material = new pc.StandardMaterial();
    
            let blendTex, grassTex, dirtTex, whiteTex;
    
            await loader.loadTexture("res/textures/terrain1BlendTex.png", "TerrainBlendTexture", (texture)=> {
                blendTex = texture;
            });
            await loader.loadTexture("res/textures/terrain_grass_moist.png", "TerrainGrassTexture", (texture)=> {
                grassTex = texture;
            });
            await loader.loadTexture("res/textures/terrain_dirt_moist.png", "TerrainDirtTexture", (texture)=> {
                dirtTex = texture;
            });

            whiteTex = grassTex; // Just reuse grass texture rn
    
            if(!game.graphicsDevice.isWebGPU)
            {
                const chunks = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
                chunks.set("diffusePS", TerrainFragmentShaderGLSL);
            }
            else
            {
                const chunks = material.getShaderChunks(pc.SHADERLANGUAGE_WGSL);
                chunks.set("diffusePS", TerrainFragmentShaderWGSL);
            }

            material.diffuseMap = blendTex;
        
            // Set up uniforms with default values
            material.setParameter("uBlendTex", blendTex);
            material.setParameter("uTexOne", grassTex);
            material.setParameter("uTexTwo", dirtTex);
            material.setParameter("uTexThree", dirtTex);
            material.setParameter("uTexFour", dirtTex);
            material.setParameter("uTexFive", whiteTex);
            material.setParameter("uSlopeThreshold", 0.95);
            material.setParameter("uSlopeBlend", 0.05);
            material.setParameter("uTiling", 100.0);
        
            //material.update();
    
            TerrainMaterial.TERRAIN_MATERIAL = material;
            
            resolve(true);
        });
        return await promise;
    }

    constructor(terrainTile)
    {
        this.isWebGPU = game.graphicsDevice.isWebGPU;
        this.terrainTile = terrainTile;
        this.setup();
    }

    async setup()
    {
        const self = this;

        
        if(TerrainMaterial.TERRAIN_MATERIAL)
        {
            console.log("material exists");

            // Find the terrain tile because the terrain tiles also contain objects in them
            this.terrainTile.children.forEach((child)=>{
                if(child.name.includes("tile_"))
                {
                    self.terrainTile = child;
                }
            });

            this.terrainTile.render.meshInstances[0].material = TerrainMaterial.TERRAIN_MATERIAL;
            this.terrainTile.material = TerrainMaterial.TERRAIN_MATERIAL;
        }
        else
        {
            console.log("material doesn't exist");
        }
    }
}

const curvatureTransformVertexShaderGLSL = `
    uniform vec3 uCameraWorldPos;
    uniform float uCurvatureStrength;
    uniform float uCurvatureExp;
    
    #ifdef PIXELSNAP
        uniform vec4 uScreenSize;
    #endif
    #ifdef SCREENSPACE
        uniform float projectionFlipY;
    #endif
    
    vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
        vec3 localPos = getLocalPosition(vertexPosition);

        vec4 posW = dModelMatrix * vec4(localPos, 1.0);

        #ifdef SCREENSPACE
            posW.zw = vec2(0.0, 1.0);
        #endif

        vec2 delta = posW.xz - uCameraWorldPos.xz;
        float dist = length(delta);
        posW.y -= uCurvatureStrength * pow(dist, uCurvatureExp);

        return posW;
    }
    
    vec4 getPosition() {
        dModelMatrix = getModelMatrix();
    
        vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
    
        // dPositionW is read by lighting, fog, and shadow chunks
        dPositionW = posW.xyz;
    
        vec4 screenPos;
        #ifdef UV1LAYOUT
            screenPos = vec4(vertex_texCoord1.xy * 2.0 - 1.0, 0.5, 1.0);
            #ifdef WEBGPU
                screenPos.y *= -1.0;
            #endif
        #else
            #ifdef SCREENSPACE
                screenPos = posW;
                screenPos.y *= projectionFlipY;
            #else
                screenPos = matrix_viewProjection * posW;
            #endif
            #ifdef PIXELSNAP
                screenPos.xy = (screenPos.xy * 0.5) + 0.5;
                screenPos.xy *= uScreenSize.xy;
                screenPos.xy = floor(screenPos.xy);
                screenPos.xy *= uScreenSize.zw;
                screenPos.xy = (screenPos.xy * 2.0) - 1.0;
            #endif
        #endif
    
        return screenPos;
    }
    
    vec3 getWorldPosition() {
        return dPositionW;
    }
`;

const curvatureTransformVertexShaderWGSL = `
    uniform uCameraWorldPos: vec3f;
    uniform uCurvatureStrength: f32;
    uniform uCurvatureExp: f32;

    #ifdef PIXELSNAP
        uniform uScreenSize: vec4f;
    #endif
    #ifdef SCREENSPACE
        uniform projectionFlipY: f32;
    #endif

    fn evalWorldPosition(vertexPosition: vec3f, modelMatrix: mat4x4f) -> vec4f {
        let localPos: vec3f = getLocalPosition(vertexPosition);

        var posW: vec4f = dModelMatrix * vec4f(localPos, 1.0);

        #ifdef SCREENSPACE
            posW = vec4f(posW.x, posW.y, 0.0, 1.0);
        #endif

        let delta: vec2f = posW.xz - uniform.uCameraWorldPos.xz;
        let dist: f32 = length(delta);
        posW.y = posW.y - uniform.uCurvatureStrength * pow(dist, uniform.uCurvatureExp);

        return posW;
    }

    fn getPosition() -> vec4f {

        dModelMatrix = getModelMatrix();

        let posW: vec4f = evalWorldPosition(vertex_position.xyz, dModelMatrix);
        dPositionW = posW.xyz;

        var screenPos: vec4f;
        #ifdef UV1LAYOUT
            screenPos = vec4f(vertex_texCoord1.xy * 2.0 - 1.0, 0.5, 1.0);
            screenPos.y *= -1.0;
        #else
            #ifdef SCREENSPACE
                screenPos = posW;
                screenPos.y *= uniform.projectionFlipY;
            #else
                screenPos = uniform.matrix_viewProjection * posW;
            #endif

            #ifdef PIXELSNAP
                // snap vertex to a pixel boundary
                screenPos.xy = (screenPos.xy * 0.5) + 0.5;
                screenPos.xy *= uniforms.uScreenSize.xy;
                screenPos.xy = floor(screenPos.xy);
                screenPos.xy *= uniforms.uScreenSize.zw;
                screenPos.xy = (screenPos.xy * 2.0) - 1.0;
            #endif
        #endif

        return screenPos;
    }

    fn getWorldPosition() -> vec3f {
        return dPositionW;
    }
`;

let curvatureStrength   = 0.01;
let curvatureExp        = 2.0;
let farDistance         = 80.0;

function injectCurvatureMaterial(originalMaterial)
{
    //console.log(">>> injecting...", originalMaterial);
    const mat = originalMaterial;

    if(!game.graphicsDevice.isWebGPU)
    {
        mat.shaderChunks.transformVS = curvatureTransformVertexShaderGLSL;
    }
    else
    {
        //mat.chunks.transformVS = curvatureTransformVertexShaderWGSL;
        const chunks = mat.getShaderChunks(pc.SHADERLANGUAGE_WGSL);
        chunks.set("transformVS", curvatureTransformVertexShaderWGSL);
    }

    mat.setParameter('uCurvatureStrength', curvatureStrength);
    mat.setParameter('uCurvatureExp', curvatureExp);
    //mat.setParameter('uCameraWorldPos', [0, 0, 0]);
    mat.update();

    CURVATURE_MATERIALS.push(mat);

    return mat;
}

function installGlobalCurvatureShader(graphicsDevice)
{
    if(!game.graphicsDevice.isWebGPU)
        pc.ShaderChunks.get(graphicsDevice, pc.SHADERLANGUAGE_GLSL).set("transformVS", curvatureTransformVertexShaderGLSL);
    else
        pc.ShaderChunks.get(graphicsDevice, pc.SHADERLANGUAGE_WGSL).set("transformVS", curvatureTransformVertexShaderWGSL);

    console.log("Patched global transformVS shader with curvature shader");
}

function installParticleCurvature(graphicsDevice) {
    //if (graphicsDevice.isWebGPU) return; // handle separately if needed

    /*const original = pc.shaderChunks.particle_endVS;
    if (!original) {
        console.error('particle_endVS chunk not found');
        return;
    }*/

    
    let newChunk;
    
    if(!game.graphicsDevice.isWebGPU)
    {
        newChunk = `
            localPos *= particle_vertexData2.y * emitterScale;
            localPos += particlePos;
    
            vec2 delta = localPos.xz - uCameraWorldPos.xz;
            float dist = length(delta);
            localPos.y -= uCurvatureStrength * pow(dist, uCurvatureExp);
    
            #ifdef SCREEN_SPACE
                gl_Position = vec4(localPos.x, localPos.y, 0.0, 1.0);
            #else
                gl_Position = matrix_viewProjection * vec4(localPos, 1.0);
            #endif
        `;
    }
    else
    {
        newChunk = `
            localPos = localPos * input.particle_vertexData2.y * uniform.emitterScale;
            localPos = localPos + particlePos;

            let delta = localPos.xz - uniform.uCameraWorldPos.xz;
            let dist = length(delta);
            localPos.y -= uniform.uCurvatureStrength * pow(dist, uniform.uCurvatureExp);

            #ifdef SCREEN_SPACE
                output.position = vec4f(localPos.x, localPos.y, 0.0, 1.0);
            #else
                output.position = uniform.matrix_viewProjection * vec4f(localPos, 1.0);
            #endif
        `;
    }

    if(!game.graphicsDevice.isWebGPU)
        pc.shaderChunks.particle_cpu_endVS = newChunk;
    else
        pc.ShaderChunks.get(graphicsDevice, pc.SHADERLANGUAGE_WGSL).set("particle_cpu_endVS", newChunk);

    console.log('Patched particle_endVS with curvature shader');
}

function updateCurvatureUniforms(camera, graphicsDevice)
{
    const scope = graphicsDevice.scope;
    const camPos = camera.getPosition();

    scope.resolve("uCameraWorldPos").setValue([camPos.x, camPos.y, camPos.z]);
    scope.resolve("uCurvatureStrength").setValue(curvatureStrength);
    scope.resolve("uCurvatureExp").setValue(curvatureExp);
}

const CURVATURE_MATERIALS = [];
function updateShaders(referenceEntity)
{
    for(let i = 0; i < CURVATURE_MATERIALS.length; i++)
    {
        const mat = CURVATURE_MATERIALS[i];
        //console.log("updating curvature shader for ", mat.name);
        mat.setParameter('uCameraWorldPos',
            [
                referenceEntity.getPosition().x,
                referenceEntity.getPosition().y,
                referenceEntity.getPosition().z
            ]
        );
        mat.update();
    }
}

export { TerrainMaterial, injectCurvatureMaterial, updateShaders };