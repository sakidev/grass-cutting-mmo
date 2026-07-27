import { client, STATIC_SOUNDS } from "./game.js";
import { IncomingPacket, OutgoingPacket, PacketHeader } from "./packet.js";

export { Client };

class Client {
  constructor() {
    this.connected = false;
    this.connecting = false;
    this.ping = 0;
    this.receivedPackets = 0;
    this.inPktSizes = 0;
    this.outPktSizes = 0;
    this.CCU = 0;
    this.lastPingDate = null;


    this.mPlayerId = -1;
    this.mPlayer = null;
  }

  connect(data) {
    if (!this.connected && !this.connecting) {
      this.connecting = true;
      this.lastUsedURL = data.url;

      console.log("Connecting to game server");

      this.socket = new WebSocket(
        data.url
      );

      this.socket.binaryType = "arraybuffer";
      this.socket.onopen = this.onSocketOpen.bind(this);
      this.socket.onmessage = this.onSocketMsg.bind(this);
      this.socket.onclose = this.onSocketClose.bind(this);
      this.socket.onerror = this.onSocketError.bind(this);
    } else {
      this.onSocketOpen("already connected :)");
    }
  }

  onSocketOpen(e) {
    console.log("socket open", e);

    this.connected = true;
  }

  onSocketMsg(e) {
    this.receivedPackets++;

    const self = this;

    if (typeof e.data === "string")
    {
      // Do something with string (JSON) packets
      const jsonPacket = JSON.parse(e.data);
      if (jsonPacket.header)
      {
        switch (jsonPacket.header)
        {
          default:
            break;
        }
      }
    }
    else
    {
      // Binary network packets
      const inPkt = new IncomingPacket(e.data);

      const header = inPkt.ReadByte();
      switch (header) {
          case PacketHeader.Common.PING:
            {
                this.latency = inPkt.ReadByte();
                this.onPing();
            }
            break;
          case PacketHeader.GameServer.YOUR_ID:
            {
                this.mPlayerId = inPkt.ReadInt();
                console.log("MY ID:", this.mPlayerId);
            }
            break;
          case PacketHeader.GameServer.ON_AWARENESS_GAINED:
            {
                const playerId = inPkt.ReadInt();
                const pos = [
                  inPkt.ReadFloat(),
                  inPkt.ReadFloat(),
                  inPkt.ReadFloat()
                ];

                let player = Player.getPlayerById(playerId);
                if(!player)
                  player = new Player(playerId, pos);

                player.spawn(pos);
            }
            break;
          case PacketHeader.GameServer.ON_AWARENESS_LOST:
            {
                const playerId = inPkt.ReadInt();
                const player = Player.getPlayerById(playerId);
                if(player)
                  player.despawn();
            }
            break;
          case PacketHeader.GameServer.ACTORS_SYNC:
            {
                const numActors = inPkt.ReadInt();
                for(let i = 0; i < numActors; i++)
                {
                    const playerId = inPkt.ReadInt();
                    const pos = [
                      inPkt.ReadFloat(),
                      inPkt.ReadFloat(),
                      inPkt.ReadFloat()
                    ];
                    const eulers = [
                      inPkt.ReadFloat(),
                      inPkt.ReadFloat(),
                      inPkt.ReadFloat()
                    ];
                    const bladeRotSpeed = inPkt.ReadFloat();

                    let player = Player.getPlayerById(playerId);
                    if(!player)
                    {
                      console.log("Received sync for unknown player id:", playerId);
                      continue;
                    }

                    player.sync(pos, eulers, bladeRotSpeed);
                }
            }
            break;
          case PacketHeader.GameServer.ORDER_LOAD_GRASS_PATCH:
            {
                const patchIdx = inPkt.ReadInt();
                const cutBitsLength = inPkt.ReadInt();
                const cutBits = [];
                for(let i = 0; i < cutBitsLength; i++)
                    cutBits.push(inPkt.ReadByte());

                const bitsThatHaveBeenCut = cutBits.filter(bit => bit !== 0).length;

                if(!GRASS_PATCHES[patchIdx].originalPatch)
                {
                  const newPatch = Grass.fromTexture(
                    GRASS_PATCHES[patchIdx].fileName,
                    GRASS_PATCHES[patchIdx].bladeAmount,
                    {
                      spawnColor: GRASS_PATCHES[patchIdx].spawnColor,
                      tolerance: GRASS_PATCHES[patchIdx].tolerance,
                      baseColor: GRASS_PATCHES[patchIdx].baseColor,
                      tipColor:  GRASS_PATCHES[patchIdx].tipColor,
                      flipZ: true,
                      cutRaster: cutBits,
                      seed: GRASS_PATCHES[patchIdx].seed
                    }
                  );
                  GRASS_PATCHES[patchIdx].originalPatch = newPatch;
                  GRASS_PATCHES[patchIdx].cutBits = cutBits;
  
                  console.log("Received ORDER_LOAD_GRASS_PATCH for patchIdx:", patchIdx, "cutBitsLength:", bitsThatHaveBeenCut, "/", cutBitsLength);
                }
            }
            break;
          case PacketHeader.GameServer.ORDER_UNLOAD_GRASS_PATCH:
            {
                const patchIdx = inPkt.ReadInt();
                //console.log("Received ORDER_UNLOAD_GRASS_PATCH for patchIdx:", patchIdx);

                // For now, do nothing - I have to see if this affects session performance
            }
            break;
          case PacketHeader.GameServer.GRASS_EVENT:
            {
              const cutPatchIndex = inPkt.ReadInt();
              const numBladesCut = inPkt.ReadInt();
              const cutBladeIndexes = [];
              for(let i = 0; i < numBladesCut; i++)
                cutBladeIndexes.push(inPkt.ReadInt());

              const patch = GRASS_PATCHES[cutPatchIndex].originalPatch;
              if(patch)
              {
                patch.cutBlades(cutBladeIndexes);
                //console.log("Received GRASS_EVENT for patchIdx:", cutPatchIndex, "numBladesCut:", numBladesCut);
              }
              else
              {
                console.log("Received GRASS_EVENT for patchIdx:", cutPatchIndex, "but patch is not loaded yet!");
              }
            }
            break;
          default:
              console.log("Unhandled packet header:", header);
              break;
      }
    }
  }

