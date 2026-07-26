// =====================================================================
//  GRASS — matrix-instanced, mutable blade list, StandardMaterial
//
//  Works in TWO environments from this single file:
//    - Browser (PlayCanvas client): renders as before, unchanged look.
//    - Node.js headless server:     no rendering, no DOM. Uses the
//      server's PlayCanvas build for math (pc.Vec3 / pc.Quat / pc.Mat4).
//      Same paths, same filename-bounds convention, same scatter / cut /
//      blade APIs — so server blade state matches the client.
//
//  Server extras:
//    - Decoded texture pixels are CACHED per path — loading the same
//      mask twice reuses the first decode (both envs).
//    - Blade positions are kept per patch (they always were) and are
//      queryable for collisions:
//          patch.querySphere(x, y, z, radius)        -> blades in range
//          Grass.querySphereAll(x, y, z, radius)     -> across patches,
//              skipping any patch whose rectangle is farther than radius
//          patch.queryRadius(x, z, radius)           -> 2D variant
//
//  Server requires:  npm install pngjs     (masks must be PNG)
// =====================================================================

// ---------------------------------------------------------------------
//  environment detection (headless = no rendering; pc math still used)
// ---------------------------------------------------------------------
const GRASS_HEADLESS =
    (typeof window === 'undefined' || typeof document === 'undefined');

// ---------------------------------------------------------------------
//  transformVS — everything except getNormal()
//  (unused on the server; kept so the file is a single drop-in)
// ---------------------------------------------------------------------
const grassVS = `
    uniform float uTime;
    uniform float uRenderDist;
    uniform vec3  uWindDir;
    uniform float uWindStrength;
    uniform float uCollisionStrength;
    uniform float uBladeHeight;
    uniform float uTipBias;
    uniform float uTipEnabled;

    uniform vec3  uCameraWorldPos;
    uniform float uCurvatureStrength;
    uniform float uCurvatureExp;

    uniform vec4 uCollider0;
    uniform vec4 uCollider1;
    uniform vec4 uCollider2;
    uniform vec4 uCollider3;
    uniform vec4 uCollider4;
    uniform vec4 uCollider5;
    uniform vec4 uCollider6;
    uniform vec4 uCollider7;
    uniform vec4 uCollider8;
    uniform vec4 uCollider9;

    varying float vGrassHeight;
    varying float vGrassVar;
    varying float vGrassFade;
    varying float vGrassLocalY;

    #ifdef PIXELSNAP
        uniform vec4 uScreenSize;
    #endif
    #ifdef SCREENSPACE
        uniform float projectionFlipY;
    #endif

    float grassHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    vec3 grassColliderPush(vec3 base, vec4 c) {
        if (c.w <= 0.0) return vec3(0.0);
        vec3 d = base - c.xyz;
        d.y = 0.0;
        float cdist = length(d);
        if (cdist > c.w) return vec3(0.0);
        vec3 dir = cdist > 0.0001 ? d / cdist : vec3(1.0, 0.0, 0.0);
        float s = 1.0 - cdist / c.w;
        return dir * s * s;
    }

    vec3 grassTotalPush(vec3 base) {
        vec3 push = vec3(0.0);
        push += grassColliderPush(base, uCollider0);
        push += grassColliderPush(base, uCollider1);
        push += grassColliderPush(base, uCollider2);
        push += grassColliderPush(base, uCollider3);
        push += grassColliderPush(base, uCollider4);
        push += grassColliderPush(base, uCollider5);
        push += grassColliderPush(base, uCollider6);
        push += grassColliderPush(base, uCollider7);
        push += grassColliderPush(base, uCollider8);
        push += grassColliderPush(base, uCollider9);

        float pushLen = length(push);
        if (pushLen > 0.0001) return push / pushLen * min(pushLen, 1.0);
        return vec3(0.0);
    }

    vec4 evalWorldPosition(vec3 vertexPosition) {
        vec3 base = dModelMatrix[3].xyz;

        float seed = grassHash(base.xz);
        vGrassVar  = grassHash(base.xz + vec2(17.3, 41.7));

        float camDist = distance(uCameraWorldPos, base);
        vGrassFade = 1.0 - smoothstep(uRenderDist * 0.8, uRenderDist, camDist);

        float t = clamp(vertexPosition.y / max(uBladeHeight, 0.0001), 0.0, 1.0);
        vGrassHeight = t;
        vGrassLocalY = vertexPosition.y;

        // local-space: only height fade + tip bias (engine getLocalPosition, NOT ours)
        vec3 p = getLocalPosition(vertexPosition);
        p.y *= vGrassFade;
        p.y += uTipBias * uTipEnabled * t * t * vGrassFade;

        vec4 posW = dModelMatrix * vec4(p, 1.0);

        #ifdef SCREENSPACE
            posW.zw = vec2(0.0, 1.0);
        #endif

        // wind — world space, after the model transform
        float phase = seed * 6.2831;
        float wind = sin(uTime * 1.6 + base.x * 0.25 + base.z * 0.25 + phase);
        wind += 0.5 * sin(uTime * 3.1 + phase * 1.7);
        float bend = (wind * uWindStrength + 0.15) * t * t;
        posW.xz += uWindDir.xz * bend;
        posW.y  -= abs(bend) * 0.25;

        // colliders — world space
        vec3 push = grassTotalPush(base);
        float pw = t * t;
        posW.xz += push.xz * pw * uCollisionStrength;
        posW.y  -= length(push) * pw * 0.55;

        // world curvature (same formula as terrain)
        vec2 delta = posW.xz - uCameraWorldPos.xz;
        float dist = length(delta);
        posW.y -= uCurvatureStrength * pow(dist, uCurvatureExp);

        return posW;
    }

    vec4 getPosition() {
        dModelMatrix = getModelMatrix();

        vec4 posW = evalWorldPosition(vertex_position.xyz);
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

const grassFS = `
    uniform vec3  uGrassBaseColor;
    uniform vec3  uGrassTipColor;
    uniform float uColorVariance;
    uniform float uUseVertexColor;
    uniform float uVarianceSplitY;
    uniform float uVarianceLow;
    uniform float uVarianceHigh;

    varying float vGrassHeight;
    varying float vGrassVar;
    varying float vGrassFade;
    varying float vGrassLocalY;

    void getAlbedo() {
        if (vGrassFade < 0.01) discard;

        vec3 col = mix(uGrassBaseColor, uGrassTipColor, vGrassHeight);

        float varScale = mix(uVarianceLow, uVarianceHigh,
                             step(uVarianceSplitY, vGrassLocalY));
        col *= 1.0 + (vGrassVar - 0.5) * 2.0 * uColorVariance * varScale;

        #ifdef VERTEXCOLOR
            col *= mix(vec3(1.0), vVertexColor.rgb, uUseVertexColor);
        #endif

        dAlbedo = max(col, vec3(0.0));
    }
