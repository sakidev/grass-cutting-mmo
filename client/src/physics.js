export { Physics };

class Physics
{
    static async inject()
    {
        pc.WasmModule.setConfig('Ammo', {
            glueUrl: `js/ammo.wasm.js`,
            wasmUrl: `js/ammo.wasm.wasm`,
            fallbackUrl: `js/ammo.js`
        });
        const promise = new Promise((resolve)=>
        {
             pc.WasmModule.getInstance('Ammo', (e) => {
                console.log("Ammo loaded", e);
                resolve();
            });
        });
        return await promise;
    }

    constructor()
    {
        const self = this;
        this.dt = 0;
        this.lastTime = new Date();

        this.AMMO = null;
        // Note: AMMO.js should be loaded globally in the client
        if (typeof Ammo !== 'undefined') {
            this.AMMO = Ammo;
        } else {
            console.error('Ammo.js not loaded!');
        }
    }

    update(dt)
    {
        
    }
}