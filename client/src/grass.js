// =====================================================================
//  GRASS — matrix-instanced, mutable blade list, StandardMaterial
// =====================================================================

// ---------------------------------------------------------------------
//  transformVS — everything except getNormal()
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


class Grass
{
    static MAX_COLLIDERS = 10;
    static colliderSlots = [];
    static collisionStrength = 2.0;
    static MAX_INSTANCES = 400000;

    static material = null;
    static grassMI = null;
    static grassEntity = null;
    static instanceBuffer = null;
    static matrixData = null;

    static blades = [];
    static freeList = [];
    static liveCount = 0;
    static dirty = false;

    static renderDist = 60;

    static buildMaterial()
    {
        const m = new pc.StandardMaterial();

        if (!game.graphicsDevice.isWebGPU) {
            m.chunks.transformVS = grassVS;
            //m.chunks.normalVS    = grassNormalVS;
            m.chunks.diffusePS   = grassFS;
        } else {
            const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_WGSL);
            chunks.set('transformVS', grassVS_wgsl);
            chunks.set('diffusePS', grassFS_wgsl);
            chunks.set('litUserMainEndVS', grassUserMainEndVS_wgsl);
            /*m.chunks.transformVS = grassVS_wgsl;
            //m.chunks.normalVS    = grassNormalVS_wgsl;
            m.chunks.diffusePS   = grassFS_wgsl;*/
        }

        m.cull = pc.CULLFACE_NONE;
        m.diffuseVertexColor = true;

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

        // Unneeded, this is set globally every frame by updateCurvatureUniforms()
        /*m.setParameter('uCameraWorldPos', [0, 0, 0]);
        m.setParameter('uCurvatureStrength', 0.0);
        m.setParameter('uCurvatureExp', 2.0);*/

        for (let i = 0; i < Grass.MAX_COLLIDERS; i++) {
            Grass.colliderSlots.push(new Float32Array(4));
            m.setParameter('uCollider' + i, Grass.colliderSlots[i]);
        }
        m.setParameter('uCollisionStrength', Grass.collisionStrength);

