var PacketHeader = {
  Common: {
    PING: 1,
    PONG: 2,
  },
  Client: {
    LOCAL_SNAPSHOT: 7,
  },
  GameServer: {
    YOUR_ID: 3,
    ON_AWARENESS_GAINED: 4,
    ON_AWARENESS_LOST: 5,
    ACTORS_SYNC: 6,
  },
};

var ArrayBufferToString = function (buffer, offset) {
  try {
    var dv = new DataView(buffer);
    var b = new Uint16Array((buffer.byteLength - offset) / 2);
    var e = 0;
    for (var i = offset; i < dv.byteLength; i = i + 2) {
      b[e] = dv.getUint16(i, true);
      e++;
    }
    var result = String.fromCharCode.apply(null, b);

    return result;
  } catch (err) {
    console.log("ABTS: parse error", err);
    return "parse error";
  }
};

var ArrayBufferToStringWithSpecifiedOffset = function (buffer, length, offset) {
  try {
    var dv = new DataView(buffer);
    var b = new Uint8Array(length);
    var e = 0;

    for (var i = offset; i < offset + length * 2; i = i + 2) {
      b[e] = dv.getUint16(i, true);
      e++;
    }
    var result = String.fromCharCode.apply(null, b);

    return result;
  } catch (err) {
    console.log("ABTSWSOffset: parse error", err);
    return "parse error";
  }
};

var ArrayBufferToBase64SpecifiedOffset = function (buffer, length, offset) {
  var dv = new DataView(buffer);
  var b = new Uint8Array(length);
  var e = 0;
  for (var i = offset; i < offset + length * 2; i = i + 2) {
    b[e] = dv.getUint16(i, true);
    e++;
  }

  var result = b.reduce(function (data, byte) {
    return data + String.fromCharCode(byte);
  }, "");

  return result;
};

var StringToArrayBuffer = function (str) {
  var buffer = new ArrayBuffer(str.length * 2); // Unicode encoding, 2 bytes for each char
  var view = new Uint16Array(buffer);
  for (i = 0; i < str.length; i++) {
    view[i] = str.charCodeAt(i);
  }
  return buffer;
};

// Incoming Packet class
var IncomingPacket = function (buffer) {
  var context = this;

  this.buffer = buffer;
  this.view = new DataView(this.buffer);
  //this.view = new FastDataView(this.buffer, 0, this.buffer.byteLength);
  this.readBytesLength = 0;

  this.ReadByte = function (littleEndian) {
    var byte = context.view.getUint8(context.readBytesLength, littleEndian);
    context.readBytesLength++;
    return byte;
  };

  this.ReadInt = function (littleEndian) {
    var integer = context.view.getInt32(context.readBytesLength, littleEndian);
    context.readBytesLength += 4;
    return integer;
  };

  this.ReadFloat = function (littleEndian) {
    var float = context.view.getFloat32(context.readBytesLength, littleEndian);
    context.readBytesLength += 4;
    return float;
  };

  // Unused in this project
  this.ReadFloatBigEndian = function (index) {
    var float = context.view.getFloat32(index, false);
    return float;
  };

  this.ReadString = function (length, offset) {
    var arrayBuffer = ArrayBufferToString(context.buffer, offset);
    context.readBytesLength += length * 2;
    return arrayBuffer;
  };

  this.ReadStringFixedOffset = function (length, offset) {
    var res = ArrayBufferToStringWithSpecifiedOffset(
      context.buffer,
      length,
      offset
    );
    context.readBytesLength += length * 2;
    return res;
  };

  this.ReadBase64FixedOffset = function (length, offset) {
    var res = ArrayBufferToBase64SpecifiedOffset(
      context.buffer,
      length,
      offset
    );
    context.readBytesLength += length * 2;
    return res;
  };
};

