const pc = require('./playcanvas.js');
const fs = require('fs');

class Loader {
  constructor() {
    this.textures = [];
    this.loadingTextures = [];
    this.onLoadedTexturesCallbacks = [];
    this.models = [];
    this.loadingModels = [];
    this.onLoadedModelsCallbacks = [];
    this.sounds = [];
    this.loadingSounds = [];
    this.onLoadedSoundsCallbacks = [];
  }

  setCullModeForMaterial(material, cull) {
    material.cull = cull;
  }

  async loadModel(url, modelName, callback) {
    url = "http://localhost:3000/" + url;
    console.log("Loader.loadModel", url, modelName);
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

            asset.on('error', (e)=>{
        console.log("Error loading model", modelName, e);
      });

      global.main.app.assets.add(asset);
      global.main.app.assets.load(asset);

      asset.ready((a) => {
        // As we play animations by name, if we have only one animation, keep it the same name as
        // the original container otherwise, postfix it with a number
        var animations = a.resource.animations;
        for (var i = 0; i < animations.length; ++i) {
          animations[i].name = animations[i].resource.name;
          console.log(animations[i].name);
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
}

module.exports = Loader;