const pc = require('./playcanvas.js');

let tempVec = new pc.Vec3();
let tempVec2 = new pc.Vec3();

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
//    - Blade storage is ONE flat Float32Array per patch (16 floats /
//      blade, column-major world matrix) — no per-blade pc.Mat4
//      objects, no pointer chase during scans.
//    - Each patch buckets its blades into a uniform grid
//      (opts.cellSize, default 2 m, capped at 256x256 cells), so
//      querySphere / queryRadius / cutRadius visit only the cells the
//      circle overlaps: O(cells + hits) instead of O(liveCount).
//    - querySphereAll / queryRadiusAll accept an optional `out` array
//      so per-tick callers can reuse one buffer and avoid GC churn.
//    - Grass.benchmarkQueries(calls, radius) measures the real per-call
//      cost on the CURRENT patch layout (µs/call + avg hits).
//
//  DETERMINISTIC SCATTER (blade index parity across machines):
//    Every patch owns a seeded PRNG (opts.seed; fromTexture defaults
//    the seed to a hash of the mask filename, plain patches to a hash
//    of their bounds — so server and client agree without passing
//    anything). scatter/scatterMasked draw from it instead of
//    Math.random(), so given the same seed + same count + same mask,
//    blade slot i holds the SAME blade (same matrix) on every machine.
//    That makes slot indices a shared vocabulary: the server can
//    broadcast "cut blades [i, j, k]" and clients remove exactly those.
//
//    Index-parity contract (what you must keep identical everywhere):
//      - the seed, the mask image, and the initial scatter count
//      - the SEQUENCE of blade add/remove operations afterwards
//        (freeList reuse means later adds fill holes in removal order)
//    Note scatterMasked always spawns the FULL deterministic set, then
//    culls blades sitting on mowed pixels — so slot layout is identical
//    regardless of how mowed the field is when a player streams in.
//
//  CUT RASTER (persistent mowing state, mask-aligned):
//    Every mask patch owns a bitset with 1 bit per mask pixel
//    (row-major, index = py * w + px, 1 = mowed). After scatterMasked
//    spawns the full deterministic set, blades on mowed pixels are
//    culled — a player streaming in a half-mowed field sees the cuts.
//
//    - cutRadius(x, z, r, outIndices) removes blades, rasterizes the
//      circle into the bitset, and (optionally) collects the cut slot
//      indices for broadcasting.
//    - cutBlade(i) / cutBlades([i...]) — receiver side of an index
//      broadcast: removes those exact blades AND marks each blade's
//      pixel in the raster.
//    - Cuts that arrive while fromTexture is still decoding pixels are
//      queued and applied after the mask lands — the pre-mask patch
//      rectangle is wrong, so nothing is applied early.
//
//    Load with existing cuts:
//        Grass.fromTexture(url, count, {
//            seed: 1234,                       // optional, see above
//            cutRaster: bitsOrBase64,          // snapshot from server
//            cuts: [{ x, z, r }, ...]          // and/or circle list
//        });
//
//    Typical broadcast flow (server authoritative):
//        // server
//        const idx = [];
//        patch.cutRadius(x, z, r, idx);
//        send({ x, z, r, idx });
//        // client
//        patch.cutBlades(msg.idx);       // exact same blades die
//        patch.markCutCircle(msg.x, msg.z, msg.r);  // optional: full
//                                        // circle raster parity (cutBlades
//                                        // alone marks only blade pixels)
//
//    API:
//        patch.cutRadius(x, z, r, out?)    cut circle; out collects indices
//        patch.cutBlade(i)                 remove blade i + mark its pixel
//        patch.cutBlades([i...])           batch version, returns count
//        patch.markCutCircle(x, z, r)      rasterize a circle (bits only)
//        patch.applyCutRaster(bits|b64)    OR a raster in; culls any
//                                          already-spawned blades on it
//        patch.applyCuts([{x,z,r}])        replay circles via cutRadius
//        patch.getCutRaster()              -> Uint8Array (live ref)
//        patch.getCutRasterBase64()        -> string for the wire
//        patch.isCutAt(x, z)               -> bool
//        patch.clearCuts()                 regrowth: forget all cuts
//        maskTest(x, z)                    false on cut pixels
//
//    NOTE: cut coordinates are in the same flipped-Z world space the
//    blades live in (what cutRadius already receives) — NOT the raw
//    filename bounds. Indices are PER PATCH — key broadcasts by patch
//    (e.g. by mask url) when running several.
//
//  Server requires:  npm install pngjs     (masks must be PNG)
// =====================================================================