function resizeUint8(baseArrayBuffer, newByteSize) {
  var resizedArrayBuffer = new ArrayBuffer(newByteSize),
    len = baseArrayBuffer.byteLength,
    resizeLen = len > newByteSize ? newByteSize : len;

  new Uint8Array(resizedArrayBuffer, 0, resizeLen).set(
    new Uint8Array(baseArrayBuffer, 0, resizeLen)
  );

  return resizedArrayBuffer;
}

// Outgoing Packet class
var OutgoingPacket = function (header, length) {
  var context = this;

  /*let dynamicLength = false;
    if(length === null || length === undefined){
        length = 1;
        dynamicLength = true;
        console.log(">> Created new dynamic-length packet!");
    }*/

  this.buffer = new ArrayBuffer(length);
  this.view = new DataView(this.buffer);
  this.view.setInt8(0, header);
  this.writtenBytesLength = 1;

  this.WriteByte = function (byte, littleEndian) {
    /*if(dynamicLength){
            this.buffer = ArrayBuffer.transfer(this.buffer, context.writtenBytesLength+1);
        }*/

    context.view.setInt8(context.writtenBytesLength, byte, littleEndian);
    context.writtenBytesLength++;
  };

  this.WriteInt = function (int, littleEndian) {
    /*if(dynamicLength){
            this.buffer = ArrayBuffer.transfer(this.buffer, context.writtenBytesLength+4);
        }*/

    context.view.setInt32(context.writtenBytesLength, int, littleEndian);
    context.writtenBytesLength += 4;
  };

  this.WriteFloat = function (float, littleEndian) {
    /*if(dynamicLength){
            this.buffer = ArrayBuffer.transfer(this.buffer, context.writtenBytesLength+4);
        }*/

    context.view.setFloat32(context.writtenBytesLength, float, littleEndian);
    context.writtenBytesLength += 4;
  };

  this.WriteString = function (str) {
    var buffer = StringToArrayBuffer(str);
    var strView = new DataView(buffer);
    var strBytes = [];
    for (i = 0; i < buffer.byteLength; i++) {
      strBytes.push(strView.getUint8(i));
    }

    /*if(dynamicLength){
            this.buffer = ArrayBuffer.transfer(this.buffer, context.writtenBytesLength+(strBytes.length*2));
        }*/

    var view = new Uint8Array(context.buffer);
    for (i = 0; i < strBytes.length; i++) {
      view[context.writtenBytesLength + i] = strBytes[i];
    }

    context.writtenBytesLength += strBytes.length;
  };

  this.WriteBuffer = function (bff) {
    //var thisView = new DataView(this.buffer);
    var otherView = new DataView(toArrayBuffer(bff));
    var thisView = new DataView(this.buffer);

    var ab = new ArrayBuffer(this.buffer.byteLength + otherView.byteLength);
    var newView = new DataView(ab);
    var bytesWritten = 0;

    newView.setInt8(0, thisView.getInt8(0));
    bytesWritten++;

    for (var i = 0; i < otherView.byteLength; i++) {
      newView.setInt8(bytesWritten, otherView.getInt8(i));
      bytesWritten++;
    }

    this.buffer = newView.buffer;
  };
};

function toArrayBuffer(myBuf) {
  var myBuffer = new ArrayBuffer(myBuf.length);
  var res = new Uint8Array(myBuffer);
  for (var i = 0; i < myBuf.length; ++i) {
    res[i] = myBuf[i];
  }
  return myBuffer;
}

var GetBuffer = function (bff, offset) {
  var bffDv = new DataView(bff);

  var splitAB = new ArrayBuffer(bffDv.byteLength - offset);
  var splitDv = new DataView(splitAB);

  for (var i = 0; i < bffDv.byteLength - offset; i++) {
    splitDv.setInt8(i, bffDv.getInt8(i + offset));
  }

  var buffer = Buffer.from(splitAB);
  console.log("split AB", buffer.byteLength);

  return buffer;
};

module.exports = {
  PacketHeader,
  IncomingPacket,
  OutgoingPacket,
};