`;

const grassVS_wgsl = `
    uniform uTime: f32;
    uniform uRenderDist: f32;
    uniform uWindDir: vec3f;
    uniform uWindStrength: f32;
    uniform uCollisionStrength: f32;
    uniform uBladeHeight: f32;
    uniform uTipBias: f32;
    uniform uTipEnabled: f32;

    var<private> grassHeight_v: f32;
    var<private> grassVar_v: f32;
    var<private> grassFade_v: f32;
    var<private> grassLocalY_v: f32;

    uniform uCameraWorldPos: vec3f;
    uniform uCurvatureStrength: f32;
    uniform uCurvatureExp: f32;

    uniform uCollider0: vec4f;
    uniform uCollider1: vec4f;
    uniform uCollider2: vec4f;
    uniform uCollider3: vec4f;
    uniform uCollider4: vec4f;
    uniform uCollider5: vec4f;
    uniform uCollider6: vec4f;
    uniform uCollider7: vec4f;
    uniform uCollider8: vec4f;
    uniform uCollider9: vec4f;

    varying vGrassHeight: f32;
    varying vGrassVar: f32;
    varying vGrassFade: f32;
    varying vGrassLocalY: f32;

    #ifdef PIXELSNAP
        uniform uScreenSize: vec4f;
    #endif
    #ifdef SCREENSPACE
        uniform projectionFlipY: f32;
    #endif

    fn grassHash(p: vec2f) -> f32 {
        return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
    }

    fn grassColliderPush(base: vec3f, c: vec4f) -> vec3f {
        if (c.w <= 0.0) { return vec3f(0.0); }
        var d = base - c.xyz;
        d.y = 0.0;
        let cdist = length(d);
        if (cdist > c.w) { return vec3f(0.0); }
        var dir = vec3f(1.0, 0.0, 0.0);
        if (cdist > 0.0001) { dir = d / cdist; }
        let s = 1.0 - cdist / c.w;
        return dir * s * s;
    }

    fn grassTotalPush(base: vec3f) -> vec3f {
        var push = vec3f(0.0);
        push += grassColliderPush(base, uniform.uCollider0);
        push += grassColliderPush(base, uniform.uCollider1);
        push += grassColliderPush(base, uniform.uCollider2);
        push += grassColliderPush(base, uniform.uCollider3);
        push += grassColliderPush(base, uniform.uCollider4);
        push += grassColliderPush(base, uniform.uCollider5);
        push += grassColliderPush(base, uniform.uCollider6);
        push += grassColliderPush(base, uniform.uCollider7);
        push += grassColliderPush(base, uniform.uCollider8);
        push += grassColliderPush(base, uniform.uCollider9);

        let pushLen = length(push);
        if (pushLen > 0.0001) { return push / pushLen * min(pushLen, 1.0); }
        return vec3f(0.0);
    }

    fn evalWorldPosition(vertexPosition: vec3f) -> vec4f {
        let base = dModelMatrix[3].xyz;

        let seed = grassHash(base.xz);
        grassVar_v = grassHash(base.xz + vec2f(17.3, 41.7));

        let camDist = distance(uniform.uCameraWorldPos, base);
        let fade = 1.0 - smoothstep(uniform.uRenderDist * 0.8, uniform.uRenderDist, camDist);
        grassFade_v = fade;

        let t = clamp(vertexPosition.y / max(uniform.uBladeHeight, 0.0001), 0.0, 1.0);
        grassHeight_v = t;
        grassLocalY_v = vertexPosition.y;

        var p = getLocalPosition(vertexPosition);
        p.y *= fade;
        p.y += uniform.uTipBias * uniform.uTipEnabled * t * t * fade;

        var posW = dModelMatrix * vec4f(p, 1.0);

        #ifdef SCREENSPACE
            posW.z = 0.0;
            posW.w = 1.0;
        #endif

        let phase = seed * 6.2831;
        var wind = sin(uniform.uTime * 1.6 + base.x * 0.25 + base.z * 0.25 + phase);
        wind += 0.5 * sin(uniform.uTime * 3.1 + phase * 1.7);
        let bend = (wind * uniform.uWindStrength + 0.15) * t * t;
        posW = vec4f(posW.x + uniform.uWindDir.x * bend,
                     posW.y - abs(bend) * 0.25,
                     posW.z + uniform.uWindDir.z * bend,
                     posW.w);

        let push = grassTotalPush(base);
        let pw = t * t;
        posW = vec4f(posW.x + push.x * pw * uniform.uCollisionStrength,
                     posW.y - length(push) * pw * 0.55,
                     posW.z + push.z * pw * uniform.uCollisionStrength,
                     posW.w);

        let delta = posW.xz - uniform.uCameraWorldPos.xz;
        let dist = length(delta);
        posW.y -= uniform.uCurvatureStrength * pow(dist, uniform.uCurvatureExp);

        return posW;
    }

    fn getPosition() -> vec4f {
        dModelMatrix = getModelMatrix();

        let posW = evalWorldPosition(vertex_position.xyz);
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
                var sp = (screenPos.xy * 0.5) + 0.5;
                sp *= uniform.uScreenSize.xy;
                sp = floor(sp);
                sp *= uniform.uScreenSize.zw;
                screenPos = vec4f((sp * 2.0) - 1.0, screenPos.z, screenPos.w);
            #endif
        #endif

        return screenPos;
    }

    fn getWorldPosition() -> vec3f {
        return dPositionW;
    }