// ---------------------------------------------------------------------
//  environment detection (headless = no rendering; pc math still used)
// ---------------------------------------------------------------------
const GRASS_HEADLESS = true;

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

        // scratch objects — reused by addBladeTRS/scatter and the grid
        // range clamp so steady-state blade ops allocate nothing
        Grass._tmpMat4  = new pc.Mat4();
        Grass._tmpQuat  = new pc.Quat();
        Grass._tmpVec3a = new pc.Vec3();
        Grass._tmpVec3b = new pc.Vec3();
        Grass._cellRange = new Int32Array(4);

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

    //  opts extras (on top of the constructor opts):
    //    cutRaster : Uint8Array | base64 string — mask-aligned cut bitset
    //                (1 bit per mask pixel, 1 = mowed). Applied BEFORE
    //                scatter, so mowed blades are never spawned.
    //    cuts      : [{ x, z, r }] — cut circles in world space (same
    //                space cutRadius uses). Rasterized before scatter.
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

        // deterministic default seed: hash of the mask FILENAME, so server
        // and every client agree without exchanging anything
        if (patchOpts.seed === undefined) patchOpts.seed = Grass._hashString(file);

        const patch = new Grass(minX + width * 0.5, minZ + depth * 0.5,
                                width, depth, count, patchOpts);

        // until the mask lands, the patch rectangle is provisional and
        // cuts can't be rasterized — queue them (see cutRadius /
        // markCutCircle / applyCutRaster)
        patch._maskPending = true;

        Grass._loadPixels(url).then((pixels) => {
            if (patch.destroyed) return;
            patch._buildMask(pixels, minX, minZ, maxX, maxZ, opts);

            // 1) cut BITS supplied at load time or queued while decoding
            //    (no blades exist yet — these only mark the raster)
            if (opts.cutRaster) patch.applyCutRaster(opts.cutRaster);
            if (opts.cuts) {
                for (let i = 0; i < opts.cuts.length; i++) {
                    const c = opts.cuts[i];
                    patch.markCutCircle(c.x, c.z, c.r !== undefined ? c.r : c.radius);
                }
            }

            const rasters = patch._pendingRaster;
            patch._pendingRaster = [];
            for (let i = 0; i < rasters.length; i++) patch.applyCutRaster(rasters[i]);

            const circles = patch._pendingCuts;
            patch._pendingCuts = [];
            for (let i = 0; i < circles.length; i++) {
                patch.markCutCircle(circles[i].x, circles[i].z, circles[i].r);
            }

            // 2) scatter the FULL deterministic set (slot layout identical
            //    on every machine), then cull blades on mowed pixels
            patch.scatterMasked(count);

            // 3) index-based cuts that arrived while pixels were decoding
            //    — valid now that the deterministic blade array exists
            patch._maskPending = false;
            const bladeCuts = patch._pendingBladeCuts;
            patch._pendingBladeCuts = [];
            if (bladeCuts.length > 0) patch.cutBlades(bladeCuts);
        }).catch((e) => {
            patch._maskPending = false;
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

    // convenience: cut across every patch (e.g. explosion).
    // outIndices is passed through, but indices are PER PATCH — if the
    // circle can touch more than one patch, collect per patch instead:
    //   for (const p of Grass.patches) {
    //       const idx = [];
    //       if (p.cutRadius(x, z, r, idx) > 0) msg.push({ patch: id(p), idx });
    //   }
    static cutRadiusAll(x, z, radius, outIndices) {
        let cut = 0;
        const ps = Grass.patches;
        for (let i = 0; i < ps.length; i++) {
            cut += ps[i].cutRadius(x, z, radius, outIndices);
        }
        return cut;
    }

    static getTotalBladeCount() {
        let n = 0;
        for (const p of Grass.patches) n += p.getBladeCount();
        return n;
    }

    static terrainHeight(x, z) {
        tempVec.set(x, 50, z);
        tempVec2.set(x, -50, z);
        const r = global.main.app.systems.rigidbody.raycastFirst(tempVec, tempVec2);
        if (r && r.point) return r.point.y;

        // If no results, default to 0
        return 0;
    }

    // ------------------------------------------------------------------
    //  deterministic PRNG (mulberry32) + string hash (FNV-1a)
    // ------------------------------------------------------------------
    static _mulberry32(seed)
    {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    static _hashString(s)
    {
        let h = 0x811C9DC5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    // ------------------------------------------------------------------
    //  base64 <-> bitset helpers (both envs) — for shipping cut rasters
    // ------------------------------------------------------------------
    static _bitsToBase64(bits)
    {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bits.buffer, bits.byteOffset, bits.byteLength)
                         .toString('base64');
        }
        let s = '';
        for (let i = 0; i < bits.length; i++) s += String.fromCharCode(bits[i]);
        return btoa(s);
    }

    static _base64ToBits(b64)
    {
        if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(b64, 'base64'));
        }
        const s = atob(b64);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    }

    // ------------------------------------------------------------------
    //  COLLISION QUERIES (server-friendly, also work on the client)
    // ------------------------------------------------------------------
    //  Sphere vs all patches. Patches whose rectangle is farther than
    //  `radius` from the sphere centre are rejected without touching a
    //  single blade, so far-away patches cost one distance check.
    //  Returns: [{ patch, index, x, y, z, height, distSq }, ...]
    //  Pass a reusable `out` array (cleared by the caller) to avoid a
    //  fresh allocation per tick.
    static querySphereAll(cx, cy, cz, radius, out)
    {
        out = out || [];
        const ps = Grass.patches;
        for (let i = 0; i < ps.length; i++) ps[i].querySphere(cx, cy, cz, radius, out);
        return out;
    }

    // 2D (XZ) variant — ignores height entirely.
    static queryRadiusAll(x, z, radius, out)
    {
        out = out || [];
        const ps = Grass.patches;
        for (let i = 0; i < ps.length; i++) ps[i].queryRadius(x, z, radius, out);
        return out;
    }

    //  Measure the real per-query cost on the CURRENT patch layout:
    //      Grass.benchmarkQueries(10000, 1.5)
    //          -> { calls, usPerCall, hitsPerCall, totalMs }
    //  Query points are sampled inside random patch rectangles (i.e. the
    //  expensive case — every call passes the rect quick-reject).
    static benchmarkQueries(calls, radius)
    {
        calls = calls || 10000;
        radius = radius !== undefined ? radius : 1.5;
        const ps = Grass.patches;
        if (ps.length === 0) return null;

        const now = (typeof performance !== 'undefined' && performance.now)
            ? () => performance.now()
            : () => Number(process.hrtime.bigint()) / 1e6;

        const out = [];
        let hits = 0;
        const t0 = now();
        for (let i = 0; i < calls; i++) {
            const p = ps[(Math.random() * ps.length) | 0];
            const x = p.centerX + (Math.random() - 0.5) * p.width;
            const z = p.centerZ + (Math.random() - 0.5) * p.depth;
            out.length = 0;
            Grass.querySphereAll(x, 0.5, z, radius, out);
            hits += out.length;
        }
        const totalMs = now() - t0;
        return {
            calls,
            usPerCall: (totalMs * 1000) / calls,
            hitsPerCall: hits / calls,
            totalMs
        };
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
    //  (fromTexture additionally accepts: cutRaster, cuts — see there)
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

        // flat blade storage — 16 floats (column-major world matrix) per
        // slot. Handle = slot index, exactly as before.
        this.bladeData = new Float32Array(this.capacity * 16);
        this.alive     = new Uint8Array(this.capacity);
        this.freeList  = [];
        this.liveCount = 0;      // high-water mark: slots 0..liveCount-1 allocated
        this.dirty = false;
        this.matrixData = GRASS_HEADLESS ? null : new Float32Array(this.capacity * 16);

        // deterministic per-patch PRNG — same seed => identical scatter =>
        // blade slot i is the same blade on every machine. opts.seed may be
        // a number or string; default hashes the patch bounds (fromTexture
        // overrides with a hash of the mask filename).
        const rawSeed = opts.seed !== undefined
            ? opts.seed
            : (centerX + ',' + centerZ + ',' + width + ',' + depth);
        this.seed = (typeof rawSeed === 'string')
            ? Grass._hashString(rawSeed)
            : (rawSeed >>> 0);
        this._rand = Grass._mulberry32(this.seed);

        // mask + cut raster state (mask patches only; see fromTexture)
        this.mask = null;
        this.cutBits = null;          // 1 bit per mask pixel, 1 = mowed
        this._anyCuts = false;        // any bit set in cutBits?
        this._maskPending = false;    // fromTexture: pixels still decoding
        this._pendingCuts = [];       // circles queued while _maskPending
        this._pendingRaster = [];     // rasters queued while _maskPending
        this._pendingBladeCuts = [];  // blade indices queued while _maskPending

        // uniform grid over the patch rectangle — blades bucketed by
        // cell so queries/cuts only visit overlapping cells
        this.cellSize  = opts.cellSize !== undefined ? Math.max(0.25, opts.cellSize) : 2.0;
        this.bladeCell = new Int32Array(this.capacity).fill(-1); // slot -> cell (-1 = none)
        this.bladeSlot = new Int32Array(this.capacity);          // slot -> pos in cell array
        this.grid = null;
        this._rebuildGrid();
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
    //  mask building — takes decoded pixels ({data, w, h}) so the same
    //  code path serves the browser canvas AND the Node png decode
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
            cells,             // ALL spawnable pixel indices (never mutated)
            data, w, h,
            minX, minZ, maxX, maxZ, flipZ,
            cellW: (maxX - minX) / w,
            cellD: (maxZ - minZ) / h,
            sc, tol
        };

        // cut raster: 1 bit per mask pixel, row-major (py * w + px)
        this.cutBits = new Uint8Array((w * h + 7) >> 3);
        this._anyCuts = false;

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

            // patch rect changed -> grid geometry changed. Cheap here:
            // fromTexture scatters AFTER the mask lands, so the grid is
            // normally rebuilt while empty.
            this._rebuildGrid();

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
    //  CUT RASTER — persistent mowing state, aligned to the mask grid
    //
    //  cutBits[idx >> 3] & (1 << (idx & 7)), idx = py * w + px, 1 = cut.
    //  The bits are the source of truth; mask.openCells is a derived
    //  list rebuilt lazily (only when a scatter actually needs it), so
    //  live mowing stays cheap: cutRadius just sets bits.
    // ------------------------------------------------------------------
    _ensureCutBits()
    {
        if (!this.cutBits && this.mask) {
            this.cutBits = new Uint8Array((this.mask.w * this.mask.h + 7) >> 3);
        }
        return this.cutBits;
    }

    //  world (x, z) -> mask pixel index (py * w + px), or -1 if outside
    _maskPixelIndex(x, z)
    {
        const mk = this.mask;
        if (!mk) return -1;
        const px = Math.floor((x - mk.minX) / mk.cellW);
        let   py = Math.floor((z - mk.minZ) / mk.cellD);
        if (mk.flipZ) py = mk.h - 1 - py;
        if (px < 0 || px >= mk.w || py < 0 || py >= mk.h) return -1;
        return py * mk.w + px;
    }

    //  Rasterize a world-space circle into the cut bits. Does NOT remove
    //  blades (cutRadius does both). Returns pixels newly marked.
    //  Before the mask lands (fromTexture still decoding) the circle is
    //  queued and applied automatically once pixels arrive.
    markCutCircle(x, z, radius)
    {
        const mk = this.mask;
        if (!mk) {
            if (this._maskPending) this._pendingCuts.push({ x: x, z: z, r: radius });
            return 0;
        }
        const bits = this._ensureCutBits();
        const r2 = radius * radius;

        // cellW/cellD can be NEGATIVE (fromTexture's Z flip), so compute
        // both ends of the pixel range and sort
        const pxA = Math.floor((x - radius - mk.minX) / mk.cellW);
        const pxB = Math.floor((x + radius - mk.minX) / mk.cellW);
        const rwA = Math.floor((z - radius - mk.minZ) / mk.cellD);
        const rwB = Math.floor((z + radius - mk.minZ) / mk.cellD);
        let px0 = Math.min(pxA, pxB), px1 = Math.max(pxA, pxB);
        let rw0 = Math.min(rwA, rwB), rw1 = Math.max(rwA, rwB);
        if (px1 < 0 || px0 >= mk.w || rw1 < 0 || rw0 >= mk.h) return 0;
        if (px0 < 0) px0 = 0;
        if (px1 >= mk.w) px1 = mk.w - 1;
        if (rw0 < 0) rw0 = 0;
        if (rw1 >= mk.h) rw1 = mk.h - 1;

        let marked = 0;
        for (let row = rw0; row <= rw1; row++) {
            const zc = mk.minZ + (row + 0.5) * mk.cellD;
            const dz = zc - z;
            const py = mk.flipZ ? (mk.h - 1 - row) : row;
            const rowBase = py * mk.w;
            for (let px = px0; px <= px1; px++) {
                const xc = mk.minX + (px + 0.5) * mk.cellW;
                const dx = xc - x;
                if (dx * dx + dz * dz > r2) continue;
                const idx = rowBase + px;
                const m = 1 << (idx & 7);
                if (!(bits[idx >> 3] & m)) {
                    bits[idx >> 3] |= m;
                    marked++;
                }
            }
        }
        if (marked > 0) this._anyCuts = true;
        return marked;
    }

    //  Receiver side of an index broadcast: remove blade `index` and mark
    //  its pixel in the cut raster so re-scatters won't respawn it.
    //  Only meaningful when the sender's blade array is identical (same
    //  seed / count / mask — see the determinism notes in the header).
    //  Queued if the mask is still decoding; applied after scatter.
    cutBlade(index)
    {
        if (this._maskPending) {
            this._pendingBladeCuts.push(index);
            return false;
        }
        if (index < 0 || index >= this.liveCount || !this.alive[index]) return false;

        if (this.mask) {
            const o = index * 16;
            const idx = this._maskPixelIndex(this.bladeData[o + 12],
                                             this.bladeData[o + 14]);
            if (idx >= 0) {
                const bits = this._ensureCutBits();
                bits[idx >> 3] |= 1 << (idx & 7);
                this._anyCuts = true;
            }
        }
        return this.removeBlade(index);
    }

    //  Batch version — returns how many were actually removed (indices
    //  already dead are skipped, so replayed messages are harmless).
    cutBlades(indices)
    {
        let n = 0;
        for (let k = 0; k < indices.length; k++) {
            if (this.cutBlade(indices[k])) n++;
        }
        return n;
    }

    //  OR an external cut raster (Uint8Array or base64 string, same
    //  layout as getCutRaster()) into this patch. If blades are already
    //  spawned, any blade standing on a cut pixel is removed. Queued if
    //  the mask hasn't landed yet.
    applyCutRaster(raster)
    {
        if (!this.mask) {
            if (this._maskPending) this._pendingRaster.push(raster);
            else console.warn('[grass] applyCutRaster: patch has no mask');
            return 0;
        }

        const src = (typeof raster === 'string')
            ? Grass._base64ToBits(raster)
            : raster;
        const bits = this._ensureCutBits();

        if (src.length !== bits.length) {
            console.warn('[grass] applyCutRaster: size mismatch (' + src.length +
                         ' vs ' + bits.length + ' bytes) — mask resolution changed?');
        }

        const n = Math.min(bits.length, src.length);
        for (let i = 0; i < n; i++) bits[i] |= src[i];
        this._anyCuts = true;

        // late application: cull blades already standing on cut pixels
        if (this.getBladeCount() > 0) return this._cutBladesOnRaster();
        return 0;
    }

    //  Replay a list of cut circles through cutRadius (removes blades AND
    //  marks the raster). For post-load live sync; at load time prefer
    //  passing opts.cuts / opts.cutRaster to fromTexture instead.
    applyCuts(circles)
    {
        let cut = 0;
        for (let i = 0; i < circles.length; i++) {
            const c = circles[i];
            cut += this.cutRadius(c.x, c.z, c.r !== undefined ? c.r : c.radius);
        }
        return cut;
    }

    //  Remove every live blade whose mask pixel is flagged cut.
    _cutBladesOnRaster()
    {
        const mk = this.mask, bits = this.cutBits, bd = this.bladeData;
        let cut = 0;
        for (let i = 0; i < this.liveCount; i++) {
            if (!this.alive[i]) continue;
            const o = i * 16;
            const px = Math.floor((bd[o + 12] - mk.minX) / mk.cellW);
            let   py = Math.floor((bd[o + 14] - mk.minZ) / mk.cellD);
            if (mk.flipZ) py = mk.h - 1 - py;
            if (px < 0 || px >= mk.w || py < 0 || py >= mk.h) continue;
            const idx = py * mk.w + px;
            if (bits[idx >> 3] & (1 << (idx & 7))) {
                this.removeBlade(i);
                cut++;
            }
        }
        return cut;
    }

    //  World position -> is that pixel mowed? (false if no mask/raster)
    isCutAt(x, z)
    {
        const mk = this.mask;
        if (!mk || !this.cutBits) return false;

        const px = Math.floor((x - mk.minX) / mk.cellW);
        let   py = Math.floor((z - mk.minZ) / mk.cellD);
        if (mk.flipZ) py = mk.h - 1 - py;
        if (px < 0 || px >= mk.w || py < 0 || py >= mk.h) return false;

        const idx = py * mk.w + px;
        return (this.cutBits[idx >> 3] & (1 << (idx & 7))) !== 0;
    }

    //  Live bitset reference (null before the mask lands). Layout:
    //  1 bit per mask pixel, row-major, idx = py * w + px, LSB-first.
    getCutRaster()
    {
        return this._ensureCutBits();
    }

    //  Wire-friendly snapshot for the server / other clients.
    getCutRasterBase64()
    {
        const bits = this._ensureCutBits();
        return bits ? Grass._bitsToBase64(bits) : null;
    }

    //  Regrowth: forget every cut. Does NOT respawn blades — call
    //  scatterMasked() afterwards if you want them back.
    clearCuts()
    {
        if (this.cutBits) this.cutBits.fill(0);
        this._anyCuts = false;
        this._pendingCuts.length = 0;
        this._pendingRaster.length = 0;
        this._pendingBladeCuts.length = 0;
    }

    // ------------------------------------------------------------------
    //  blade management (all patch-local)
    //
    //  Storage: ONE flat Float32Array, 16 floats (column-major world
    //  matrix) per slot. `alive` flags mark holes left by cuts; handles
    //  are slot indices, same contract as before.
    //
    //  Spatial index: a uniform grid over the patch rectangle. Each cell
    //  holds an array of blade indices; membership is maintained with
    //  O(1) swap-pop removal via bladeCell/bladeSlot. Blades placed
    //  outside the rectangle clamp into the nearest edge cell — queries
    //  clamp their cell range the same way, so nothing is missed (the
    //  final distance test filters, exactly like the old linear scan).
    // ------------------------------------------------------------------

    // ---- uniform grid -----------------------------------------------
    _rebuildGrid()
    {
        const MAX_AXIS = 256; // cap grid memory for very large patches
        const w = Math.max(this.width, 1e-6);
        const d = Math.max(this.depth, 1e-6);
        const nx = Math.min(MAX_AXIS, Math.max(1, Math.ceil(w / this.cellSize)));
        const nz = Math.min(MAX_AXIS, Math.max(1, Math.ceil(d / this.cellSize)));

        this.grid = {
            nx, nz,
            x0: this.centerX - this.width * 0.5,
            z0: this.centerZ - this.depth * 0.5,
            invX: nx / w,
            invZ: nz / d,
            cells: new Array(nx * nz).fill(null)
        };

        // re-insert every live blade (usually rebuilt while empty)
        this.bladeCell.fill(-1);
        const bd = this.bladeData;
        for (let i = 0; i < this.liveCount; i++) {
            if (!this.alive[i]) continue;
            this._gridInsert(i, bd[i * 16 + 12], bd[i * 16 + 14]);
        }
    }

    _cellOf(x, z)
    {
        const g = this.grid;
        let px = ((x - g.x0) * g.invX) | 0;
        let pz = ((z - g.z0) * g.invZ) | 0;
        if (px < 0) px = 0; else if (px >= g.nx) px = g.nx - 1;
        if (pz < 0) pz = 0; else if (pz >= g.nz) pz = g.nz - 1;
        return pz * g.nx + px;
    }

    _gridInsert(i, x, z)
    {
        const cell = this._cellOf(x, z);
        let arr = this.grid.cells[cell];
        if (!arr) arr = this.grid.cells[cell] = [];
        this.bladeSlot[i] = arr.length;
        arr.push(i);
        this.bladeCell[i] = cell;
    }

    _gridRemove(i)
    {
        const cell = this.bladeCell[i];
        if (cell < 0) return;
        const arr = this.grid.cells[cell];
        const slot = this.bladeSlot[i];
        const last = arr.pop();
        if (last !== i) {              // swap-pop: move tail into the hole
            arr[slot] = last;
            this.bladeSlot[last] = slot;
        }
        this.bladeCell[i] = -1;
    }

    //  clamped cell range of a circle -> out = [px0, px1, pz0, pz1]
    _cellRangeInto(x, z, radius, out)
    {
        const g = this.grid;
        let a = ((x - radius - g.x0) * g.invX) | 0;
        let b = ((x + radius - g.x0) * g.invX) | 0;
        let c = ((z - radius - g.z0) * g.invZ) | 0;
        let e = ((z + radius - g.z0) * g.invZ) | 0;
        out[0] = a < 0 ? 0 : (a >= g.nx ? g.nx - 1 : a);
        out[1] = b < 0 ? 0 : (b >= g.nx ? g.nx - 1 : b);
        out[2] = c < 0 ? 0 : (c >= g.nz ? g.nz - 1 : c);
        out[3] = e < 0 ? 0 : (e >= g.nz ? g.nz - 1 : e);
    }

    // ---- add / remove -----------------------------------------------
    addBlade(mat4) {
        let index;
        if (this.freeList.length > 0) {
            index = this.freeList.pop();
        } else {
            if (this.liveCount >= this.capacity) return -1;
            index = this.liveCount++;
        }
        const d = mat4.data;
        this.bladeData.set(d, index * 16);
        this.alive[index] = 1;
        this._gridInsert(index, d[12], d[14]);
        this.dirty = true;
        return index;
    }

    //  internal fast path — writes a TRS blade without allocating
    _addBladeXZ(x, y, z, rotDegY, sx, sy, sz)
    {
        const p = Grass._tmpVec3a.set(x, y, z);
        const s = Grass._tmpVec3b.set(sx, sy, sz);
        Grass._tmpQuat.setFromEulerAngles(0, rotDegY, 0);
        Grass._tmpMat4.setTRS(p, Grass._tmpQuat, s);
        return this.addBlade(Grass._tmpMat4);
    }

    addBladeTRS(pos, rotDegY, scale) {
        if (typeof scale === 'number') {
            return this._addBladeXZ(pos.x, pos.y, pos.z, rotDegY || 0,
                                    scale, scale, scale);
        }
        const s = scale || Grass._tmpVec3b.set(1, 1, 1);
        return this._addBladeXZ(pos.x, pos.y, pos.z, rotDegY || 0,
                                s.x, s.y, s.z);
    }

    addBlades(mat4Array) {
        const handles = [];
        for (let i = 0; i < mat4Array.length; i++) {
            handles.push(this.addBlade(mat4Array[i]));
        }
        return handles;
    }

    // scatter `count` blades inside THIS patch's rectangle.
    // Uses the patch's seeded PRNG: same seed + same call sequence =>
    // identical blades at identical slots on every machine.
    scatter(count) {
        const rand = this._rand;
        const handles = [];
        for (let i = 0; i < count; i++) {
            const x = this.centerX + (rand() - 0.5) * this.width;
            const z = this.centerZ + (rand() - 0.5) * this.depth;
            const h = this.minH + rand() * (this.maxH - this.minH);
            const w = this.minW + rand() * (this.maxW - this.minW);
            handles.push(this._addBladeXZ(x, this.heightFn(x, z), z,
                                          rand() * 360, w, h, w));
        }
        return handles;
    }

    // Scatter `count` blades on matching pixels — the FULL deterministic
    // set, always sampled from the complete cell list so slot layout is
    // identical on every machine regardless of mowing state. Blades that
    // land on mowed pixels are culled immediately after (their slots go
    // to the freeList in ascending order — also deterministic).
    // Returned handles are the raw slot assignments; some may already be
    // dead if they landed on cut pixels.
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

        const cells = mk.cells;
        const rand = this._rand;
        const handles = [];
        for (let i = 0; i < count; i++) {
            const cell = cells[(rand() * cells.length) | 0];
            const px = cell % mk.w;
            const py = (cell / mk.w) | 0;

            const x   = mk.minX + (px + rand()) * mk.cellW;
            const row = mk.flipZ ? (mk.h - 1 - py) : py;
            const z   = mk.minZ + (row + rand()) * mk.cellD;

            const hgt = this.minH + rand() * (this.maxH - this.minH);
            const wdt = this.minW + rand() * (this.maxW - this.minW);
            handles.push(this._addBladeXZ(x, this.heightFn(x, z), z,
                                          rand() * 360, wdt, hgt, wdt));
        }

        // cull blades standing on mowed pixels (no PRNG involved — slot
        // parity with other machines is unaffected)
        if (this._anyCuts) this._cutBladesOnRaster();

        return handles;
    }

    removeBlade(index) {
        if (index < 0 || index >= this.liveCount || !this.alive[index]) return false;
        this.alive[index] = 0;
        this._gridRemove(index);
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

    //  Cut every blade within `radius` of (x, z). Returns the count.
    //  Pass `outIndices` (an array you clear/reuse) to also collect the
    //  slot indices of the cut blades — with deterministic scatter these
    //  indices identify the same blades on every machine, so the server
    //  can broadcast them and clients apply with cutBlades(indices).
    cutRadius(x, z, radius, outIndices) {
        // mask still decoding: no blades exist and the patch rectangle is
        // provisional — queue the circle, it lands before scatter
        if (this._maskPending) {
            this._pendingCuts.push({ x: x, z: z, r: radius });
            return 0;
        }

        if (this._rectCircleReject(x, z, radius)) return 0;

        // persist into the cut raster so re-scatters / snapshots see it
        if (this.mask) this.markCutCircle(x, z, radius);

        const g = this.grid, bd = this.bladeData;
        const r2 = radius * radius;
        const rng = Grass._cellRange;
        this._cellRangeInto(x, z, radius, rng);

        let cut = 0;
        for (let pz = rng[2]; pz <= rng[3]; pz++) {
            const rowBase = pz * g.nx;
            for (let px = rng[0]; px <= rng[1]; px++) {
                const arr = g.cells[rowBase + px];
                if (!arr) continue;
                // iterate backwards: swap-pop moves an already-visited
                // survivor into the freed slot, which we then skip
                for (let j = arr.length - 1; j >= 0; j--) {
                    const i = arr[j];
                    const o = i * 16;
                    const dx = bd[o + 12] - x, dz = bd[o + 14] - z;
                    if (dx * dx + dz * dz <= r2) {
                        const last = arr.pop();
                        if (last !== i) {
                            arr[j] = last;
                            this.bladeSlot[last] = j;
                        }
                        this.bladeCell[i] = -1;
                        this.alive[i] = 0;
                        this.freeList.push(i);
                        if (outIndices) outIndices.push(i);
                        cut++;
                    }
                }
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
    //  - Grid-level: only the cells the circle overlaps are walked, so
    //    the cost is O(overlapping cells + hits) — independent of how
    //    many blades the patch holds.
    //  - Each blade is treated as a vertical segment from its base up to
    //    base + sharedBladeHeight * scaleY (matches the rendered blade,
    //    ignoring wind sway).
    //  Appends hits to `out` (created if omitted) and returns it.
    //  Hit: { patch, index, x, y, z, height, distSq }
    querySphere(cx, cy, cz, radius, out)
    {
        out = out || [];
        if (this._rectCircleReject(cx, cz, radius)) return out;

        const g = this.grid, bd = this.bladeData;
        const r2 = radius * radius;
        const bladeH = Grass.sharedBladeHeight;
        const rng = Grass._cellRange;
        this._cellRangeInto(cx, cz, radius, rng);

        for (let pz = rng[2]; pz <= rng[3]; pz++) {
            const rowBase = pz * g.nx;
            for (let px = rng[0]; px <= rng[1]; px++) {
                const arr = g.cells[rowBase + px];
                if (!arr) continue;
                for (let j = 0; j < arr.length; j++) {
                    const i = arr[j];
                    const o = i * 16;
                    const bx = bd[o + 12], by = bd[o + 13], bz = bd[o + 14];

                    // cheap XZ reject before touching Y
                    const dx = bx - cx, dz = bz - cz;
                    const xz2 = dx * dx + dz * dz;
                    if (xz2 > r2) continue;

                    // blade height in world units = mesh height * Y scale
                    // (Y scale = length of the matrix's Y basis column)
                    const sy = Math.sqrt(bd[o + 4] * bd[o + 4] +
                                         bd[o + 5] * bd[o + 5] +
                                         bd[o + 6] * bd[o + 6]);
                    const top = by + bladeH * sy;

                    // closest point on the vertical segment to the centre
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
            }
        }
        return out;
    }

    //  2D variant: everything within `radius` of (x, z), height ignored.
    queryRadius(x, z, radius, out)
    {
        out = out || [];
        if (this._rectCircleReject(x, z, radius)) return out;

        const g = this.grid, bd = this.bladeData;
        const r2 = radius * radius;
        const rng = Grass._cellRange;
        this._cellRangeInto(x, z, radius, rng);

        for (let pz = rng[2]; pz <= rng[3]; pz++) {
            const rowBase = pz * g.nx;
            for (let px = rng[0]; px <= rng[1]; px++) {
                const arr = g.cells[rowBase + px];
                if (!arr) continue;
                for (let j = 0; j < arr.length; j++) {
                    const i = arr[j];
                    const o = i * 16;
                    const dx = bd[o + 12] - x, dz = bd[o + 14] - z;
                    const distSq = dx * dx + dz * dz;
                    if (distSq <= r2) {
                        out.push({
                            patch: this, index: i,
                            x: bd[o + 12], y: bd[o + 13], z: bd[o + 14],
                            distSq
                        });
                    }
                }
            }
        }
        return out;
    }

    //  nearest blade to (x, z). With maxDist: grid-limited (fast).
    //  Without: full scan of the flat array (rarely the hot path).
    findBlade(x, z, maxDist) {
        const bd = this.bladeData;
        let best = -1;

        if (maxDist !== undefined) {
            let bestD = maxDist * maxDist;
            const g = this.grid;
            const rng = Grass._cellRange;
            this._cellRangeInto(x, z, maxDist, rng);

            for (let pz = rng[2]; pz <= rng[3]; pz++) {
                const rowBase = pz * g.nx;
                for (let px = rng[0]; px <= rng[1]; px++) {
                    const arr = g.cells[rowBase + px];
                    if (!arr) continue;
                    for (let j = 0; j < arr.length; j++) {
                        const i = arr[j];
                        const o = i * 16;
                        const dx = bd[o + 12] - x, dz = bd[o + 14] - z;
                        const dd = dx * dx + dz * dz;
                        if (dd < bestD) { bestD = dd; best = i; }
                    }
                }
            }
            return best;
        }

        let bestD = Infinity;
        for (let i = 0; i < this.liveCount; i++) {
            if (!this.alive[i]) continue;
            const o = i * 16;
            const dx = bd[o + 12] - x, dz = bd[o + 14] - z;
            const dd = dx * dx + dz * dz;
            if (dd < bestD) { bestD = dd; best = i; }
        }
        return best;
    }

    updateBlade(index, mat4) {
        if (index < 0 || index >= this.liveCount || !this.alive[index]) return false;
        const d = mat4.data;
        this.bladeData.set(d, index * 16);

        // migrate grid cell only if the blade actually moved cells
        const cell = this._cellOf(d[12], d[14]);
        if (cell !== this.bladeCell[index]) {
            this._gridRemove(index);
            let arr = this.grid.cells[cell];
            if (!arr) arr = this.grid.cells[cell] = [];
            this.bladeSlot[index] = arr.length;
            arr.push(index);
            this.bladeCell[index] = cell;
        }
        this.dirty = true;
        return true;
    }

    getBladePosition(index, out) {
        if (index < 0 || index >= this.liveCount || !this.alive[index]) return null;
        const o = index * 16;
        out = out || new pc.Vec3();
        out.set(this.bladeData[o + 12], this.bladeData[o + 13], this.bladeData[o + 14]);
        return out;
    }

    //  read a blade's full world matrix into `out` (pc.Mat4)
    getBladeMatrix(index, out) {
        if (index < 0 || index >= this.liveCount || !this.alive[index]) return null;
        out = out || new pc.Mat4();
        out.data.set(this.bladeData.subarray(index * 16, index * 16 + 16));
        return out;
    }

    clearBlades() {
        this.alive.fill(0);
        this.bladeCell.fill(-1);
        this.freeList.length = 0;
        this.liveCount = 0;
        if (this.grid) this.grid.cells.fill(null);
        this.dirty = true;
    }

    getBladeCount() {
        return this.liveCount - this.freeList.length;
    }

    // Utility: does world position (x, z) sit on a spawnable pixel that
    // has NOT been mowed?
    maskTest(x, z)
    {
        const mk = this.mask;
        if (!mk) return true;

        const px = Math.floor((x - mk.minX) / mk.cellW);
        let   py = Math.floor((z - mk.minZ) / mk.cellD);
        if (mk.flipZ) py = mk.h - 1 - py;
        if (px < 0 || px >= mk.w || py < 0 || py >= mk.h) return false;

        const i = (py * mk.w + px) * 4;
        if (Math.abs(mk.data[i]     - mk.sc[0]) > mk.tol ||
            Math.abs(mk.data[i + 1] - mk.sc[1]) > mk.tol ||
            Math.abs(mk.data[i + 2] - mk.sc[2]) > mk.tol) return false;

        // spawnable, but mowed?
        if (this.cutBits) {
            const idx = py * mk.w + px;
            if (this.cutBits[idx >> 3] & (1 << (idx & 7))) return false;
        }
        return true;
    }

    // ------------------------------------------------------------------
    //  GPU repack (client only; server has nothing to upload)
    // ------------------------------------------------------------------
    _repack()
    {
        if (GRASS_HEADLESS) { this.dirty = false; return; }
        if (!this.mi) return;

        let write;
        if (this.freeList.length === 0) {
            // no holes — blades 0..liveCount-1 are all alive, so the flat
            // array IS the instance data: one contiguous copy, done.
            write = this.liveCount;
            if (write > 0) {
                new Float32Array(this.instanceBuffer.lock(), 0, write * 16)
                    .set(this.bladeData.subarray(0, write * 16));
                this.instanceBuffer.unlock();
            }
        } else {
            // holes — compact live matrices into matrixData, then upload
            const bd = this.bladeData, md = this.matrixData;
            write = 0;
            for (let i = 0; i < this.liveCount; i++) {
                if (!this.alive[i]) continue;
                const src = i * 16, dst = write * 16;
                for (let k = 0; k < 16; k++) md[dst + k] = bd[src + k];
                write++;
            }
            if (write > 0) {
                new Float32Array(this.instanceBuffer.lock(), 0, write * 16)
                    .set(md.subarray(0, write * 16));
                this.instanceBuffer.unlock();
            }
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
        this.bladeData = null;
        this.alive = null;
        this.bladeCell = null;
        this.bladeSlot = null;
        this.grid = null;
        this.mask = null;
        this.cutBits = null;
        this.freeList.length = 0;
        this._pendingCuts.length = 0;
        this._pendingRaster.length = 0;
        this._pendingBladeCuts.length = 0;
    }
}

module.exports = Grass;