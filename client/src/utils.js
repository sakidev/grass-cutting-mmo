window.audioAllowed = false;
        /*document.addEventListener("click", function enableAudio(){
            if(!window.audioAllowed)
            {
                window.audioAllowed = true;
                console.log("Audio is now allowed");
            }
            document.removeEventListener("click", enableAudio);
        });

        document.addEventListener("touchstart", function enableAudioTouch(){
            if(!window.audioAllowed)
            {
                window.audioAllowed = true;
                console.log("Audio is now allowed");
            }
            document.removeEventListener("touchstart", enableAudioTouch);
        });*/
        
var mat4X = new pc.Vec3();
var mat4Y = new pc.Vec3();
var mat4Z = new pc.Vec3();

var setMat4Up = (function () {
    return function (mat4, forward, up) {
        mat4Z.copy(forward).normalize();
        // Inverse the forward direction as +z is pointing backwards due to the coordinate system
        mat4Y.copy(up).scale(-1);
        mat4X.cross(mat4Y, mat4Z).normalize();
        mat4Y.cross(mat4Z, mat4X);

        var r = mat4.data;

        r[0]  = mat4X.x;
        r[1]  = mat4X.y;
        r[2]  = mat4X.z;
        r[3]  = 0;
        r[4]  = mat4Y.x;
        r[5]  = mat4Y.y;
        r[6]  = mat4Y.z;
        r[7]  = 0;
        r[8]  = mat4Z.x;
        r[9]  = mat4Z.y;
        r[10] = mat4Z.z;
        r[11] = 0;
        r[15] = 1;

        return mat4;
    };
}());

(function(){
    var utils = {};
    var app = null;

    utils.setGame = function(game){
        app = game;
    };

    utils.initSoundForEntity = function(entity)
    {
        entity.playSound = (sound, path, options, callback) => {
            // Don't play sounds if the window is not focused
            // otherwise will lead to sounds playing all at once when the user
            // comes back
            /*if(BLURRED) return;
            if(!window.audioAllowed) return;*/

            if(!entity.sound)
            {
                console.log("Tried to play sound for entity", entity.name, "but it has no sound component!");
                return;
            }

            if(!entity.sound.slots[sound])
            {
                loader.loadSound(path, sound, (asset)=>{
                    if(!entity || !entity.sound) return;

                    entity.sound.addSlot(sound, {
                        asset: asset,
                        pitch: 1,
                        autoPlay: options ? options.autoPlay : true,
                        loop: options ? options.loop : false,
                        volume: options ? options.volume : 1
                    });

                    console.log("Playing sound", sound, "for entity", entity.name);

                    if(callback)
                        callback(entity.sound.slots[sound]);

                    entity.sound.play(sound);
                });
            }
            else
            {
                if(options.pitch)
                {
                    entity.sound.slots[sound].pitch = options.pitch;
                }
                entity.sound.play(sound);
            }
        };
    };

    /**
     * @name utils#loadGlbContainerFromUrl
     * @function
     * @description Load a GLB container from a URL that returns a `model/gltf-binary` as a GLB.
     * @param {String} url The URL for the GLB
     * @param {Object} options Optional. Extra options to do extra processing on the GLB.
     * @param {String} assetName. Name of the asset.
     * @param {Function} callback The callback function for loading the asset. Signature is `function(string:error, asset:containerAsset)`.
     * If `error` is null, then the load is successful.
     * @returns {pc.Asset} The asset that is created for the container resource.
     */
    utils.loadGlbContainerFromUrl = function (url, options, assetName, callback) {
        var filename = assetName + '.glb';
        var file = {
            url: url,
            filename: filename
        };

        var asset = new pc.Asset(filename, 'container', file, null, options);
        asset.once('load', function (containerAsset) {
            if (callback) {
                // As we play animations by name, if we have only one animation, keep it the same name as
                // the original container otherwise, postfix it with a number
                var animations = containerAsset.resource.animations;
                if (animations.length == 1) {
                    animations[0].name = assetName;
                } else if (animations.length > 1) {
                    for (var i = 0; i < animations.length; ++i) {
                        animations[i].name = assetName + ' ' + i.toString();
                    }
                }

                callback(null, containerAsset);
            }
        });

        app.assets.add(asset);
        app.assets.load(asset);

        return asset;
    };

    utils.artificialDelay = async function(ms){
        return new Promise(resolve => setTimeout(resolve, ms));
    };

    window.utils = utils;
})();

function base64ToBits(b64, n) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const bits = new Uint8Array(n ?? bytes.length * 8);
  for (let i = 0; i < bits.length; i++) {
    bits[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  }
  return bits;
}