`;

const grassUserMainEndVS_wgsl = `
    output.vGrassHeight = grassHeight_v;
    output.vGrassVar    = grassVar_v;
    output.vGrassFade   = grassFade_v;
    output.vGrassLocalY = grassLocalY_v;
`;

const grassFS_wgsl = `
    uniform uGrassBaseColor: vec3f;
    uniform uGrassTipColor: vec3f;
    uniform uColorVariance: f32;
    uniform uUseVertexColor: f32;
    uniform uVarianceSplitY: f32;
    uniform uVarianceLow: f32;
    uniform uVarianceHigh: f32;

    varying vGrassHeight: f32;
    varying vGrassVar: f32;
    varying vGrassFade: f32;
    varying vGrassLocalY: f32;

    fn getAlbedo() {
        if (vGrassFade < 0.01) {
            discard;
        }

        var col = mix(uniform.uGrassBaseColor, uniform.uGrassTipColor, vec3f(vGrassHeight));

        let varScale = mix(uniform.uVarianceLow, uniform.uVarianceHigh,
                           step(uniform.uVarianceSplitY, vGrassLocalY));

        col = col * (1.0 + (vGrassVar - 0.5) * 2.0 * uniform.uColorVariance * varScale);

        #ifdef VERTEXCOLOR
            col = col * mix(vec3f(1.0), vVertexColor.rgb, vec3f(uniform.uUseVertexColor));
        #endif

        dAlbedo = max(col, vec3f(0.0));
    }