        m.update();
        Grass.material = m;
    }

    static setColors(baseRGB, tipRGB) {
        if (baseRGB) Grass.material.setParameter('uGrassBaseColor', baseRGB);
        if (tipRGB)  Grass.material.setParameter('uGrassTipColor', tipRGB);
    }

    static setColorVariance(v) {
        Grass.material.setParameter('uColorVariance', v);
    }

    static setVarianceSplit(splitY, lowMul, highMul) {
        Grass.material.setParameter('uVarianceSplitY', splitY);
        Grass.material.setParameter('uVarianceLow', lowMul);
        Grass.material.setParameter('uVarianceHigh', highMul);
    }

    static setWind(dirXYZ, strength) {
        if (dirXYZ) Grass.material.setParameter('uWindDir', dirXYZ);
        if (strength !== undefined) Grass.material.setParameter('uWindStrength', strength);
    }

    static setTipBias(metres, enabled) {
        Grass.material.setParameter('uTipBias', metres);
        Grass.material.setParameter('uTipEnabled', enabled ? 1.0 : 0.0);
    }

    static setCurvature(strength, exponent) {
        if (strength !== undefined) Grass.material.setParameter('uCurvatureStrength', strength);
        if (exponent !== undefined) Grass.material.setParameter('uCurvatureExp', exponent);
    }

    static setupInstancing()
    {
        const device = game.graphicsDevice;

        Grass.matrixData = new Float32Array(Grass.MAX_INSTANCES * 16);
        Grass.instanceBuffer = new pc.VertexBuffer(
            device,
            pc.VertexFormat.getDefaultInstancingFormat(device),
            Grass.MAX_INSTANCES,
            {
                usage: pc.BUFFER_DYNAMIC
            }
        );

        const e = new pc.Entity('grass');
        e.addComponent('render', { meshInstances: [] });
        game.root.addChild(e);
        Grass.grassEntity = e;
    }

    static installMesh(mesh, bladeHeight, hasVertexColor)
    {
        Grass.material.setParameter('uBladeHeight', bladeHeight);
        if (hasVertexColor) Grass.material.setParameter('uUseVertexColor', 1.0);
        Grass.material.update();

        const mi = new pc.MeshInstance(mesh, Grass.material, Grass.grassEntity);
        mi.cull = false;
        mi.setInstancing(Grass.instanceBuffer);
        // instancing hides instance positions from the culler — supply the
        // field bounds explicitly, otherwise the aabb stays a single blade
        // at the origin and everything gets culled
        const bounds = new pc.BoundingBox(
            new pc.Vec3(0, bladeHeight * 0.5, 0),
            new pc.Vec3(500, bladeHeight * 2, 500)
        );
        mi.setCustomAabb(bounds);

console.log('[grass] setCustomAabb exists:', typeof mi.setCustomAabb,
            'pc.version:', pc.version,
            '_customAabb:', mi._customAabb,
            'aabb after:', mi.aabb.halfExtents);

        mi.visible = true;

        Grass.grassMI = mi;
        Grass.grassEntity.render.meshInstances = [mi];

        Grass.dirty = true;

        console.log('[grass] instancingData', mi.instancingData,
            'count', mi.instancingData && mi.instancingData.count,
            'mesh', mi.mesh, 'aabb', mi.aabb);
    }

    static addBlade(mat4) {
        let index;
        if (Grass.freeList.length > 0) {
            index = Grass.freeList.pop();
        } else {
            if (Grass.liveCount >= Grass.MAX_INSTANCES) return -1;
            index = Grass.liveCount++;
        }
        Grass.blades[index] = mat4.clone();
        Grass.dirty = true;
        return index;
    }

    static addBladeTRS(pos, rotDegY, scale) {
        const m = new pc.Mat4();
        const q = new pc.Quat().setFromEulerAngles(0, rotDegY || 0, 0);
        const s = (typeof scale === 'number')
            ? new pc.Vec3(scale, scale, scale)
            : (scale || new pc.Vec3(1, 1, 1));
        m.setTRS(pos, q, s);
        return Grass.addBlade(m);
    }

    static addBlades(mat4Array) {
        const handles = [];
        for (let i = 0; i < mat4Array.length; i++) {
            handles.push(Grass.addBlade(mat4Array[i]));
        }
        return handles;
    }

    static scatter(centerX, centerZ, width, depth, count, opts) {
        opts = opts || {};
        const minH = opts.minHeight !== undefined ? opts.minHeight : 0.5;
        const maxH = opts.maxHeight !== undefined ? opts.maxHeight : 1.1;
        const minW = opts.minWidth  !== undefined ? opts.minWidth  : 0.7;
        const maxW = opts.maxWidth  !== undefined ? opts.maxWidth  : 1.3;
        const yFn  = opts.heightFn || Grass.terrainHeight;

        const handles = [];
        for (let i = 0; i < count; i++) {
            const x = centerX + (Math.random() - 0.5) * width;
            const z = centerZ + (Math.random() - 0.5) * depth;
            const h = minH + Math.random() * (maxH - minH);
            const w = minW + Math.random() * (maxW - minW);
            handles.push(Grass.addBladeTRS(
                new pc.Vec3(x, yFn(x, z), z),
                Math.random() * 360,
                new pc.Vec3(w, h, w)
            ));
        }
        return handles;
    }

    static removeBlade(index) {
        if (index < 0 || index >= Grass.liveCount) return false;
        if (!Grass.blades[index]) return false;
        Grass.blades[index] = null;
        Grass.freeList.push(index);
        Grass.dirty = true;
        return true;
    }

    static cutRadius(x, z, radius) {
        const r2 = radius * radius;
        let cut = 0;
        for (let i = 0; i < Grass.liveCount; i++) {
            const m = Grass.blades[i];
            if (!m) continue;
            const d = m.data;
            const dx = d[12] - x, dz = d[14] - z;
            if (dx * dx + dz * dz <= r2) {
                Grass.blades[i] = null;
                Grass.freeList.push(i);
                cut++;
            }
        }
        if (cut > 0) Grass.dirty = true;
        return cut;
    }

    static findBlade(x, z, maxDist) {
        let best = -1;
        let bestD = maxDist !== undefined ? maxDist * maxDist : Infinity;
        for (let i = 0; i < Grass.liveCount; i++) {
            const m = Grass.blades[i];
            if (!m) continue;
            const d = m.data;
            const dx = d[12] - x, dz = d[14] - z;
            const dd = dx * dx + dz * dz;
            if (dd < bestD) { bestD = dd; best = i; }
        }
        return best;
    }

    static updateBlade(index, mat4) {
        if (index < 0 || index >= Grass.liveCount || !Grass.blades[index]) return false;
        Grass.blades[index].copy(mat4);
        Grass.dirty = true;
        return true;
    }

    static getBladePosition(index, out) {
        if (index < 0 || index >= Grass.liveCount || !Grass.blades[index]) return null;
        const d = Grass.blades[index].data;
        out = out || new pc.Vec3();
        out.set(d[12], d[13], d[14]);
        return out;
    }

    static clearBlades() {
        Grass.blades.length = 0;
        Grass.freeList.length = 0;
        Grass.liveCount = 0;
        Grass.dirty = true;
    }

    static getBladeCount() {
        return Grass.liveCount - Grass.freeList.length;
    }

    static repack()
    {
        if (!Grass.grassMI) return;

        let write = 0;
        for (let i = 0; i < Grass.liveCount; i++) {
            const m = Grass.blades[i];
            if (!m) continue;
            Grass.matrixData.set(m.data, write * 16);
            write++;
        }

        if (write > 0) {
            new Float32Array(Grass.instanceBuffer.lock(), 0, write * 16)
                .set(Grass.matrixData.subarray(0, write * 16));
            Grass.instanceBuffer.unlock();
        }

        Grass.grassMI.instancingCount = write;
        Grass.grassMI.visible = write > 0;
        Grass.dirty = false;
    }

    static setGrassColliders(list)
    {
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

    static terrainHeight(x, z) {
        return 0;
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

    static loadBladeGlb(url, onDone)
    {
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

                Grass.installMesh(mesh, bladeHeight, hasVC);
                Grass.repack();
                if (onDone) onDone(true);
            } catch (e) {
                console.warn('[grass] GLB unusable (' + e.message + '), using procedural blade');
                Grass.installMesh(Grass.createBladeMesh(), 1.0, true);
                Grass.repack();
                if (onDone) onDone(false);
            }
        });

        asset.once('error', (err) => {
            console.warn('[grass] GLB failed to load (' + err + '), using procedural blade');
            Grass.installMesh(Grass.createBladeMesh(), 1.0, true);
            Grass.repack();
            if (onDone) onDone(false);
        });

        game.assets.load(asset);
    }

    constructor()
    {
        this.time = 0;
        SCRIPTS_TO_UPDATE.push(this);
    }

    update(dt)
    {
        this.time += dt;

        const cp = camera.entity.getPosition();
        Grass.material.setParameter('uTime', this.time);
        Grass.material.setParameter('uRenderDist', Grass.renderDist);
        Grass.material.setParameter('uCollisionStrength', Grass.collisionStrength);
        Grass.material.setParameter('uCameraWorldPos', [cp.x, cp.y, cp.z]);

        let p;
        if (!client || !client.mPlayer || !client.mPlayer.entity) {
            p = cp;
        } else {
            p = client.mPlayer.entity.getPosition();
        }

        Grass.setGrassColliders([
            { x: p.x, y: p.y, z: p.z, radius: 4.0 }
        ]);

        if (Grass.dirty) Grass.repack();
    }
}