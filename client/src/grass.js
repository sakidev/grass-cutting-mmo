const grassVS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv0;
attribute vec4 aColor;

attribute vec4 iPosSeed;
attribute vec4 iParams;

uniform mat4 matrix_viewProjection;
uniform vec3 view_position;
uniform float uTime;
uniform float uRenderDist;
uniform vec3 uWindDir;
uniform float uWindStrength;
uniform float uCollisionStrength;

uniform float uBladeHeight;    // local-space height of the source mesh
uniform float uTipBias;        // extra metres added at the tip
uniform float uTipEnabled;     // 0 or 1
uniform float uUseVertexColor; // 0 or 1
uniform float uColorVariance;

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

varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;
varying float vColorVar;
varying float vFade;
varying vec3 vVertColor;

mat3 rotY(float a){ float s=sin(a),c=cos(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }

vec3 colliderPush(vec3 base, vec4 c) {
    if (c.w <= 0.0) return vec3(0.0);
    vec3 d = base - c.xyz;
    d.y = 0.0;
    float cdist = length(d);
    if (cdist > c.w) return vec3(0.0);
    vec3 dir = cdist > 0.0001 ? d / cdist : vec3(1.0, 0.0, 0.0);
    float s = 1.0 - cdist / c.w;
    return dir * s * s;
}

void main(void) {
    vec3 base = iPosSeed.xyz;
    float seed = iPosSeed.w;
    float hScale = iParams.x;
    float rot    = iParams.y;
    float wScale = iParams.z;
    vColorVar    = iParams.w;

    float dist = distance(view_position, base);
    vFade = 1.0 - smoothstep(uRenderDist * 0.8, uRenderDist, dist);

    // normalized height along the blade, derived from local Y rather than UV
    // so an arbitrary GLB works without authored UVs
    float t = clamp(aPosition.y / max(uBladeHeight, 0.0001), 0.0, 1.0);

    vec3 p = aPosition;
    p.xz *= wScale;
    p.y  *= hScale * vFade;

    // optional tip raise: pushes upper verts higher, root untouched
    p.y += uTipBias * uTipEnabled * t * t * hScale * vFade;

    float phase = seed * 6.2831;
    float wind = sin(uTime * 1.6 + base.x * 0.25 + base.z * 0.25 + phase);
    wind += 0.5 * sin(uTime * 3.1 + phase * 1.7);
    float bend = (wind * uWindStrength + 0.15) * t * t;

    p.xz += uWindDir.xz * bend * hScale;
    p.y  -= abs(bend) * 0.25 * hScale;

    mat3 R = rotY(rot);
    p = R * p;

    vec3 push = vec3(0.0);
    push += colliderPush(base, uCollider0);
    push += colliderPush(base, uCollider1);
    push += colliderPush(base, uCollider2);
    push += colliderPush(base, uCollider3);
    push += colliderPush(base, uCollider4);
    push += colliderPush(base, uCollider5);
    push += colliderPush(base, uCollider6);
    push += colliderPush(base, uCollider7);
    push += colliderPush(base, uCollider8);
    push += colliderPush(base, uCollider9);

    float pushLen = length(push);
    if (pushLen > 0.0001) {
        push = push / pushLen * min(pushLen, 1.0);
        float w = t * t;
        p.xz += push.xz * w * hScale * uCollisionStrength;
        p.y  -= pushLen * w * hScale * 0.55;
    }

    vec3 n = R * normalize(aNormal + vec3(bend * 0.5, 0.0, 0.0));
    n = normalize(n + vec3(push.x, 0.0, push.z) * 0.6);

    vNormal = n;
    vUv = aUv0;
    vHeight = t;
    vVertColor = mix(vec3(1.0), aColor.rgb, uUseVertexColor);

    gl_Position = matrix_viewProjection * vec4(base + p, 1.0);
}
`;

const grassFS = `
precision highp float;
varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;
varying float vColorVar;
varying float vFade;
varying vec3 vVertColor;

uniform vec3 uLightDir;
uniform vec3 uBaseColor;
uniform vec3 uTipColor;
uniform float uColorVariance;

void main(void) {
    if (vFade < 0.01) discard;

    vec3 col = mix(uBaseColor, uTipColor, vHeight);

    // per-instance variation, amount controlled by uColorVariance
    col *= 1.0 + (vColorVar - 0.5) * 2.0 * uColorVariance;

    // mesh vertex colours multiply on top when enabled
    col *= vVertColor;

    vec3 n = normalize(vNormal);
    float lambert = 0.45 + 0.55 * abs(dot(n, -uLightDir));
    float ao = 0.35 + 0.65 * vHeight;

    gl_FragColor = vec4(max(col, 0.0) * lambert * ao, 1.0);
}
`;

class Grass
{
    static MAX_COLLIDERS = 10;
    static colliderSlots = [];
    static collisionStrength = 1.0;

    static material = null;
    static buildMaterial()
    {
        const grassMaterial = new pc.ShaderMaterial(
            {
                uniqueName: "grassShader",
                vertexGLSL: grassVS,
                fragmentGLSL: grassFS,
                attributes: {
                    aPosition: pc.SEMANTIC_POSITION,
                    aNormal: pc.SEMANTIC_NORMAL,
                    aUv0: pc.SEMANTIC_TEXCOORD0,
                    aColor: pc.SEMANTIC_COLOR,
                    iPosSeed: pc.SEMANTIC_ATTR12,
                    iParams: pc.SEMANTIC_ATTR13,
                },
            }
        );
        grassMaterial.cull = pc.CULLFACE_NONE;
        grassMaterial.setParameter('uTime', 0);
        grassMaterial.setParameter('uRenderDist', Grass.renderDist);
        grassMaterial.setParameter('uWindDir', [1, 0, 0.35]);
        grassMaterial.setParameter('uWindStrength', 0.35);
        grassMaterial.setParameter('uLightDir', [-0.5, -0.7, -0.4]);
        grassMaterial.setParameter('uBaseColor', [0.08, 0.22, 0.05]);
        grassMaterial.setParameter('uTipColor', [0.45, 0.72, 0.22]);
        grassMaterial.setParameter('uBladeHeight', 1.0);
        grassMaterial.setParameter('uTipBias', 0.0);
        grassMaterial.setParameter('uTipEnabled', 0.0);
        grassMaterial.setParameter('uUseVertexColor', 0.0);
        grassMaterial.setParameter('uColorVariance', 0.5);

        for (let i = 0; i < Grass.MAX_COLLIDERS; i++) {
            Grass.colliderSlots.push(new Float32Array(4));
            grassMaterial.setParameter('uCollider' + i, Grass.colliderSlots[i]);
        }
        grassMaterial.setParameter('uCollisionStrength', Grass.collisionStrength);
        grassMaterial.update();
        Grass.material = grassMaterial;
    }

    static terrainHeight(x, z)
    {
        return 0;
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

    static CHUNK_SIZE = 8;
    static MAX_INSTANCES = 400000;
    static grassMI = null;
    static grassEntity = null;
    static cpuData = null;
    static instanceBuffer = null;
    static setupInstancing()
    {
        const instanceFormat = new pc.VertexFormat(game.graphicsDevice, [
            { semantic: pc.SEMANTIC_ATTR12, components: 4, type: pc.TYPE_FLOAT32 },
            { semantic: pc.SEMANTIC_ATTR13, components: 4, type: pc.TYPE_FLOAT32 }
        ]);

        const CHUNK_SIZE = Grass.CHUNK_SIZE;
        const MAX_INSTANCES = Grass.MAX_INSTANCES;
        Grass.cpuData = new Float32Array(MAX_INSTANCES * 8);
        Grass.instanceBuffer = new pc.VertexBuffer(
            game.graphicsDevice,
            instanceFormat,
            MAX_INSTANCES,
            pc.BUFFER_DYNAMIC
        );

        const grassEntity = new pc.Entity('grass');
        grassEntity.addComponent('render', { meshInstances: [] });
        game.root.addChild(grassEntity);
        Grass.grassEntity = grassEntity;
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
            // vertex colour: darker at root, lighter at tip
            const g = 0.4 + 0.6 * t;
            clr.push(g, g, g, 1, g, g, g, 1);
        }
        for (let i = 0; i < segs; i++) {
            const a = i * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        const mesh = new pc.Mesh(game.graphicsDevice);
        mesh.setPositions(pos);
        mesh.setNormals(nrm);
        mesh.setUvs(0, uvs);
        mesh.setColors32(clr.map(v => Math.round(v * 255)));
        mesh.setIndices(idx);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        return mesh;
    }

    static installMesh(mesh, bladeHeight, hasVertexColor)
    {
        Grass.grassMI = new pc.MeshInstance(mesh, Grass.material, Grass.grassEntity);
        Grass.grassMI.cull = false;
        Grass.grassMI.setInstancing(Grass.instanceBuffer);
        Grass.grassEntity.render.meshInstances = [Grass.grassMI];
        Grass.material.setParameter('uBladeHeight', bladeHeight);
        Grass.material.update();

        if (hasVertexColor) {
            Grass.material.setParameter('uUseVertexColor', 1.0);
        }
        Grass.rebuildInstances(camera.entity.getPosition());
    }

    static hash(x, y, s) {
        let h = x * 374761393 + y * 668265263 + s * 2147483647;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) >>> 0) / 4294967296;
    }

    static chunkCache = new Map();
    static densityPerM2 = 8;
    static renderDist = 60;

    static buildChunk(cx, cz)
    {
        const count = Math.floor(Grass.CHUNK_SIZE * Grass.CHUNK_SIZE * Grass.densityPerM2);
        const arr = new Float32Array(count * 8);
        for (let i = 0; i < count; i++) {
            const r1 = Grass.hash(cx * 73856093 + i, cz * 19349663, 1);
            const r2 = Grass.hash(cx * 73856093 + i, cz * 19349663, 2);
            const r3 = Grass.hash(cx * 73856093 + i, cz * 19349663, 3);
            const r4 = Grass.hash(cx * 73856093 + i, cz * 19349663, 4);
            const r5 = Grass.hash(cx * 73856093 + i, cz * 19349663, 5);
            const x = cx * Grass.CHUNK_SIZE + r1 * Grass.CHUNK_SIZE;
            const z = cz * Grass.CHUNK_SIZE + r2 * Grass.CHUNK_SIZE;
            const o = i * 8;
            arr[o + 0] = x;
            arr[o + 1] = Grass.terrainHeight(x, z);
            arr[o + 2] = z;
            arr[o + 3] = r3;
            arr[o + 4] = 0.5 + r4 * 0.6;
            arr[o + 5] = r5 * Math.PI * 2.0;
            arr[o + 6] = 0.7 + r3 * 0.6;
            arr[o + 7] = r4;
        }
        return arr;
    }
    
    static getChunk(cx, cz) {
        const key = cx + ',' + cz;
        let c = Grass.chunkCache.get(key);
        if (!c) { c = Grass.buildChunk(cx, cz); Grass.chunkCache.set(key, c); }
        return c;
    }

    static lastChunkX = null;
    static lastChunkZ = null;
    static lastDist = -1;
    static lastDensity = -1;

    static rebuildInstances(camPos) {
        if (!Grass.grassMI) return;
        const r = Math.ceil(Grass.renderDist / Grass.CHUNK_SIZE);
        const ccx = Math.floor(camPos.x / Grass.CHUNK_SIZE);
        const ccz = Math.floor(camPos.z / Grass.CHUNK_SIZE);
        const distSq = Grass.renderDist * Grass.renderDist;

        let write = 0;
        for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
                const cx = ccx + dx, cz = ccz + dz;
                const nx = Math.max(cx * Grass.CHUNK_SIZE, Math.min(camPos.x, (cx + 1) * Grass.CHUNK_SIZE));
                const nz = Math.max(cz * Grass.CHUNK_SIZE, Math.min(camPos.z, (cz + 1) * Grass.CHUNK_SIZE));
                const ddx = camPos.x - nx, ddz = camPos.z - nz;
                if (ddx * ddx + ddz * ddz > distSq) continue;

                const data = Grass.getChunk(cx, cz);
                const n = data.length / 8;
                for (let i = 0; i < n; i++) {
                    if (write >= Grass.MAX_INSTANCES) break;
                    const o = i * 8;
                    const ex = data[o] - camPos.x, ez = data[o + 2] - camPos.z;
                    if (ex * ex + ez * ez > distSq) continue;
                    Grass.cpuData.set(data.subarray(o, o + 8), write * 8);
                    write++;
                }
            }
        }

        if (write > 0) {
            new Float32Array(Grass.instanceBuffer.lock(), 0, write * 8).set(Grass.cpuData.subarray(0, write * 8));
            Grass.instanceBuffer.unlock();
        }
        Grass.grassMI.instancingCount = write;
        Grass.grassMI.visible = write > 0;

        if (Grass.chunkCache.size > 4096) {
            for (const key of Grass.chunkCache.keys()) {
                const parts = key.split(',');
                if (Math.abs(+parts[0] - ccx) > r + 2 || Math.abs(+parts[1] - ccz) > r + 2) Grass.chunkCache.delete(key);
            }
        }

        console.log("Grass instances:", write, "Chunks cached:", Grass.chunkCache.size);
    }

    constructor()
    {
        this.time = 0;

        SCRIPTS_TO_UPDATE.push(this);
    }

    update(dt)
    {
        this.time += dt;
        Grass.material.setParameter('uTime', this.time);
        Grass.material.setParameter('uRenderDist', Grass.renderDist);
        Grass.material.setParameter('uCollisionStrength', Grass.collisionStrength);

        let p;
        if(!client || !client.mPlayer || !client.mPlayer.entity) {
            p = camera.entity.getPosition();
        } else {
            p = client.mPlayer.entity.getPosition();
        }
        const ccx = Math.floor(p.x / Grass.CHUNK_SIZE), ccz = Math.floor(p.z / Grass.CHUNK_SIZE);
        if (ccx !== Grass.lastChunkX || ccz !== Grass.lastChunkZ || Grass.renderDist !== Grass.lastDist || Grass.densityPerM2 !== Grass.lastDensity) {
            if (Grass.densityPerM2 !== Grass.lastDensity) Grass.chunkCache.clear();
            Grass.lastChunkX = ccx;
            Grass.lastChunkZ = ccz;
            Grass.lastDist = Grass.renderDist;
            Grass.lastDensity = Grass.densityPerM2;
            Grass.rebuildInstances(p);
        }

        const colliders = [
            { x: p.x, y: p.y, z: p.z, radius: 1.0 }
        ];
        Grass.setGrassColliders(colliders);
    }
}