`;


// =====================================================================
//  GRASS PATCHES — instance-based, per-patch colors/params
//  (see original header comments for the rendering design notes)
// =====================================================================

class Grass
{
    // ------------------------------------------------------------------
    //  shared / static
    // ------------------------------------------------------------------
    static MAX_COLLIDERS = 10;
    static colliderSlots = [];
    static collisionStrength = 1.0;

    static material = null;
    static sharedMesh = null;
    static sharedBladeHeight = 1.0;
    static sharedHasVC = false;
    static _meshPending = false;

    static patches = [];
    static _inited = false;
    static _updater = null;

    static renderDist = 60;

    // decoded texture pixel cache:  url -> Promise<{data, w, h}>
    static _pixelCache = new Map();

    static _ensureInit()
    {
        if (Grass._inited) return;
        Grass._inited = true;

        if (!GRASS_HEADLESS) {
            Grass._buildMaterial();
        }

        if (typeof SCRIPTS_TO_UPDATE !== 'undefined') {
            Grass._updater = {
                time: 0,
                update(dt) { Grass._update(dt, this); }
            };
            SCRIPTS_TO_UPDATE.push(Grass._updater);
        }
    }

    static _buildMaterial()
    {
        const m = new pc.StandardMaterial();

        if (!game.graphicsDevice.isWebGPU) {
            m.chunks.transformVS = grassVS;
            m.chunks.diffusePS   = grassFS;
        } else {
            const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_WGSL);
            chunks.set('transformVS', grassVS_wgsl);
            chunks.set('diffusePS', grassFS_wgsl);
            chunks.set('litUserMainEndVS', grassUserMainEndVS_wgsl);
        }

        m.cull = pc.CULLFACE_NONE;
        m.diffuseVertexColor = true;

        // material-level values = defaults; patches override via
        // meshInstance.setParameter()
        m.setParameter('uTime', 0);
        m.setParameter('uRenderDist', Grass.renderDist);
        m.setParameter('uWindDir', [1, 0, 0.35]);
        m.setParameter('uWindStrength', 0.35);
        m.setParameter('uBladeHeight', 1.0);
        m.setParameter('uTipBias', 0.0);
        m.setParameter('uTipEnabled', 0.0);
        m.setParameter('uUseVertexColor', 0.0);

        m.setParameter('uGrassBaseColor', [0.08, 0.22, 0.05]);
        m.setParameter('uGrassTipColor',  [0.45, 0.72, 0.22]);
        m.setParameter('uColorVariance', 0.5);
        m.setParameter('uVarianceSplitY', 0.1);
        m.setParameter('uVarianceLow', 0.35);
        m.setParameter('uVarianceHigh', 1.0);

        for (let i = 0; i < Grass.MAX_COLLIDERS; i++) {
            Grass.colliderSlots.push(new Float32Array(4));
            m.setParameter('uCollider' + i, Grass.colliderSlots[i]);
        }
        m.setParameter('uCollisionStrength', Grass.collisionStrength);

        m.update();
        Grass.material = m;
    }

    // ------------------------------------------------------------------
    //  texture pixel loading — cached per path, works in both envs
    // ------------------------------------------------------------------
    //  Resolves to { data, w, h } where data is RGBA bytes (Uint8Array /
    //  Uint8ClampedArray / Buffer — all indexable the same way).
    //  Failures are NOT cached, so a retry after fixing the file works.
    static _loadPixels(url)
    {
        if (Grass._pixelCache.has(url)) return Grass._pixelCache.get(url);

        let p;
        if (GRASS_HEADLESS) {
            p = new Promise((resolve, reject) => {
                try {
                    const fs = require('fs');
                    const { PNG } = require('pngjs');   // npm install pngjs
                    const png = PNG.sync.read(fs.readFileSync(url));
                    resolve({ data: png.data, w: png.width, h: png.height });
                } catch (e) {
                    reject(e);
                }
            });
        } else {
            p = new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    try {
                        const cvs = document.createElement('canvas');
                        cvs.width = img.width;
                        cvs.height = img.height;
                        const ctx = cvs.getContext('2d', { willReadFrequently: true });
                        ctx.drawImage(img, 0, 0);
                        const data = ctx.getImageData(0, 0, img.width, img.height).data;
                        resolve({ data, w: img.width, h: img.height });
                    } catch (e) {
                        reject(new Error('pixel read failed (' + e.message +
                            ') — is the image same-origin / CORS-enabled?'));
                    }
                };
                img.onerror = () => reject(new Error('failed to load ' + url));
                img.src = url;
            });
        }

        Grass._pixelCache.set(url, p);
        p.catch(() => Grass._pixelCache.delete(url));
        return p;
    }

    static clearTextureCache() { Grass._pixelCache.clear(); }

    static fromTexture(url, count, opts)
    {
        opts = opts || {};

        // ---- parse world bounds from the filename: ..._minX_minZ_maxX_maxZ.ext
        const file = url.split('/').pop().split('?')[0];
        const m = file.match(
            /(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)\.[a-zA-Z0-9]+$/
        );
        if (!m) {
            console.error('[grass] fromTexture: cannot parse bounds from "' + file +
                        '" — expected <name>_minX_minZ_maxX_maxZ.png');
            return null;
        }
        let minX = parseFloat(m[1]), minZ = parseFloat(m[2]);
        let maxX = parseFloat(m[3]), maxZ = parseFloat(m[4]);
        const width = maxX - minX, depth = maxZ - minZ;
        if (width <= 0 || depth <= 0) {
            console.error('[grass] fromTexture: bad bounds (min must be < max) in "' + file + '"');
            return null;
        }

        minZ = -minZ;
        maxZ = -maxZ;

        // ---- create the patch NOW, empty; blades land when pixels decode
        //      (instant if this texture is already in the cache)
        const patchOpts = Object.assign({}, opts, { autoScatter: false });
        if (patchOpts.capacity === undefined) patchOpts.capacity = count;

        const patch = new Grass(minX + width * 0.5, minZ + depth * 0.5,
                                width, depth, count, patchOpts);

        Grass._loadPixels(url).then((pixels) => {
            if (patch.destroyed) return;
            patch._buildMask(pixels, minX, minZ, maxX, maxZ, opts);
            patch.scatterMasked(count);
        }).catch((e) => {
            console.error('[grass] fromTexture: ' + (e && e.message ? e.message : e));
        });

        return patch;
    }

    // ------------------------------------------------------------------
    //  shared mesh handling
    // ------------------------------------------------------------------
    static _setSharedMesh(mesh, bladeHeight, hasVC)
    {
        Grass.sharedMesh = mesh;
        Grass.sharedBladeHeight = bladeHeight;
        Grass.sharedHasVC = hasVC;
        Grass._meshPending = false;

        if (Grass.material) {
            Grass.material.setParameter('uBladeHeight', bladeHeight);
            Grass.material.setParameter('uUseVertexColor', hasVC ? 1.0 : 0.0);
            Grass.material.update();
        }

        // (re)install on every existing patch
        for (const p of Grass.patches) p._installMeshInstance();
    }

    // Server: no mesh, but collision queries use the blade height to build
    // each blade's vertical segment. Call this with the SAME height the
    // client ends up with (1.0 for the procedural blade, or the GLB's
    // height logged by loadBladeGlb) so hit volumes match.
    static setBladeHeight(h) {
        Grass.sharedBladeHeight = h;
    }

    static useProceduralBlade()
    {
        Grass._ensureInit();
        if (GRASS_HEADLESS) {
            Grass.sharedBladeHeight = 1.0;
            return;
        }
        Grass._setSharedMesh(Grass.createBladeMesh(), 1.0, true);
    }

    static loadBladeGlb(url, onDone)
    {
        Grass._ensureInit();

        if (GRASS_HEADLESS) {
            console.warn('[grass] loadBladeGlb ignored on headless server — ' +
                         'use Grass.setBladeHeight(h) to match the client blade');
            if (onDone) onDone(false);
            return;
        }

        Grass._meshPending = true;

        const asset = new pc.Asset('grassBlade', 'container', { url: url });
        game.assets.add(asset);

        asset.once('load', () => {
            try {
                const renders = asset.resource.renders;
                if (!renders || renders.length === 0) throw new Error('no renders');
                const meshes = renders[0].resource.meshes;
                if (!meshes || meshes.length === 0) throw new Error('no meshes');

                const mesh = meshes[0];
                const aabb = mesh.aabb;
                const bladeHeight = aabb ? (aabb.center.y + aabb.halfExtents.y) : 1.0;

                let hasVC = false;
                const elems = mesh.vertexBuffer.format.elements;
                for (let i = 0; i < elems.length; i++) {
                    if (elems[i].name === pc.SEMANTIC_COLOR) { hasVC = true; break; }
                }

                console.log('[grass] GLB ok —', mesh.vertexBuffer.numVertices,
                            'verts, height', bladeHeight.toFixed(3),
                            'vertex colours:', hasVC);

                Grass._setSharedMesh(mesh, bladeHeight, hasVC);
                if (onDone) onDone(true);
            } catch (e) {
                console.warn('[grass] GLB unusable (' + e.message + '), using procedural blade');
                Grass._setSharedMesh(Grass.createBladeMesh(), 1.0, true);
                if (onDone) onDone(false);
            }
        });

        asset.once('error', (err) => {
            console.warn('[grass] GLB failed to load (' + err + '), using procedural blade');
            Grass._setSharedMesh(Grass.createBladeMesh(), 1.0, true);
            if (onDone) onDone(false);
        });

        game.assets.load(asset);
    }

    static createBladeMesh()
    {
        const segs = 3, h = 1.0, w = 0.06;
        const pos = [], nrm = [], uvs = [], idx = [], clr = [];
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const y = t * h;
            const hw = w * (1.0 - t * 0.85);
            pos.push(-hw, y, 0, hw, y, 0);
            nrm.push(0, 0, 1, 0, 0, 1);
            uvs.push(0, t, 1, t);
            const g = Math.round((0.4 + 0.6 * t) * 255);
            clr.push(g, g, g, 255, g, g, g, 255);
        }
        for (let i = 0; i < segs; i++) {
            const a = i * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        const mesh = new pc.Mesh(game.graphicsDevice);
        mesh.setPositions(pos);
        mesh.setNormals(nrm);
        mesh.setUvs(0, uvs);
        mesh.setColors32(clr);
        mesh.setIndices(idx);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        return mesh;
    }

    // ------------------------------------------------------------------
    //  global (all-patch) setters — same API as before
    // ------------------------------------------------------------------
    static setWind(dirXYZ, strength) {
        Grass._ensureInit();
        if (!Grass.material) return;
        if (dirXYZ) Grass.material.setParameter('uWindDir', dirXYZ);
        if (strength !== undefined) Grass.material.setParameter('uWindStrength', strength);
    }

    static setCurvature(strength, exponent) {
        Grass._ensureInit();
        if (!Grass.material) return;
        if (strength !== undefined) Grass.material.setParameter('uCurvatureStrength', strength);
        if (exponent !== undefined) Grass.material.setParameter('uCurvatureExp', exponent);
    }

    static setGrassColliders(list)
    {
        if (!Grass.material) return;
        const n = Math.min(list ? list.length : 0, Grass.MAX_COLLIDERS);
        for (let i = 0; i < Grass.MAX_COLLIDERS; i++) {
            const s = Grass.colliderSlots[i];
            if (i < n) {
                const c = list[i];
                s[0] = c.x;
                s[1] = c.y !== undefined ? c.y : 0;
                s[2] = c.z;
                s[3] = c.radius !== undefined ? c.radius : 1.0;
            } else {
                s[0] = 0; s[1] = 0; s[2] = 0; s[3] = 0;
            }
            Grass.material.setParameter('uCollider' + i, s);
        }
    }

    // convenience: cut across every patch (e.g. explosion)
    static cutRadiusAll(x, z, radius) {
        let cut = 0;
        for (const p of Grass.patches) cut += p.cutRadius(x, z, radius);
        return cut;
    }

    static getTotalBladeCount() {
        let n = 0;
        for (const p of Grass.patches) n += p.getBladeCount();
        return n;
    }

    static terrainHeight(x, z) {
        return 0;
    }

    // ------------------------------------------------------------------
    //  COLLISION QUERIES (server-friendly, also work on the client)
    // ------------------------------------------------------------------
    //  Sphere vs all patches. Patches whose rectangle is farther than
    //  `radius` from the sphere centre are rejected without touching a
    //  single blade, so far-away patches cost one distance check.
    //  Returns: [{ patch, index, x, y, z, height, distSq }, ...]
    static querySphereAll(cx, cy, cz, radius)
    {
        const out = [];
        for (const p of Grass.patches) p.querySphere(cx, cy, cz, radius, out);
        return out;
    }

    // 2D (XZ) variant — ignores height entirely.
    static queryRadiusAll(x, z, radius)
    {
        const out = [];
        for (const p of Grass.patches) p.queryRadius(x, z, radius, out);
        return out;
    }

    // ------------------------------------------------------------------
    //  per-frame global update (single registered updater)
    // ------------------------------------------------------------------
    static _update(dt, self)
    {
        self.time += dt;

        if (GRASS_HEADLESS || !Grass.material) {
            // server: nothing to animate; repacks are moot without a GPU
            return;
        }

        const cp = camera.entity.getPosition();
        Grass.material.setParameter('uTime', self.time);
        Grass.material.setParameter('uRenderDist', Grass.renderDist);
        Grass.material.setParameter('uCollisionStrength', Grass.collisionStrength);
        Grass.material.setParameter('uCameraWorldPos', [cp.x, cp.y, cp.z]);

        let p;
        if (typeof client === 'undefined' || !client || !client.mPlayer || !client.mPlayer.entity) {
            p = cp;
        } else {
            p = client.mPlayer.entity.getPosition();
        }

        Grass.setGrassColliders([
            { x: p.x, y: p.y, z: p.z, radius: 1.5 }
        ]);

        for (const patch of Grass.patches) {
            if (patch.dirty) patch._repack();
        }
    }

    // ==================================================================
    //  PATCH INSTANCE
    // ==================================================================
    //  new Grass(centerX, centerZ, width, depth, count, opts)
    //  opts: capacity, baseColor, tipColor, colorVariance, varianceSplitY,
    //        varianceLow, varianceHigh, tipBias, tipEnabled, renderDist,
    //        minHeight/maxHeight/minWidth/maxWidth, heightFn, autoScatter
    // ------------------------------------------------------------------
    constructor(centerX, centerZ, width, depth, count, opts)
    {
        Grass._ensureInit();

        opts = opts || {};
        this.centerX = centerX;
        this.centerZ = centerZ;
        this.width   = width;
        this.depth   = depth;
        this.opts    = opts;

        this.capacity = Math.max(1, opts.capacity !== undefined ? opts.capacity : count);
        this.blades   = [];
        this.freeList = [];
        this.liveCount = 0;
        this.dirty = false;
        this.matrixData = GRASS_HEADLESS ? null : new Float32Array(this.capacity * 16);
        this.instanceBuffer = null;
        this.mi = null;
        this.entity = null;
        this.destroyed = false;

        // scatter scale ranges (also used for the AABB height margin)
        this.minH = opts.minHeight !== undefined ? opts.minHeight : 0.5;
        this.maxH = opts.maxHeight !== undefined ? opts.maxHeight : 1.1;
        this.minW = opts.minWidth  !== undefined ? opts.minWidth  : 0.7;
        this.maxW = opts.maxWidth  !== undefined ? opts.maxWidth  : 1.3;
        this.heightFn = opts.heightFn || Grass.terrainHeight;

        if (!GRASS_HEADLESS) {
            this.entity = new pc.Entity('grassPatch');
            this.entity.addComponent('render', { meshInstances: [] });
            game.root.addChild(this.entity);
        }

        // per-patch shader parameter overrides — stored so they survive
        // mesh (re)installs, applied via meshInstance.setParameter()
        this._params = {};
        if (opts.baseColor)                    this._params.uGrassBaseColor = opts.baseColor;
        if (opts.tipColor)                     this._params.uGrassTipColor  = opts.tipColor;
        if (opts.colorVariance !== undefined)  this._params.uColorVariance  = opts.colorVariance;
        if (opts.varianceSplitY !== undefined) this._params.uVarianceSplitY = opts.varianceSplitY;
        if (opts.varianceLow !== undefined)    this._params.uVarianceLow    = opts.varianceLow;
        if (opts.varianceHigh !== undefined)   this._params.uVarianceHigh   = opts.varianceHigh;
        if (opts.tipBias !== undefined)        this._params.uTipBias        = opts.tipBias;
        if (opts.tipEnabled !== undefined)     this._params.uTipEnabled     = opts.tipEnabled ? 1.0 : 0.0;
        if (opts.renderDist !== undefined)     this._params.uRenderDist     = opts.renderDist;

        Grass.patches.push(this);

        if (count > 0 && opts.autoScatter !== false) {
            this.scatter(count);
        }

        if (!GRASS_HEADLESS) {
            if (Grass.sharedMesh) {
                this._installMeshInstance();
            } else if (!Grass._meshPending) {
                // nobody requested a GLB — fall back to the procedural blade
                Grass.useProceduralBlade();
            }
            // if a GLB is pending, _setSharedMesh() will install us when it lands
        }
    }

    _installMeshInstance()
    {
        if (this.destroyed || GRASS_HEADLESS) return;

        // tear down a previous mesh instance (e.g. GLB replaced procedural)
        if (this.mi) {
            this.entity.render.meshInstances = [];
            this.mi = null;
        }
        if (!this.instanceBuffer) {
            const device = game.graphicsDevice;
            this.instanceBuffer = new pc.VertexBuffer(
                device,
                pc.VertexFormat.getDefaultInstancingFormat(device),
                this.capacity,
                { usage: pc.BUFFER_DYNAMIC }
            );
        }

        const mi = new pc.MeshInstance(Grass.sharedMesh, Grass.material, this.entity);
        mi.setInstancing(this.instanceBuffer);

        // tight per-patch AABB — instancing hides instance positions from
        // the culler, so we supply the patch bounds explicitly.
        const maxBladeY = Grass.sharedBladeHeight * this.maxH;
        const margin = 2.0; // wind sway + collider push + tip bias
        mi.setCustomAabb(new pc.BoundingBox(
            new pc.Vec3(this.centerX, maxBladeY * 0.5, this.centerZ),
            new pc.Vec3(this.width * 0.5 + margin,
                        maxBladeY * 0.5 + margin,
                        this.depth * 0.5 + margin)
        ));

        // apply per-patch overrides
        for (const name in this._params) {
            mi.setParameter(name, this._params[name]);
        }

        this.mi = mi;
        this.entity.render.meshInstances = [mi];
        this.dirty = true;
    }

    // ------------------------------------------------------------------
    //  per-patch look setters
    // ------------------------------------------------------------------
    _setParam(name, value) {
        this._params[name] = value;
        if (this.mi) this.mi.setParameter(name, value);
    }

    setColors(baseRGB, tipRGB) {
        if (baseRGB) this._setParam('uGrassBaseColor', baseRGB);
        if (tipRGB)  this._setParam('uGrassTipColor', tipRGB);
    }

    setColorVariance(v) {
        this._setParam('uColorVariance', v);
    }

    setVarianceSplit(splitY, lowMul, highMul) {
        this._setParam('uVarianceSplitY', splitY);
        this._setParam('uVarianceLow', lowMul);
        this._setParam('uVarianceHigh', highMul);
    }

    setTipBias(metres, enabled) {
        this._setParam('uTipBias', metres);
        this._setParam('uTipEnabled', enabled ? 1.0 : 0.0);
    }

    setRenderDist(d) {
        this._setParam('uRenderDist', d);
    }

    // ------------------------------------------------------------------
    //  mask building — now takes decoded pixels ({data, w, h}) so the
    //  same code path serves the browser canvas AND the Node png decode
    // ------------------------------------------------------------------
    _buildMask(pixels, minX, minZ, maxX, maxZ, opts)
    {
        const w = pixels.w, h = pixels.h;
        const data = pixels.data;

        const sc    = opts.spawnColor || [255, 0, 0];
        const tol   = opts.tolerance || 0;
        const flipZ = !!opts.flipZ;

        // collect every matching pixel + track their bounding box
        const cells = [];
        let pxMin = w, pxMax = -1, pyMin = h, pyMax = -1;

        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const i = (py * w + px) * 4;
                if (Math.abs(data[i]     - sc[0]) <= tol &&
                    Math.abs(data[i + 1] - sc[1]) <= tol &&
                    Math.abs(data[i + 2] - sc[2]) <= tol) {
                    cells.push(py * w + px);
                    if (px < pxMin) pxMin = px;
                    if (px > pxMax) pxMax = px;
                    if (py < pyMin) pyMin = py;
                    if (py > pyMax) pyMax = py;
                }
            }
        }

        this.mask = {
            cells, data, w, h,
            minX, minZ, maxX, maxZ, flipZ,
            cellW: (maxX - minX) / w,
            cellD: (maxZ - minZ) / h,
            sc, tol
        };

        console.log('[grass] mask ' + w + 'x' + h + ' — ' + cells.length +
                    ' spawnable pixels (' +
                    (100 * cells.length / (w * h)).toFixed(1) + '%)');

        // ---- tighten patch bounds to the matching pixels (better culling,
        //      faster query/cutRadius quick-reject). Skip if nothing matched.
        if (cells.length > 0) {
            const mk = this.mask;
            const xLo = minX + pxMin * mk.cellW;
            const xHi = minX + (pxMax + 1) * mk.cellW;

            // rows map straight or flipped depending on flipZ
            const rowMin = flipZ ? (h - 1 - pyMax) : pyMin;
            const rowMax = flipZ ? (h - 1 - pyMin) : pyMax;
            const zLo = minZ + rowMin * mk.cellD;
            const zHi = minZ + (rowMax + 1) * mk.cellD;

            this.centerX = (xLo + xHi) * 0.5;
            this.centerZ = (zLo + zHi) * 0.5;
            this.width   = Math.abs(xHi - xLo);
            this.depth   = Math.abs(zHi - zLo);

            if (this.mi) {
                const maxBladeY = Grass.sharedBladeHeight * this.maxH;
                const margin = 2.0;
                this.mi.setCustomAabb(new pc.BoundingBox(
                    new pc.Vec3(this.centerX, maxBladeY * 0.5, this.centerZ),
                    new pc.Vec3(this.width * 0.5 + margin,
                                maxBladeY * 0.5 + margin,
                                this.depth * 0.5 + margin)
                ));
            }
        }
    }

    // ------------------------------------------------------------------
    //  blade management (all patch-local)
    // ------------------------------------------------------------------
    addBlade(mat4) {
        let index;
        if (this.freeList.length > 0) {
            index = this.freeList.pop();
        } else {
            if (this.liveCount >= this.capacity) return -1;
            index = this.liveCount++;
        }
        this.blades[index] = mat4.clone();
        this.dirty = true;
        return index;
    }

    addBladeTRS(pos, rotDegY, scale) {
        const m = new pc.Mat4();
        const q = new pc.Quat().setFromEulerAngles(0, rotDegY || 0, 0);
        const s = (typeof scale === 'number')
            ? new pc.Vec3(scale, scale, scale)
            : (scale || new pc.Vec3(1, 1, 1));
        m.setTRS(pos, q, s);
        return this.addBlade(m);
    }

    addBlades(mat4Array) {
        const handles = [];
        for (let i = 0; i < mat4Array.length; i++) {
            handles.push(this.addBlade(mat4Array[i]));
        }
        return handles;
    }

    // scatter `count` blades inside THIS patch's rectangle
    scatter(count) {
        const handles = [];
        for (let i = 0; i < count; i++) {
            const x = this.centerX + (Math.random() - 0.5) * this.width;
            const z = this.centerZ + (Math.random() - 0.5) * this.depth;
            const h = this.minH + Math.random() * (this.maxH - this.minH);
            const w = this.minW + Math.random() * (this.maxW - this.minW);
            handles.push(this.addBladeTRS(
                new pc.Vec3(x, this.heightFn(x, z), z),
                Math.random() * 360,
                new pc.Vec3(w, h, w)
            ));
        }
        return handles;
    }

    // Scatter `count` blades, only on matching pixels.
    scatterMasked(count)
    {
        const mk = this.mask;
        if (!mk) {
            console.warn('[grass] scatterMasked: no mask built — falling back to scatter()');
            return this.scatter(count);
        }
        if (mk.cells.length === 0) {
            console.warn('[grass] scatterMasked: no pixels matched spawnColor — nothing spawned');
            return [];
        }

        const handles = [];
        for (let i = 0; i < count; i++) {
            const cell = mk.cells[(Math.random() * mk.cells.length) | 0];
            const px = cell % mk.w;
            const py = (cell / mk.w) | 0;

            const x   = mk.minX + (px + Math.random()) * mk.cellW;
            const row = mk.flipZ ? (mk.h - 1 - py) : py;
            const z   = mk.minZ + (row + Math.random()) * mk.cellD;

            const hgt = this.minH + Math.random() * (this.maxH - this.minH);
            const wdt = this.minW + Math.random() * (this.maxW - this.minW);
            handles.push(this.addBladeTRS(
                new pc.Vec3(x, this.heightFn(x, z), z),
                Math.random() * 360,
                new pc.Vec3(wdt, hgt, wdt)
            ));
        }
        return handles;
    }

    removeBlade(index) {
        if (index < 0 || index >= this.liveCount) return false;
        if (!this.blades[index]) return false;
        this.blades[index] = null;
        this.freeList.push(index);
        this.dirty = true;
        return true;
    }

    // circle (XZ) vs patch rectangle — shared quick-reject used by
    // cutRadius and the collision queries
    _rectCircleReject(x, z, radius) {
        const hx = this.width * 0.5, hz = this.depth * 0.5;
        const cx = Math.max(this.centerX - hx, Math.min(x, this.centerX + hx));
        const cz = Math.max(this.centerZ - hz, Math.min(z, this.centerZ + hz));
        const ddx = x - cx, ddz = z - cz;
        return ddx * ddx + ddz * ddz > radius * radius;
    }

    cutRadius(x, z, radius) {
        if (this._rectCircleReject(x, z, radius)) return 0;

        const r2 = radius * radius;
        let cut = 0;
        for (let i = 0; i < this.liveCount; i++) {
            const m = this.blades[i];
            if (!m) continue;
            const d = m.data;
            const dx = d[12] - x, dz = d[14] - z;
            if (dx * dx + dz * dz <= r2) {
                this.blades[i] = null;
                this.freeList.push(i);
                cut++;
            }
        }
        if (cut > 0) this.dirty = true;
        return cut;
    }

    // ------------------------------------------------------------------
    //  COLLISION QUERIES
    // ------------------------------------------------------------------
    //  Sphere (cx, cy, cz, radius) vs this patch's blades.
    //  - Patch-level quick reject first: if the sphere's XZ circle
    //    doesn't touch the patch rectangle, no blade is examined.
    //  - Each blade is treated as a vertical segment from its base up to
    //    base + sharedBladeHeight * scaleY (matches the rendered blade,
    //    ignoring wind sway).
    //  Appends hits to `out` (created if omitted) and returns it.
    //  Hit: { patch, index, x, y, z, height, distSq }
    querySphere(cx, cy, cz, radius, out)
    {
        out = out || [];
        if (this._rectCircleReject(cx, cz, radius)) return out;

        const r2 = radius * radius;
        const bladeH = Grass.sharedBladeHeight;

        for (let i = 0; i < this.liveCount; i++) {
            const m = this.blades[i];
            if (!m) continue;
            const d = m.data;
            const bx = d[12], by = d[13], bz = d[14];

            // cheap XZ reject before touching Y
            const dx = bx - cx, dz = bz - cz;
            const xz2 = dx * dx + dz * dz;
            if (xz2 > r2) continue;

            // blade height in world units = mesh height * Y scale
            // (Y scale = length of the matrix's Y basis column)
            const sy = Math.sqrt(d[4] * d[4] + d[5] * d[5] + d[6] * d[6]);
            const top = by + bladeH * sy;

            // closest point on the blade's vertical segment to the sphere centre
            const ty = Math.max(by, Math.min(cy, top));
            const dy = ty - cy;
            const distSq = xz2 + dy * dy;

            if (distSq <= r2) {
                out.push({
                    patch: this, index: i,
                    x: bx, y: by, z: bz,
                    height: bladeH * sy,
                    distSq
                });
            }
        }
        return out;
    }

    //  2D variant: everything within `radius` of (x, z), height ignored.
    queryRadius(x, z, radius, out)
    {
        out = out || [];
        if (this._rectCircleReject(x, z, radius)) return out;

        const r2 = radius * radius;
        for (let i = 0; i < this.liveCount; i++) {
            const m = this.blades[i];
            if (!m) continue;
            const d = m.data;
            const dx = d[12] - x, dz = d[14] - z;
            const distSq = dx * dx + dz * dz;
            if (distSq <= r2) {
                out.push({
                    patch: this, index: i,
                    x: d[12], y: d[13], z: d[14],
                    distSq
                });
            }
        }
        return out;
    }

    findBlade(x, z, maxDist) {
        let best = -1;
        let bestD = maxDist !== undefined ? maxDist * maxDist : Infinity;
        for (let i = 0; i < this.liveCount; i++) {
            const m = this.blades[i];
            if (!m) continue;
            const d = m.data;
            const dx = d[12] - x, dz = d[14] - z;
            const dd = dx * dx + dz * dz;
            if (dd < bestD) { bestD = dd; best = i; }
        }
        return best;
    }

    updateBlade(index, mat4) {
        if (index < 0 || index >= this.liveCount || !this.blades[index]) return false;
        this.blades[index].copy(mat4);
        this.dirty = true;
        return true;
    }

    getBladePosition(index, out) {
        if (index < 0 || index >= this.liveCount || !this.blades[index]) return null;
        const d = this.blades[index].data;
        out = out || new pc.Vec3();
        out.set(d[12], d[13], d[14]);
        return out;
    }

    clearBlades() {
        this.blades.length = 0;
        this.freeList.length = 0;
        this.liveCount = 0;
        this.dirty = true;
    }

    getBladeCount() {
        return this.liveCount - this.freeList.length;
    }

    // Utility: does world position (x, z) sit on a spawnable pixel?
    maskTest(x, z)
    {
        const mk = this.mask;
        if (!mk) return true;

        const px = Math.floor((x - mk.minX) / mk.cellW);
        let   py = Math.floor((z - mk.minZ) / mk.cellD);
        if (mk.flipZ) py = mk.h - 1 - py;
        if (px < 0 || px >= mk.w || py < 0 || py >= mk.h) return false;

        const i = (py * mk.w + px) * 4;
        return Math.abs(mk.data[i]     - mk.sc[0]) <= mk.tol &&
            Math.abs(mk.data[i + 1] - mk.sc[1]) <= mk.tol &&
            Math.abs(mk.data[i + 2] - mk.sc[2]) <= mk.tol;
    }

    // ------------------------------------------------------------------
    //  GPU repack (client only; server has nothing to upload)
    // ------------------------------------------------------------------
    _repack()
    {
        if (GRASS_HEADLESS) { this.dirty = false; return; }
        if (!this.mi) return;

        let write = 0;
        for (let i = 0; i < this.liveCount; i++) {
            const m = this.blades[i];
            if (!m) continue;
            this.matrixData.set(m.data, write * 16);
            write++;
        }

        if (write > 0) {
            new Float32Array(this.instanceBuffer.lock(), 0, write * 16)
                .set(this.matrixData.subarray(0, write * 16));
            this.instanceBuffer.unlock();
        }

        this.mi.instancingCount = write;
        this.mi.visible = write > 0;
        this.dirty = false;
    }

    // ------------------------------------------------------------------
    //  teardown
    // ------------------------------------------------------------------
    destroy()
    {
        if (this.destroyed) return;
        this.destroyed = true;

        const idx = Grass.patches.indexOf(this);
        if (idx !== -1) Grass.patches.splice(idx, 1);

        if (this.entity) {
            this.entity.destroy();
            this.entity = null;
        }
        if (this.instanceBuffer) {
            this.instanceBuffer.destroy();
            this.instanceBuffer = null;
        }
        this.mi = null;
        this.blades.length = 0;
    }
}

// Node export (harmless no-op in the browser without a bundler)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Grass };
}