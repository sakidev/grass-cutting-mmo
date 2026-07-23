import { physics } from "./game.js";
import { injectCurvatureMaterial, TerrainMaterial } from "./shaders.js";

export { TerrainManager };

class TerrainManager
{
    constructor()
    {
        this.viewDistance = 50;
        this.chunkSize = 100;
        this.loadedChunks = new Map();   // Key: "chunkX,chunkY", Value: { modelAsset, instance }
        this.loadingChunks = new Set();  // Chunks currently being loaded (prevents double-loads)
    }

    /**
     * Call every frame with the player's world position.
     * Loads nearby chunks and unloads distant ones.
    */
    update(playerX, playerY)
    {
        // Imported tiles are inverted in the Z axis so invert the playerY to match the chunk coordinates
        playerY = -playerY;
        const neededChunks = this.getChunksInRange(playerX, playerY);

        // Load chunks that are in range but not yet loaded or loading
        for (const key of neededChunks) {
            if (!this.loadedChunks.has(key) && !this.loadingChunks.has(key)) {
                const [chunkX, chunkY] = key.split(',').map(Number);
                console.log("Loading chunk");
                this.loadChunk(chunkX, chunkY);
            }
        }

        // Unload chunks that are loaded but no longer in range
        for (const [key, chunk] of this.loadedChunks) {
            if (!neededChunks.has(key)) {
                this.unloadChunk(key);
            }
        }

        if(this.nebulaeSkybox)
        {
            // Rotate the nebulae skybox slowly for visual interest
            this.nebulaeSkybox.rotate(0, 0.1, 0);
        }
    }

    /**
     * Returns a Set of "chunkX,chunkY" keys for all chunks within view distance.
     */
    getChunksInRange(playerX, playerY)
    {
        const needed = new Set();
        const radius = this.viewDistance;
        const size = this.chunkSize;

        // Determine the grid range to check
        const minCX = Math.floor((playerX - radius) / size) * size;
        const maxCX = Math.floor((playerX + radius) / size) * size;
        const minCY = Math.floor((playerY - radius) / size) * size;
        const maxCY = Math.floor((playerY + radius) / size) * size;

        for (let cx = minCX; cx <= maxCX; cx += size) {
            for (let cy = minCY; cy <= maxCY; cy += size) {
                // Skip negative chunks (terrain starts at 0,0)
                if (cx < 0 || cy < 0) continue;

                // Distance from player to the nearest edge of this chunk
                const nearestX = Math.max(cx, Math.min(playerX, cx + size));
                const nearestY = Math.max(cy, Math.min(playerY, cy + size));
                const dist = Math.sqrt((playerX - nearestX) ** 2 + (playerY - nearestY) ** 2);

                if (dist <= radius) {
                    needed.add(`${cx},${cy}`);
                }
            }
        }

        return needed;
    }

    loadChunk(chunkX, chunkY)
    {
        const self = this;

        const key = `${chunkX},${chunkY}`;
        this.loadingChunks.add(key);

        loader.loadModel(`res/models/terrain_tiles/tile_${chunkX}_${chunkY}.glb`, `tile_${chunkX}_${chunkY}`, (modelAsset) => {
            this.loadingChunks.delete(key);

            // Check if chunk is still needed (player may have moved away during load)
            if (!this.loadingChunks.has(key) || this.loadedChunks.has(key)) {
                // Verify it's still wanted by checking if it wasn't unloaded in the meantime
            }

            const instance = modelAsset.instantiateRenderEntity();
            game.root.addChild(instance);

            // Initialize the terrain material
            instance.terrainMaterial = new TerrainMaterial(instance);

            this.loadedChunks.set(key, { modelAsset, instance });

            instance.addComponent("rigidbody", {
                    type: "static",
                });
            instance.addComponent("collision", {
                    type: "mesh",
                    renderAsset: instance.render.asset
            });

            //injectCurvatureMaterial(instance.render.meshInstances[0]);
        });
    }

    unloadChunk(key)
    {
        const chunk = this.loadedChunks.get(key);
        if (!chunk) return;

        // Remove from scene
        if (chunk.instance) {
            chunk.instance.destroy();
        }

        // Remove colliders from physics world
        /*if (chunk.colliders) {
            for (const collider of chunk.colliders) {
                physics.removeCollider(collider);
            }
        }*/

        this.loadedChunks.delete(key);
    }

    /**
     * Unload all chunks (e.g. on scene change).
     */
    destroy()
    {
        for (const key of this.loadedChunks.keys()) {
            this.unloadChunk(key);
        }
        this.loadingChunks.clear();
    }
}