class Loader {
  constructor(game) {
    this.game = game;

    this.textures = [];
    this.loadingTextures = [];
    this.onLoadedTexturesCallbacks = [];
    this.models = [];
    this.loadingModels = [];
    this.onLoadedModelsCallbacks = [];
    this.sounds = [];
    this.loadingSounds = [];
    this.onLoadedSoundsCallbacks = [];

    this.MODEL_ASSETS = [];
  }

  setCullModeForMaterial(material, cull) {
    material.cull = cull;
  }

  async loadModel(url, modelName, callback) {
    if((window.PRODUCTION && !window.location.href.includes("127.0.0.1")) || window.cordova) url = "https://flapn.fun/" + url;
    url += "?v=" + VERSION;
    const existing = this.models.find((m) => m.name === modelName);
    const loading = this.loadingModels.find((m) => m.name === modelName);
    if (existing) {
      //console.log("model already loaded, returning existing");
      callback(existing);
      return existing;
    }
    else
    {
      if(loading)
      {
        this.onLoadedModelsCallbacks.push({ name: modelName, callback });
        return;
      }
    }

    this.loadingModels.push({ name: modelName });
    console.log("Loading model", modelName);

    const promise = new Promise((resolve) => {
      const asset = new pc.Asset(
        modelName,
        "container",
        {
          url,
          filename: modelName,
        },
        null,
        {}
      );

      this.game.assets.add(asset);
      this.game.assets.load(asset);

      asset.ready((a) => {
        // As we play animations by name, if we have only one animation, keep it the same name as
        // the original container otherwise, postfix it with a number
        var animations = a.resource.animations;
        for (var i = 0; i < animations.length; ++i) {
          animations[i].name = animations[i].resource.name;
          console.log(animations[i].name);
        }

        // Make transparent materials transparent!
        for (let i = 0; i < a.resource.materials.length; i++) {
          // Pixel Art
          /*a.resource.data.materials[i].diffuseMap.mipMaps = false;
          a.resource.data.materials[i].diffuseMap.minFilter = pc.FILTER_NEAREST;
          a.resource.data.materials[i].diffuseMap.magFilter = pc.FILTER_NEAREST;
          a.resource.data.materials[i].diffuseMap.sRGB = true;
          a.resource.data.materials[i].diffuseMap.anisotropy = 0;
          a.resource.data.materials[i].update();

          a.resource.data.materials[i].emissiveMap = a.resource.data.materials[i].diffuseMap;
          a.resource.data.materials[i].emissiveIntensity = 2;
          a.resource.data.materials[i].update();

          if (a.resource.data.materials[i].name.includes("transparent")) {
            //a.resource.data.materials[i].blendType = pc.BLEND_NORMAL;
          }*/
        }

        asset.name = modelName;

        resolve(asset.resource);
      });
    });

    const result = await promise;
    if (result && callback) {
      result.name = modelName;

      this.models.push(result);

      const callbacks = this.onLoadedModelsCallbacks.filter((c) => c.name === modelName);
      callbacks.forEach((c) => c.callback(result));
      this.onLoadedModelsCallbacks = this.onLoadedModelsCallbacks.filter((c) => c.name !== modelName);

      //console.log("loaded model", modelName, result);

      callback(result);
    }
  }

  async loadTexture(path, texName, callback) {
    if(window.PRODUCTION && !window.location.href.includes("127.0.0.1")) path = "https://flapn.fun/" + path;
    path += "?v=" + VERSION;
    const exists = this.textures.find((t) => {
      //console.log("checking", t.name, texName, t.name === texName);
      return t.name === texName;
    });
    const loading = this.loadingTextures.find((t) => t.name === texName);
    if(exists){
        //console.log("texture already loaded, returning existing");
        callback(exists);
        return;
    }
    else
    {
      if(loading)        {
        this.onLoadedTexturesCallbacks.push({ name: texName, callback });
        return;
      }
    }

    this.loadingTextures.push({ name: texName });
    console.log("Loading texture", texName);

    const promise = new Promise((resolve) => {
      const asset = new pc.Asset(
        texName,
        "texture",
        {
          url: path,
          filename: texName,
        },
        null,
        {}
      );

      this.game.assets.add(asset);
      this.game.assets.load(asset);

      asset.ready((a) => {
        resolve(asset.resource);
      });
    });

    const result = await promise;
    if (result && callback) {
      result.name = texName;

      this.textures.push(result);

      const callbacks = this.onLoadedTexturesCallbacks.filter((c) => c.name === texName);
      callbacks.forEach((c) => c.callback(result));
      this.onLoadedTexturesCallbacks = this.onLoadedTexturesCallbacks.filter((c) => c.name !== texName);

      callback(result);
    }
  }

  async loadSound(path, soundName, callback) {
    if(window.PRODUCTION && !window.location.href.includes("127.0.0.1")) path = "https://flapn.fun/" + path;
    path += "?v=" + VERSION;
    const existing = this.sounds.find((s) => s.name === soundName);
    const loading = this.loadingSounds.find((s) => s.name === soundName);
    if(existing){
        //console.log("sound already loaded, returning existing");
        callback(existing);
        return;
    }
    else{
      if(loading)
      {
        this.onLoadedSoundsCallbacks.push({ name: soundName, callback });
        return;
      }
    }

    this.loadingSounds.push({ name: soundName });
    console.log("Loading sound", soundName);

    const promise = new Promise((resolve) => {
      const asset = new pc.Asset(
        soundName,
        "audio",
        {
          url: path,
          filename: soundName,
        },
        null,
        {}
      );

      this.game.assets.add(asset);
      this.game.assets.load(asset);

      asset.ready((a) => {
        resolve(asset);
      });
    });

    const result = await promise;
    if (result && callback) {
      result.name = soundName;
      this.sounds.push(result);

      const callbacks = this.onLoadedSoundsCallbacks.filter((c) => c.name === soundName);
      callbacks.forEach((c) => c.callback(result));
      this.onLoadedSoundsCallbacks = this.onLoadedSoundsCallbacks.filter((c) => c.name !== soundName);

      callback(result);
    }
  }
}
