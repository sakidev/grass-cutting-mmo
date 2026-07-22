function remoteAddressToString(address) {
    if (address.byteLength == 4) {//IPv4
        return new Uint8Array(address).join('.');
    } else if (address.byteLength == 16) {//IPv6
        let arr = Array.from(new Uint16Array(address));
        if (arr[0] == 0 && arr[1] == 0 && arr[2] == 0 && arr[3] == 0 && arr[4] == 0 && arr[5] == 0xffff)  //IPv4 mapped to IPv6
            return new Uint8Array(address.slice(12)).join('.');
        else
            return Array.from(new Uint16Array(address)).map(v => v.toString(16)).join(':').replace(/((^|:)(0(:|$))+)/, '::');
    }
};

async function makeDelay(seconds) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, seconds * 1000);
  });
};

const pc = require('./playcanvas.js');

let groundHuggingX = new pc.Vec3();
let groundHuggingY = new pc.Vec3();
let groundHuggingZ = new pc.Vec3();
function setMat4Forward(mat4, forward, up)
{
    groundHuggingZ.copy(forward).normalize();
    groundHuggingY.copy(up).mulScalar(-1);
    groundHuggingX.cross(groundHuggingY, groundHuggingZ).normalize();
    groundHuggingY.cross(groundHuggingZ, groundHuggingX);

    let r = mat4.data;

    r[0] = groundHuggingX.x;
    r[1] = groundHuggingX.y;
    r[2] = groundHuggingX.z;
    r[3] = 0;
    r[4] = groundHuggingY.x;
    r[5] = groundHuggingY.y;
    r[6] = groundHuggingY.z;
    r[7] = 0;
    r[8] = groundHuggingZ.x;
    r[9] = groundHuggingZ.y;
    r[10] = groundHuggingZ.z;
    r[11] = 0;
    r[15] = 1;

    return mat4;
};

function readJSON(res, cb, err) {
  let buffer;
  /* Register data cb */
  res.onData((ab, isLast) => {
    let chunk = Buffer.from(ab);
    if (isLast) {
      let json;
      if (buffer) {
        try {
          json = JSON.parse(Buffer.concat([buffer, chunk]));
        } catch (e) {
          /* res.close calls onAborted */
          res.close();
          return;
        }
        cb(json);
      } else {
        try {
          json = JSON.parse(chunk);
        } catch (e) {
          /* res.close calls onAborted */
          res.close();
          return;
        }
        cb(json);
      }
    } else {
      if (buffer) {
        buffer = Buffer.concat([buffer, chunk]);
      } else {
        buffer = Buffer.concat([chunk]);
      }
    }
  });

  /* Register error cb */
  res.onAborted(err);
}

module.exports = {
    remoteAddressToString,
    makeDelay,
    setMat4Forward,
    readJSON
};