  onSocketClose(e) {
    console.log("socket close", e);

    this.connected = false;
    this.connecting = false;
  }

  reconnect(){
    if(this.reconnectTimeout)
      clearTimeout(this.reconnectTimeout);

    const self = this;

    this.reconnectTimeout = setTimeout(()=>{
      console.log("Reconnecting to server...");
      self.connect({url: self.lastUsedURL});
    }, 1000);
  }

  stopConnection(){
    if(this.socket)
      this.socket.close();
  }

  onSocketError(e) {
    console.log("socket error", e);
  }

  /*startPingLoop() {
    const self = this;

    setInterval(() => {
      if (!self.connected) return;
      
      self.lastPingDate = new Date();
      const pkt = new OutgoingPacket(PacketHeader.Common.PING, 1);
      self.socket.send(pkt.buffer);
    }, 1000);
  }*/

  onPing() {
    if (!this.connected) return;

    console.log("Latest latency to game server:", this.latency + "ms");
    const pkt = new OutgoingPacket(PacketHeader.Common.PONG, 1);
    try {
      this.socket.send(pkt.buffer);
    } catch (err) {}
  }

  sendLocalSnapshot(pos, eulers, bladeRotationSpeed)
  {
    if (!this.connected) return;

    const pkt = new OutgoingPacket(PacketHeader.Client.LOCAL_SNAPSHOT, 1 + (4*3) + (4*3) + 4);
    pkt.WriteFloat(pos.x);
    pkt.WriteFloat(pos.y);
    pkt.WriteFloat(pos.z);
    pkt.WriteFloat(eulers.x);
    pkt.WriteFloat(eulers.y);
    pkt.WriteFloat(eulers.z);
    pkt.WriteFloat(bladeRotationSpeed);

    try {
      this.socket.send(pkt.buffer);
    } catch (err) {}
  }
}